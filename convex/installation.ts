import { v, ConvexError } from "convex/values"
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server"
import {
  allRegionsReady,
  defaultCallbackOrigin,
  findInstallation,
  emailConfigured,
  findRegion,
  findTenant,
  installationAccess,
  listRegions,
  requireConnection,
  requireInstallationAdmin,
  requireTeam,
} from "./access"
import schema from "./schema"
import {
  quotaValue,
  regionValue,
  setupStepValue,
  tenantProvisioned,
  trackingTarget,
} from "./ses/contracts"
import { internal } from "./_generated/api"
import { startWorkflow } from "./ses/workflows"
import { resubscribe } from "./ses/inboundRegions"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"

export { findInstallation }
/* Every member needs the setup state to route the dashboard, so the AWS
   account, its key hint, the callback URL and the regional quotas are the
   optional half of this shape: present for an installation admin only. */
const publicInstallation = schema
  .doc("installation")
  .omit("encryptedCredentials", "wrappedEncryptionKey")
  .partial()
  .extend({
    _id: v.id("installation"),
    _creationTime: v.number(),
    key: v.literal("installation"),
  })
/* Topic, queue and subscription ARNs are internal plumbing, not dashboard data.
   Members need only which regions they can add a domain in; the account's
   limits and the state of its callback belong to the installation admin. */
const publicRegion = schema
  .doc("sesRegions")
  .pick("_id", "region", "phase")
  .extend({
    quota: v.optional(quotaValue),
    error: v.optional(v.string()),
    callbackConfirmed: v.optional(v.boolean()),
  })
export const status = query({
  args: {},
  returns: v.object({
    admin: v.boolean(),
    emailConfigured: v.boolean(),
    suggestedCallbackOrigin: v.string(),
    installation: v.union(v.null(), publicInstallation),
    regions: v.array(publicRegion),
  }),
  handler: async (ctx) => {
    const { admin } = await installationAccess(ctx)
    const installation = await findInstallation(ctx)
    // Explicit projection keeps ciphertext out of every public response.
    const safe = installation
      ? {
          _id: installation._id,
          _creationTime: installation._creationTime,
          key: installation.key,
          completedAt: installation.completedAt,
          emailDeferredAt: installation.emailDeferredAt,
          defaultRegion: installation.defaultRegion,
          setupStep: installation.setupStep,
          ...(admin
            ? {
                siteUrl: installation.siteUrl,
                callbackOrigin: installation.callbackOrigin,
                environmentCheckedAt: installation.environmentCheckedAt,
                accountId: installation.accountId,
                credentialKind: installation.credentialKind,
                accessKeyLast4: installation.accessKeyLast4,
                credentialRevision: installation.credentialRevision,
                policyRevision: installation.policyRevision,
              }
            : {}),
        }
      : null
    return {
      admin,
      emailConfigured: emailConfigured(installation),
      suggestedCallbackOrigin: admin ? defaultCallbackOrigin() : "",
      installation: safe,
      regions: (await listRegions(ctx)).map((region) => ({
        _id: region._id,
        region: region.region,
        phase: region.phase,
        // Sending volume, production access and the callback are AWS details.
        quota: admin ? region.quota : undefined,
        error: admin ? region.error : undefined,
        callbackConfirmed: admin ? region.callbackConfirmed : undefined,
      })),
    }
  },
})
export const begin = internalMutation({
  args: { siteUrl: v.string(), callbackOrigin: v.string() },
  returns: v.id("installation"),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const existing = await findInstallation(ctx)
    return (
      existing?._id ??
      ctx.db.insert("installation", {
        key: "installation",
        ...args,
        environmentCheckedAt: 0,
        credentialRevision: 0,
        setupStep: "welcome",
      })
    )
  },
})
export const saveEncryptionKey = internalMutation({
  args: { id: v.id("installation"), wrappedKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const installation = await findInstallation(ctx)
    if (!installation || installation._id !== args.id)
      throw new ConvexError("Installation not found")
    const changes = {
      // Concurrent setup clicks must never replace an already-active key.
      ...(!installation.wrappedEncryptionKey
        ? { wrappedEncryptionKey: args.wrappedKey }
        : {}),
      ...(!installation.setupStep || installation.setupStep === "welcome"
        ? { setupStep: "aws" as const }
        : {}),
    }
    if (Object.keys(changes).length)
      await ctx.db.patch("installation", installation._id, changes)
    return null
  },
})
export const deferEmail = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireInstallationAdmin(ctx)
    const installation = await findInstallation(ctx)
    if (!installation) throw new ConvexError("Start setup first")
    if (installation.completedAt || installation.setupStep !== "aws")
      throw new ConvexError("Defer email at the AWS step of installation setup")
    if (installation.accountId)
      throw new ConvexError("AWS is already connected")
    await ctx.db.patch("installation", installation._id, {
      emailDeferredAt: installation.emailDeferredAt ?? Date.now(),
      setupStep: "callback",
    })
    return null
  },
})

