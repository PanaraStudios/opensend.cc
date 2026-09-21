import { v, ConvexError } from "convex/values"
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server"
import {
  installationAccess,
  requireInstallationAdmin,
  requireTeam,
} from "./access"
import schema from "./schema"
import { quotaValue, regionValue, setupStepValue } from "./ses/contracts"
import { internal } from "./_generated/api"
import { workflow } from "./ses/workflows"
import type { QueryCtx, MutationCtx } from "./_generated/server"

export const findInstallation = (ctx: QueryCtx | MutationCtx) =>
  ctx.db
    .query("installation")
    .withIndex("by_key", (q) => q.eq("key", "installation"))
    .unique()
const publicInstallation = schema
  .doc("installation")
  .omit("encryptedCredentials", "wrappedEncryptionKey")
export const status = query({
  args: {},
  returns: v.object({
    admin: v.boolean(),
    suggestedCallbackOrigin: v.string(),
    installation: v.union(v.null(), publicInstallation),
    regions: v.array(schema.doc("sesRegions")),
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
          siteUrl: installation.siteUrl,
          callbackOrigin: installation.callbackOrigin,
          environmentCheckedAt: installation.environmentCheckedAt,
          completedAt: installation.completedAt,
          accountId: installation.accountId,
          credentialKind: installation.credentialKind,
          accessKeyLast4: installation.accessKeyLast4,
          credentialRevision: installation.credentialRevision,
          defaultRegion: installation.defaultRegion,
          setupStep: installation.setupStep,
        }
      : null
    return {
      admin,
      suggestedCallbackOrigin:
        process.env.SES_CALLBACK_ORIGIN || process.env.CONVEX_SITE_URL || "",
      installation: safe,
      regions: await ctx.db.query("sesRegions").withIndex("by_region").take(20),
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
    // Concurrent setup clicks must never replace an already-active key.
    if (!installation.wrappedEncryptionKey)
      await ctx.db.patch(installation._id, {
        wrappedEncryptionKey: args.wrappedKey,
      })
    if (!installation.setupStep || installation.setupStep === "welcome")
      await ctx.db.patch(installation._id, { setupStep: "aws" })
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
      !installation.accountId
    )
      throw new ConvexError("Connect AWS first")
    if (
      ["resources", "team", "domain"].includes(step) &&
      !installation.environmentCheckedAt
    )
      throw new ConvexError("Check your delivery updates URL first")
    if (["team", "domain"].includes(step)) {
      const regions = await ctx.db
        .query("sesRegions")
        .withIndex("by_region")
        .take(20)
      if (!regions.length || regions.some((region) => region.phase !== "ready"))
        throw new ConvexError("Finish setting up your AWS regions first")
    }
    await ctx.db.patch(installation._id, { setupStep: step })
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
  handler: async (ctx) => {
    const installation = await findInstallation(ctx)
    if (!installation?.accountId || !installation.credentialKind)
      throw new ConvexError("Connect AWS first")
    return installation
  },
})
export const saveEnvironment = internalMutation({
  args: { siteUrl: v.string(), callbackOrigin: v.string() },
  returns: v.id("installation"),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const installation = await findInstallation(ctx)
    if (installation) {
      const provisioned = await ctx.db
        .query("sesRegions")
        .withIndex("by_region")
        .take(20)
      if (
        provisioned.some((region) => region.topicArn) &&
        (installation.siteUrl !== args.siteUrl ||
          installation.callbackOrigin !== args.callbackOrigin)
      )
        throw new ConvexError(
          "Connection URLs are already in use. Keep the configured origins while provisioning resources."
        )
      await ctx.db.patch(installation._id, {
        ...args,
        environmentCheckedAt: Date.now(),
        ...(!installation.completedAt
          ? { setupStep: "resources" as const }
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
    const existing = await ctx.db
      .query("sesRegions")
      .withIndex("by_region")
      .take(20)
    if (
      existing.some(
        (r) => !args.regions.some((next) => next.region === r.region)
      )
    )
      throw new ConvexError(
        "Keep existing regions enabled; resources may still use them"
      )
    await ctx.db.patch(installation._id, {
      accountId: args.accountId,
      credentialKind: args.credentialKind,
      encryptedCredentials: args.encryptedCredentials,
      accessKeyLast4: args.accessKeyLast4,
      defaultRegion: args.defaultRegion,
      credentialRevision: args.revision + 1,
      ...(!installation.completedAt ? { setupStep: "callback" as const } : {}),
    })
    for (const item of args.regions) {
      const current = existing.find((r) => r.region === item.region)
      if (current)
        await ctx.db.patch(current._id, {
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
    if (!installation.callbackOrigin.startsWith("https://"))
      throw new ConvexError(
        "Configure a public HTTPS callback before provisioning AWS"
      )
    const region = await ctx.db
      .query("sesRegions")
      .withIndex("by_region", (q) => q.eq("region", args.region))
      .unique()
    if (!region) throw new ConvexError("Enable this region first")
    if (region.phase === "running") return null
    await ctx.db.patch(region._id, { phase: "running", error: undefined })
    await workflow.start(ctx, internal.ses.workflows.provisionRegion, {
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
/** Setup ends once the first domain is saved; DNS and identity review happen in the dashboard. */
export async function completeInstallation(
  ctx: MutationCtx,
  organizationId: string
) {
  await requireInstallationAdmin(ctx)
  await requireTeam(ctx, organizationId, true)
  const installation = await findInstallation(ctx)
  if (!installation?.accountId) throw new ConvexError("Connect AWS first")
  if (installation.completedAt) return
  if (!installation.environmentCheckedAt)
    throw new ConvexError("Check delivery updates first")
  const domains = await ctx.db
    .query("domains")
    .withIndex("by_organizationId_and_deleted_and_name", (q) =>
      q.eq("organizationId", organizationId).eq("deleted", false)
    )
    .take(100)
  let ready = false
  for (const domain of domains) {
    const tenant = await ctx.db
      .query("sesTenants")
      .withIndex("by_organizationId_and_region", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("region", installation.defaultRegion ?? domain.region)
      )
      .unique()
    const region = await ctx.db
      .query("sesRegions")
      .withIndex("by_region", (q) => q.eq("region", domain.region))
      .unique()
    if (
      tenant?.phase === "ready" &&
      region?.phase === "ready" &&
      !tenant.deleted &&
      tenant.operation === "provision" &&
      tenant.organizationId === organizationId &&
      tenant.region === (installation.defaultRegion ?? domain.region)
    ) {
      ready = true
      break
    }
  }
  if (!ready)
    throw new ConvexError(
      "Provision the team tenant and add your first domain before continuing"
    )
  await ctx.db.patch(installation._id, { completedAt: Date.now() })
}
