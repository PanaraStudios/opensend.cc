"use node"
import { publicFetch } from "../lib/net/public-fetch"
import { localHttpOrigin } from "../lib/net/public-host"
import { action } from "./_generated/server"
import { internal } from "./_generated/api"
import { v, ConvexError } from "convex/values"
import {
  POLICY_REVISION,
  credentialsValue,
  installationUrl,
  regionValue,
} from "./ses/contracts"
import {
  checkEncryption,
  encryptCredentials,
  createWrappedKey,
} from "./ses/crypto"
import { clients, hasPolicyRevision, readAccount, awsError } from "./ses/aws"
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import { controlPlanePacer } from "./ses/pacing"
import { setupProof } from "./ses/web"
import { defaultCallbackOrigin } from "./access"

export const initialize = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runQuery(internal.installation.adminContext, {})
    const id = await ctx.runMutation(internal.installation.begin, {
      siteUrl: installationUrl(process.env.SITE_URL ?? "", true),
      callbackOrigin: defaultCallbackOrigin(),
    })
    await ctx.runMutation(internal.installation.saveEncryptionKey, {
      id,
      wrappedKey: createWrappedKey(id),
    })
    return null
  },
})
/** Throws unless the origin reaches this exact deployment: it must answer a
    fresh challenge with this deployment's proof. */
async function proveCallbackOrigin(callbackOrigin: string) {
  const challenge = crypto.randomUUID()
  const response = await publicFetch(
    `${callbackOrigin}/ses/health?challenge=${challenge}`,
    { timeoutMs: 10000, localOrigin: localHttpOrigin(callbackOrigin) }
  )
  const body: unknown = await response.json()
  const expected = await setupProof(challenge)
  if (
    !response.ok ||
    !body ||
    typeof body !== "object" ||
    !("challenge" in body) ||
    body.challenge !== challenge ||
    !("proof" in body) ||
    body.proof !== expected
  )
    throw new Error("The callback URL did not reach this Opensend deployment")
}
/** A public URL check's failure, as the message the dashboard shows. */
function callbackError(e: unknown) {
  if (e && typeof e === "object" && "data" in e && typeof e.data === "string")
    return new ConvexError(e.data)
  if (
    e instanceof Error &&
    (e.message === "fetch failed" || e.name === "TimeoutError")
  )
    return new ConvexError(
      "Could not reach this backend URL. Keep your tunnel running and try again."
    )
  return new ConvexError(
    e instanceof Error ? e.message : "Environment check failed"
  )
}
export const checkEnvironment = action({
  args: { callbackOrigin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.installation.adminContext, {})
    try {
      const siteUrl = installationUrl(process.env.SITE_URL ?? "", true)
      const callbackOrigin = installationUrl(args.callbackOrigin, true)
      await proveCallbackOrigin(callbackOrigin)
      await ctx.runMutation(internal.installation.saveEnvironment, {
        siteUrl,
        callbackOrigin,
      })
      return null
    } catch (e) {
      throw callbackError(e)
    }
  },
})
/** Moves a provisioned installation to a new public URL, once the URL is
    proven to reach this deployment. AWS then subscribes the new URL and
    domains refresh; see `installation.moveCallbackOrigin`. */
export const changeCallbackOrigin = action({
  args: { callbackOrigin: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.installation.adminContext, {})
    try {
      const callbackOrigin = installationUrl(args.callbackOrigin.trim(), true)
      await ctx.runQuery(internal.installation.checkCallbackMove, {
        callbackOrigin,
      })
      await proveCallbackOrigin(callbackOrigin)
      await ctx.runMutation(internal.installation.moveCallbackOrigin, {
        callbackOrigin,
      })
      return null
    } catch (e) {
      throw callbackError(e)
    }
  },
})
export const connect = action({
  args: {
    credentials: credentialsValue,
    expectedAccountId: v.string(),
    defaultRegion: regionValue,
    regions: v.array(regionValue),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const installation = await ctx.runQuery(
      internal.installation.adminContext,
      {}
    )
    if (!installation) throw new ConvexError("Start setup first")
    if (!/^\d{12}$/.test(args.expectedAccountId))
      throw new ConvexError("Enter the 12-digit AWS account ID")
    const regions = [...new Set([args.defaultRegion, ...args.regions])]
    if (regions.length > 4) throw new ConvexError("Too many regions")
    if (
      args.credentials.kind === "keys" &&
      (!/^[A-Z0-9]{16,128}$/.test(args.credentials.accessKeyId) ||
        !args.credentials.secretAccessKey ||
        args.credentials.secretAccessKey.length > 256)
    )
      throw new ConvexError("Enter valid AWS credentials")
    try {
      checkEncryption(installation._id, installation.wrappedEncryptionKey)
      const identity = await clients(
        args.defaultRegion,
        args.credentials
      ).sts.send(new GetCallerIdentityCommand({}))
      if (
        identity.Account !== args.expectedAccountId ||
        !identity.Arn?.startsWith("arn:aws:")
      )
        throw new ConvexError(
          "AWS account does not match; no changes were made"
        )
      // The pacer is keyed per region, so these never queue behind each other.
      const checked = await Promise.all(
        regions.map(async (region) => ({
          region,
          quota: await readAccount(
            clients(region, args.credentials, controlPlanePacer(ctx, region))
              .ses
          ),
        }))
      )
      await ctx.runMutation(internal.installation.activateConnection, {
        revision: installation.credentialRevision,
        accountId: identity.Account,
        credentialKind: args.credentials.kind,
        ...(args.credentials.kind === "keys"
          ? {
              encryptedCredentials: encryptCredentials(
                args.credentials,
                installation._id,
                installation.wrappedEncryptionKey
              ),
              accessKeyLast4: args.credentials.accessKeyId.slice(-4),
            }
          : {}),
        defaultRegion: args.defaultRegion,
        regions: checked,
      })
    } catch (e) {
      throw new ConvexError(awsError(e))
    }
    /* Record the permissions these credentials already have. This is how an
       administrator upgrades: update IAM, then update the connection. A
       failure leaves the revision unrecorded, so sending keeps waiting. */
    try {
      const granted = await Promise.all(
        regions.map((region) =>
          hasPolicyRevision(
            clients(region, args.credentials, controlPlanePacer(ctx, region)),
            installation._id
          )
        )
      )
      if (granted.every(Boolean))
        await ctx.runMutation(internal.installation.recordPolicyRevision, {
          credentialRevision: installation.credentialRevision + 1,
          policyRevision: POLICY_REVISION,
        })
    } catch {
      // Connection succeeds even if the probes cannot yet confirm permissions.
    }
    return null
  },
})