export const navigate = mutation({
  args: { step: setupStepValue },
  returns: v.null(),
  handler: async (ctx, { step }) => {
    await requireInstallationAdmin(ctx)
    const installation = await findInstallation(ctx)
    if (!installation) throw new ConvexError("Start setup first")
    if (
      ["callback", "resources", "team", "domain"].includes(step) &&
      !installation.accountId &&
      (!installation.emailDeferredAt || ["resources", "domain"].includes(step))
    )
      throw new ConvexError("Connect AWS first")
    if (
      ["resources", "team", "domain"].includes(step) &&
      !installation.environmentCheckedAt
    )
      throw new ConvexError("Check your public callback URL first")
    if (
      ["team", "domain"].includes(step) &&
      !installation.emailDeferredAt &&
      !allRegionsReady(await listRegions(ctx))
    )
      throw new ConvexError("Finish setting up your AWS regions first")
    await ctx.db.patch("installation", installation._id, { setupStep: step })
    return null
  },
})
export const adminContext = internalQuery({
  args: {},
  returns: v.union(v.null(), schema.doc("installation")),
  handler: async (ctx) => {
    await requireInstallationAdmin(ctx)
    return findInstallation(ctx)
  },
})
export const connection = internalQuery({
  args: {},
  returns: schema.doc("installation"),
  handler: (ctx) => requireConnection(ctx),
})
export const recordPolicyRevision = internalMutation({
  args: { credentialRevision: v.number(), policyRevision: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const installation = await requireConnection(ctx)
    // A check made with replaced credentials proves nothing about the new ones.
    if (installation.credentialRevision !== args.credentialRevision)
      throw new ConvexError("Setup changed. Reload and try again.")
    await ctx.db.patch("installation", installation._id, {
      policyRevision: args.policyRevision,
    })
    return null
  },
})
export const saveEnvironment = internalMutation({
  args: { siteUrl: v.string(), callbackOrigin: v.string() },
  returns: v.id("installation"),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const installation = await findInstallation(ctx)
    if (installation) {
      const provisioned = await listRegions(ctx)
      if (
        provisioned.some((region) => region.topicArn) &&
        (installation.siteUrl !== args.siteUrl ||
          installation.callbackOrigin !== args.callbackOrigin)
      )
        throw new ConvexError(
          "Connection URLs are already in use. Keep the configured origins while provisioning resources."
        )
      await ctx.db.patch("installation", installation._id, {
        ...args,
        environmentCheckedAt: Date.now(),
        ...(!installation.completedAt
          ? {
              setupStep: installation.emailDeferredAt
                ? ("team" as const)
                : ("resources" as const),
            }
          : {}),
      })
      return installation._id
    }
    return ctx.db.insert("installation", {
      key: "installation",
      ...args,
      environmentCheckedAt: Date.now(),
      credentialRevision: 0,
    })
  },
})
/** What moving the public URL needs: a connected installation, a new valid
    origin, and no AWS setup running that still uses the current one. */
