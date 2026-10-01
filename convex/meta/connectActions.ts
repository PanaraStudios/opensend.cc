"use node"
import { v, ConvexError } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { decryptSecret, encryptSecret } from "../secrets"
import { appAccessToken, graph, graphFailure } from "./graph"
import { MetaError } from "../../lib/meta/errors"
import {
  NUMBER_LIMIT,
  PHONE_NUMBER_FIELDS,
  readPhoneNumber,
  readPhoneNumbers,
  readTokenInfo,
  tokenBusinessId,
  tokenProblem,
  type PhoneNumber,
  type TokenInfo,
} from "../../lib/meta/whatsapp-account"

/* Team connect flows (https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider):
   Embedded Signup's token code or a pasted system-user token becomes a
   business token, checked with debug_token; then the WABA is attached:
   the app subscribes to its webhooks and its numbers are stored. Every
   public action checks the caller may write to the team first. */

type App = { appId: string; graphVersion: string; encryptedAppSecret: string }
type Connected = {
  connectionId: Id<"metaConnections">
  accounts: { id: Id<"channelAccounts">; handle: string; registered: boolean }[]
}

const TOKEN_REFUSED = "Meta refused the business token. Reconnect the business."
const connectedValue = v.object({
  connectionId: v.id("metaConnections"),
  accounts: v.array(
    v.object({
      id: v.id("channelAccounts"),
      handle: v.string(),
      registered: v.boolean(),
    })
  ),
})

function numericId(value: string, label: string) {
  const id = value.trim()
  if (!/^\d{1,32}$/.test(id))
    throw new ConvexError(`Enter the numeric ${label}`)
  return id
}

/** Runs Graph calls for the dashboard: failures become messages it can
    show, and a refused token (190) flags the connection for reconnecting. */
async function friendly<T>(
  ctx: ActionCtx,
  run: () => Promise<T>,
  connectionId?: Id<"metaConnections">
): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof MetaError && e.action === "token_invalid") {
      if (!connectionId)
        throw new ConvexError("Meta refused the token. Check it and try again.")
      await ctx.runMutation(internal.meta.connect.markConnection, {
        connectionId,
        status: "error",
        error: TOKEN_REFUSED,
      })
      throw new ConvexError(TOKEN_REFUSED)
    }
    throw new ConvexError(graphFailure(e))
  }
}

/** `GET /debug_token` with the app token. */
async function debugToken(app: App, token: string): Promise<TokenInfo> {
  return readTokenInfo(
    await graph({
      token: await appAccessToken(app),
      method: "GET",
      path: "debug_token",
      query: { input_token: token },
      version: app.graphVersion,
    })
  )
}

async function inspectToken(app: App, token: string, wabaId: string) {
  const info = await debugToken(app, token)
  const problem = tokenProblem(info, { appId: app.appId, wabaId })
  if (problem) throw new ConvexError(problem)
  return info
}

const phoneNumbers = async (token: string, version: string, wabaId: string) =>
  readPhoneNumbers(
    await graph({
      token,
      method: "GET",
      path: `${wabaId}/phone_numbers`,
      query: { fields: PHONE_NUMBER_FIELDS, limit: NUMBER_LIMIT },
      version,
    })
  )

async function phoneNumber(token: string, version: string, id: string) {
  const number = readPhoneNumber(
    await graph({
      token,
      method: "GET",
      path: id,
      query: { fields: PHONE_NUMBER_FIELDS },
      version,
    })
  )
  if (!number) throw new ConvexError("Meta returned no phone number")
  return number
}

/** A Graph object's name, or undefined when the token may not read it. */
async function nameOf(token: string, version: string, id: string) {
  try {
    const result = await graph<{ name?: unknown }>({
      token,
      method: "GET",
      path: id,
      query: { fields: "id,name" },
      version,
    })
    return typeof result.name === "string" && result.name.trim()
      ? result.name.trim()
      : undefined
  } catch (e) {
    if (e instanceof MetaError && e.action !== "token_invalid") return undefined
    throw e
  }
}

/** Imports the WABA's message templates once it is attached. Template sync
    belongs to the templates lane, which fills this in; connecting does not
    wait on it. */
const syncWabaTemplates: (
  ctx: ActionCtx,
  waba: { connectionId: Id<"metaConnections">; wabaId: string }
) => Promise<void> = async () => {}

