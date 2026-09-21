import { v, ConvexError } from "convex/values"
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import schema from "./schema"
import { requireTeam, requireInstallationAdmin } from "./access"
import { regionValue, teamTenantName } from "./ses/contracts"
import { workflow } from "./ses/workflows"
import type { Doc, Id } from "./_generated/dataModel"

export async function ensureTeamTenant(
  ctx: MutationCtx,
  organizationId: string,
  region: Doc<"sesRegions">["region"]
) {
  const configuredRegion = await ctx.db
    .query("sesRegions")
    .withIndex("by_region", (q) => q.eq("region", region))
    .unique()
  if (!configuredRegion || configuredRegion.phase !== "ready")
    throw new ConvexError(
      "Provision this AWS region before creating a team tenant"
    )
  let tenant = await ctx.db
    .query("sesTenants")
    .withIndex("by_organizationId_and_region", (q) =>
      q.eq("organizationId", organizationId).eq("region", region)
    )
    .unique()
  if (tenant?.operation === "remove" || tenant?.deleted)
    throw new ConvexError("This team's SES tenant is being removed")
  if (!tenant) {
    const installation = await ctx.db
      .query("installation")
      .withIndex("by_key", (q) => q.eq("key", "installation"))
      .unique()
    if (!installation?.accountId) throw new ConvexError("Connect AWS first")
    const id = await ctx.db.insert("sesTenants", {
      organizationId,
      region,
      name: teamTenantName(installation._id, organizationId),
      phase: "pending",
      operation: "provision",
      generation: 0,
      deleted: false,
    })
    tenant = (await ctx.db.get(id))!
  }
  if (tenant.phase === "pending" || tenant.phase === "failed") {
    const generation = tenant.generation + 1
    await ctx.db.patch(tenant._id, {
      phase: "running",
      generation,
      error: undefined,
    })
    await workflow.start(ctx, internal.ses.workflows.tenantOperation, {
      tenantId: tenant._id,
      generation,
    })
  }
  return tenant._id
}
/** Accepted deletion remains durable even after the Better Auth team no longer exists. */
export async function removeTeamTenants(
  ctx: MutationCtx,
  organizationId: string
) {
  const tenants = await ctx.db
    .query("sesTenants")
    .withIndex("by_organizationId_and_region", (q) =>
      q.eq("organizationId", organizationId)
    )
    .take(5)
  if (tenants.some((tenant) => tenant.phase === "running"))
    throw new ConvexError(
      "Wait for this team's AWS setup to finish before deleting the team"
    )
  for (const tenant of tenants) {
    if (tenant.deleted) continue
    const generation = tenant.generation + 1
    await ctx.db.patch(tenant._id, {
      phase: "running",
      operation: "remove",
      generation,
      error: undefined,
    })
    await workflow.start(ctx, internal.ses.workflows.tenantOperation, {
      tenantId: tenant._id,
      generation,
    })
  }
}
export const list = query({
  args: { organizationId: v.string() },
  returns: v.array(schema.doc("sesTenants")),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    return ctx.db
      .query("sesTenants")
      .withIndex("by_organizationId_and_region", (q) =>
        q.eq("organizationId", organizationId)
      )
      .take(5)
  },
})
export const retry = mutation({
  args: { organizationId: v.string(), region: regionValue },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, true)
    const row = await ctx.db
      .query("sesTenants")
      .withIndex("by_organizationId_and_region", (q) =>
        q.eq("organizationId", args.organizationId).eq("region", args.region)
      )
      .unique()
    if (row?.phase === "ready" && !row.deleted && row.operation === "provision")
      await ctx.db.patch(row._id, { phase: "pending" })
    await ensureTeamTenant(ctx, args.organizationId, args.region)
    return null
  },
})
export const cleanup = query({
  args: {},
  returns: v.array(schema.doc("sesTenants")),
  handler: async (ctx) => {
    await requireInstallationAdmin(ctx)
    return ctx.db
      .query("sesTenants")
      .withIndex("by_operation_and_deleted_and_phase", (q) =>
        q.eq("operation", "remove").eq("deleted", false).eq("phase", "failed")
      )
      .take(25)
  },
})
export const retryCleanup = mutation({
  args: { id: v.id("sesTenants") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireInstallationAdmin(ctx)
    const tenant = await ctx.db.get(id)
    if (!tenant || tenant.deleted || tenant.operation !== "remove")
      throw new ConvexError("Tenant cleanup not found")
    if (tenant.phase === "running") return null
    const generation = tenant.generation + 1
    await ctx.db.patch(id, { phase: "running", generation, error: undefined })
    await workflow.start(ctx, internal.ses.workflows.tenantOperation, {
      tenantId: id,
      generation,
    })
    return null
  },
})
export const get = internalQuery({
  args: { id: v.id("sesTenants") },
  returns: v.union(v.null(), schema.doc("sesTenants")),
  handler: (ctx, { id }) => ctx.db.get(id),
})
export const prepareDomain = internalMutation({
  args: { domainId: v.id("domains") },
  returns: v.union(v.null(), v.id("sesTenants")),
  handler: async (ctx, { domainId }): Promise<Id<"sesTenants"> | null> => {
    const domain = await ctx.db.get(domainId)
    if (!domain || domain.deleted) throw new ConvexError("Domain not found")
    if (domain.operation === "remove" || domain.operation === "settings")
      return null
    const tenantId = await ensureTeamTenant(
      ctx,
      domain.organizationId,
      domain.region
    )
    await ctx.db.patch(domainId, { tenantId, tenantAssociated: false })
    return tenantId
  },
})
export const finish = internalMutation({
  args: {
    id: v.id("sesTenants"),
    generation: v.number(),
    arn: v.optional(v.string()),
    providerId: v.optional(v.string()),
    sendingStatus: v.optional(v.string()),
    removed: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.id)
    if (
      !tenant ||
      tenant.generation !== args.generation ||
      tenant.phase !== "running"
    )
      return null
    await ctx.db.patch(args.id, {
      phase: args.error ? "failed" : "ready",
      error: args.error,
      checkedAt: Date.now(),
      ...(args.arn ? { arn: args.arn } : {}),
      ...(args.providerId ? { providerId: args.providerId } : {}),
      ...(args.sendingStatus ? { sendingStatus: args.sendingStatus } : {}),
      ...(args.removed ? { deleted: true, sendingStatus: "DISABLED" } : {}),
    })
    return null
  },
})
export const observe = internalMutation({
  args: {
    id: v.id("sesTenants"),
    generation: v.number(),
    sendingStatus: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.id)
    if (
      tenant?.generation === args.generation &&
      tenant.phase === "ready" &&
      tenant.operation === "provision" &&
      !tenant.deleted
    )
      await ctx.db.patch(args.id, {
        ...(args.error ? { phase: "failed" as const, error: args.error } : {}),
        ...(args.sendingStatus ? { sendingStatus: args.sendingStatus } : {}),
        checkedAt: Date.now(),
      })
    return null
  },
})