async function callbackMove(
  ctx: QueryCtx | MutationCtx,
  callbackOrigin: string
) {
  await requireInstallationAdmin(ctx)
  const installation = await findInstallation(ctx)
  if (!installation) throw new ConvexError("Start setup first")
  // Tracking CNAMEs point at its hostname, so it cannot carry a port.
  try {
    trackingTarget(callbackOrigin)
  } catch {
    throw new ConvexError("Use an HTTPS URL without a port, path, or query")
  }
  if (callbackOrigin === installation.callbackOrigin)
    throw new ConvexError("This is already the public URL")
  const regions = await listRegions(ctx)
  const inbound = await ctx.db
    .query("inboundRegions")
    .withIndex("by_region")
    .take(20)
  const domainRunning = await ctx.db
    .query("domains")
    .withIndex("by_deleted_and_phase", (q) =>
      q.eq("deleted", false).eq("phase", "running")
    )
    .first()
  if (
    domainRunning ||
    regions.some((region) => region.phase === "running") ||
    inbound.some((row) => row.phase === "running")
  )
    throw new ConvexError(
      "Wait for running AWS and domain setup to finish, then change the URL"
    )
  return { installation, regions, inbound }
}
/** Checked before the new URL is probed, so a refusal costs no request. */
export const checkCallbackMove = internalQuery({
  args: { callbackOrigin: v.string() },
  returns: v.null(),
  handler: async (ctx, { callbackOrigin }) => {
    await callbackMove(ctx, callbackOrigin)
    return null
  },
})
/** Moves the installation to a public URL the caller proved reaches this
    deployment. Every region provisioned before subscribes the new URL again,
    and counts as unconfirmed until SNS confirms it, as in first-time setup;
    domains then refresh their tracking records. The IAM policy grants no
    `sns:Unsubscribe`, so the old URL's subscriptions stay in SNS. */