/** Attaches a WABA with a checked business token: refuses a WABA another
    team holds, subscribes the app to its webhooks
    (`POST /{waba}/subscribed_apps`), reads its name and numbers, then
    stores the connection, WABA and numbers together. */
async function attachWaba(
  ctx: ActionCtx,
  input: {
    organizationId: string
    app: App
    method: "embedded_signup" | "manual_token"
    token: string
    info: TokenInfo
    wabaId: string
    businessId?: string
    phoneNumberId?: string
  }
): Promise<Connected> {
  const { organizationId, app, token, wabaId } = input
  const version = app.graphVersion
  await ctx.runQuery(internal.meta.connect.checkWaba, {
    organizationId,
    wabaId,
  })
  const subscribed = await graph<{ success?: boolean }>({
    token,
    method: "POST",
    path: `${wabaId}/subscribed_apps`,
    version,
  })
  if (subscribed.success !== true)
    throw new ConvexError("Meta did not confirm the webhook subscription")
  const wabaName = await nameOf(token, version, wabaId)
  const numbers: PhoneNumber[] = await phoneNumbers(token, version, wabaId)
  // Embedded Signup names the number it set up; Meta may list it late.
  if (
    input.phoneNumberId &&
    !numbers.some((number) => number.externalId === input.phoneNumberId)
  )
    numbers.push(await phoneNumber(token, version, input.phoneNumberId))
  // Without a business in hand, the WABA stands for it.
  const businessId = input.businessId ?? tokenBusinessId(input.info) ?? wabaId
  const businessName =
    (businessId !== wabaId
      ? await nameOf(token, version, businessId)
      : undefined) ??
    wabaName ??
    `Business ${businessId}`
  const connected = await ctx.runMutation(internal.meta.connect.store, {
    organizationId,
    businessId,
    businessName,
    method: input.method,
    encryptedToken: await encryptSecret(token),
    tokenLast4: token.slice(-4),
    scopes: input.info.scopes,
    wabaId,
    wabaName,
    numbers,
  })
  await syncWabaTemplates(ctx, { connectionId: connected.connectionId, wabaId })
  return connected
}

/** Finishes Embedded Signup. The code lives 30 seconds, so the dashboard
    calls this the moment it has both the code and the WABA. */
export const exchangeEmbeddedSignup = action({
  args: {
    organizationId: v.string(),
    code: v.string(),
    wabaId: v.string(),
    phoneNumberId: v.optional(v.string()),
    businessId: v.string(),
  },
  returns: connectedValue,
  handler: async (ctx, args): Promise<Connected> => {
    const app = await ctx.runQuery(internal.meta.connect.teamApp, {
      organizationId: args.organizationId,
    })
    const wabaId = numericId(args.wabaId, "WhatsApp Business Account ID")
    const businessId = numericId(args.businessId, "business ID")
    const phoneNumberId = args.phoneNumberId
      ? numericId(args.phoneNumberId, "phone number ID")
      : undefined
    const code = args.code.trim()
    if (!code || code.length > 2048)
      throw new ConvexError("Meta returned no signup code. Try again.")
    return friendly(ctx, async () => {
      const exchanged = await graph<{ access_token?: unknown }>({
        token: await appAccessToken(app),
        method: "GET",
        path: "oauth/access_token",
        query: {
          client_id: app.appId,
          client_secret: await decryptSecret(app.encryptedAppSecret),
          code,
        },
        version: app.graphVersion,
      })
      if (typeof exchanged.access_token !== "string" || !exchanged.access_token)
        throw new ConvexError("Meta returned no business token")
      const token = exchanged.access_token
      return attachWaba(ctx, {
        organizationId: args.organizationId,
        app,
        method: "embedded_signup",
        token,
        info: await inspectToken(app, token, wabaId),
        wabaId,
        businessId,
        phoneNumberId,
      })
    })
  },
})

/** Connects a WABA with a system-user access token pasted by the team. */
export const connectManual = action({
  args: {
    organizationId: v.string(),
    token: v.string(),
    wabaId: v.string(),
  },
  returns: connectedValue,
  handler: async (ctx, args): Promise<Connected> => {
    const app = await ctx.runQuery(internal.meta.connect.teamApp, {
      organizationId: args.organizationId,
    })
    const wabaId = numericId(args.wabaId, "WhatsApp Business Account ID")
    const token = args.token.trim()
    if (!/^[A-Za-z0-9_|-]{20,1024}$/.test(token))
      throw new ConvexError("Paste the system user access token from Meta")
    return friendly(ctx, async () =>
      attachWaba(ctx, {
        organizationId: args.organizationId,
        app,
        method: "manual_token",
        token,
        info: await inspectToken(app, token, wabaId),
        wabaId,
      })
    )
  },
})

/** Registers a number for Cloud API with the team's two-step verification
    PIN: `POST /{phone_number_id}/register`. The PIN is never stored. */
export const registerNumber = action({
  args: { accountId: v.id("channelAccounts"), pin: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, pin }): Promise<null> => {
    if (!/^\d{6}$/.test(pin)) throw new ConvexError("Enter a 6-digit PIN")
    const target = await ctx.runQuery(internal.meta.connect.accountTarget, {
      accountId,
    })
    await friendly(
      ctx,
      async () => {
        const result = await graph<{ success?: boolean }>({
          token: await decryptSecret(target.encryptedToken),
          method: "POST",
          path: `${target.externalId}/register`,
          version: target.graphVersion,
          body: { json: { messaging_product: "whatsapp", pin } },
        })
        if (result.success !== true)
          throw new ConvexError("Meta did not confirm the registration")
      },
      target.connectionId
    )
    await ctx.runMutation(internal.meta.connect.updateAccount, {
      accountId,
      registered: true,
    })
    return null
  },
})

/** Refreshes one number's name, status, quality, throughput and limit. */
export const syncAccount = action({
  args: { accountId: v.id("channelAccounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }): Promise<null> => {
    const target = await ctx.runQuery(internal.meta.connect.accountTarget, {
      accountId,
    })
    const number = await friendly(
      ctx,
      async () =>
        phoneNumber(
          await decryptSecret(target.encryptedToken),
          target.graphVersion,
          target.externalId
        ),
      target.connectionId
    )
    await ctx.runMutation(internal.meta.connect.updateAccount, {
      accountId,
      number,
    })
    return null
  },
})

/** The health cron's check of one connection: the token must still pass
    debug_token for every WABA it holds, then their numbers are synced. A
    refused token marks the connection `error`; a failed call is recorded
    and retried at the next check. */
export const checkConnection = internalAction({
  args: { connectionId: v.id("metaConnections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const target = await ctx.runQuery(internal.meta.connect.connectionTarget, {
      connectionId,
    })
    if (target?.status !== "active") return null
    const mark = (
      status: "active" | "error",
      error?: string,
      scopes?: string[]
    ) =>
      ctx.runMutation(internal.meta.connect.markConnection, {
        connectionId,
        status,
        error,
        scopes,
      })
    try {
      const token = await decryptSecret(target.encryptedToken)
      const info = await debugToken(target, token)
      const problem = [undefined, ...target.wabaIds]
        .map((wabaId) => tokenProblem(info, { appId: target.appId, wabaId }))
        .find((found) => found !== null)
      if (problem) {
        await mark("error", problem)
        return null
      }
      for (const wabaId of target.wabaIds)
        await ctx.runMutation(internal.meta.connect.syncNumbers, {
          connectionId,
          wabaId,
          numbers: await phoneNumbers(token, target.graphVersion, wabaId),
        })
      await mark("active", undefined, info.scopes)
    } catch (e) {
      if (e instanceof MetaError && e.action === "token_invalid")
        await mark("error", TOKEN_REFUSED)
      else await mark("active", graphFailure(e))
    }
    return null
  },
})

/** After a disconnect: stops Meta sending the WABAs' webhooks to the app
    (`DELETE /{waba}/subscribed_apps`), unless a team connected the WABA
    again meanwhile. Best effort; a failure is only logged. */
export const unsubscribe = internalAction({
  args: {
    connectionId: v.id("metaConnections"),
    wabaIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, wabaIds }) => {
    const target = await ctx.runQuery(internal.meta.connect.connectionTarget, {
      connectionId,
    })
    if (!target) return null
    const token = await decryptSecret(target.encryptedToken)
    for (const wabaId of wabaIds) {
      if (await ctx.runQuery(internal.meta.connect.wabaConnected, { wabaId }))
        continue
      try {
        await graph({
          token,
          method: "DELETE",
          path: `${wabaId}/subscribed_apps`,
          version: target.graphVersion,
        })
      } catch (e) {
        console.warn(`Could not unsubscribe WABA ${wabaId}: ${graphFailure(e)}`)
      }
    }
    return null
  },
})