export const moveCallbackOrigin = internalMutation({
  args: { callbackOrigin: v.string() },
  returns: v.null(),
  handler: async (ctx, { callbackOrigin }) => {
    const { installation, regions, inbound } = await callbackMove(
      ctx,
      callbackOrigin
    )
    await ctx.db.patch("installation", installation._id, {
      callbackOrigin,
      environmentCheckedAt: Date.now(),
    })
    const subscribed = regions.filter((region) => region.topicArn)
    for (const region of subscribed)
      await ctx.db.patch("sesRegions", region._id, {
        phase: "running",
        error: undefined,
        callbackConfirmed: false,
        subscriptionArn: undefined,
      })
    for (const row of inbound)
      if (row.operation === "provision" && row.topicArn)
        await resubscribe(ctx, row)
    if (regions.length || inbound.length)
      await startWorkflow(ctx, internal.ses.workflows.moveCallbackOrigin, {
        regionIds: subscribed.map((region) => region._id),
        regions: regions.map((region) => region.region),
      })
    return null
  },
})
export const activateConnection = internalMutation({
  args: {
    revision: v.number(),
    accountId: v.string(),
    credentialKind: v.union(v.literal("role"), v.literal("keys")),
    encryptedCredentials: v.optional(v.string()),
    accessKeyLast4: v.optional(v.string()),
    defaultRegion: regionValue,
    regions: v.array(v.object({ region: regionValue, quota: quotaValue })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const installation = await findInstallation(ctx)
    if (!installation || installation.credentialRevision !== args.revision)
      throw new ConvexError("Setup changed. Reload and try again.")
    if (installation.accountId && installation.accountId !== args.accountId)
      throw new ConvexError("An installation can use only one AWS account")
    const existing = await listRegions(ctx)
    if (
      existing.some(
        (r) => !args.regions.some((next) => next.region === r.region)
      )
    )
      throw new ConvexError(
        "Keep existing regions enabled; resources may still use them"
      )
    await ctx.db.patch("installation", installation._id, {
      accountId: args.accountId,
      emailDeferredAt: undefined,
      credentialKind: args.credentialKind,
      encryptedCredentials: args.encryptedCredentials,
      accessKeyLast4: args.accessKeyLast4,
      defaultRegion: args.defaultRegion,
      credentialRevision: args.revision + 1,
      // New credentials may belong to a user with an older policy.
      policyRevision: undefined,
      ...(!installation.completedAt ? { setupStep: "callback" as const } : {}),
    })
    for (const item of args.regions) {
      const current = existing.find((r) => r.region === item.region)
      if (current)
        await ctx.db.patch("sesRegions", current._id, {
          quota: item.quota,
          checkedAt: Date.now(),
        })
      else
        await ctx.db.insert("sesRegions", {
          ...item,
          checkedAt: Date.now(),
          phase: "pending",
          callbackConfirmed: false,
        })
    }
    return null
  },
})
export const provisionRegion = mutation({
  args: { region: regionValue },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const installation = await findInstallation(ctx)
    if (!installation?.accountId) throw new ConvexError("Connect AWS first")
    trackingTarget(installation.callbackOrigin)
    const region = await findRegion(ctx, args.region)
    if (!region) throw new ConvexError("Enable this region first")
    if (region.phase === "running") return null
    await ctx.db.patch("sesRegions", region._id, {
      phase: "running",
      error: undefined,
    })
    await startWorkflow(ctx, internal.ses.workflows.provisionRegion, {
      regionId: region._id,
    })
    return null
  },
})
export const complete = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, { organizationId }) => {
    await completeInstallation(ctx, organizationId)
    return null
  },
})
/** A checked callback and team finish deferred-email setup. Email-first setup
    also needs the first domain; DNS review happens in the dashboard. */
export async function completeInstallation(
  ctx: MutationCtx,
  organizationId: string
) {
  await requireInstallationAdmin(ctx)
  await requireTeam(ctx, organizationId, "admin")
  const installation = await findInstallation(ctx)
  if (!installation) throw new ConvexError("Start setup first")
  if (installation.completedAt) return
  if (!installation.environmentCheckedAt)
    throw new ConvexError("Check your public callback URL first")
  if (installation.emailDeferredAt && !installation.accountId) {
    await ctx.db.patch("installation", installation._id, {
      completedAt: Date.now(),
    })
    return
  }
  if (!installation.accountId) throw new ConvexError("Connect AWS first")
  const domains = await ctx.db
    .query("domains")
    .withIndex("by_organizationId_and_deleted_and_name", (q) =>
      q.eq("organizationId", organizationId).eq("deleted", false)
    )
    .take(100)
  /* Domains repeat their region, and the team's tenant is pinned to one
     region, so both lookups answer the same question over and over. */
  const tenants = new Map<string, Doc<"sesTenants"> | null>()
  const regions = new Map<string, Doc<"sesRegions"> | null>()
  let ready = false
  for (const domain of domains) {
    const tenantRegion = installation.defaultRegion ?? domain.region
    if (!tenants.has(tenantRegion))
      tenants.set(
        tenantRegion,
        await findTenant(ctx, organizationId, tenantRegion)
      )
    if (!regions.has(domain.region))
      regions.set(domain.region, await findRegion(ctx, domain.region))
    const tenant = tenants.get(tenantRegion)!
    const region = regions.get(domain.region)!
    if (tenant && tenantProvisioned(tenant) && region?.phase === "ready") {
      ready = true
      break
    }
  }
  if (!ready)
    throw new ConvexError(
      "Provision the team tenant and add your first domain before continuing"
    )
  await ctx.db.patch("installation", installation._id, {
    completedAt: Date.now(),
  })
}
