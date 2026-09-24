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
import {
  findInstallation,
  findRegion,
  findTenant,
  requireTeam,
  requireInstallationAdmin,
} from "./access"
import { findActiveDomain } from "./domains"
import { regionValue, teamTenantName, tenantProvisioned } from "./ses/contracts"
import { startWorkflow } from "./ses/workflows"
import type { Doc, Id } from "./_generated/dataModel"

/** Claim the tenant with a fresh generation, then hand it to the workflow.
    Every tenant write that needs AWS work goes through here. */
async function startTenantOperation(
  ctx: MutationCtx,
  tenant: Doc<"sesTenants">,
  operation?: Doc<"sesTenants">["operation"]
) {
  const generation = tenant.generation + 1
  await ctx.db.patch("sesTenants", tenant._id, {
    phase: "running",
    generation,
    error: undefined,
    ...(operation ? { operation } : {}),
  })
  await startWorkflow(ctx, internal.ses.workflows.tenantOperation, {
    tenantId: tenant._id,
    generation,
  })
}

export async function ensureTeamTenant(
  ctx: MutationCtx,
  organizationId: string,
  region: Doc<"sesRegions">["region"]
) {
  const configuredRegion = await findRegion(ctx, region)
  if (!configuredRegion || configuredRegion.phase !== "ready")
    throw new ConvexError(
      "Provision this AWS region before creating a team tenant"
    )
  let tenant = await findTenant(ctx, organizationId, region)
  if (tenant?.operation === "remove" || tenant?.deleted)
    throw new ConvexError("This team's SES tenant is being removed")
  if (!tenant) {
    const installation = await findInstallation(ctx)
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
    tenant = (await ctx.db.get("sesTenants", id))!
  }
  if (tenant.phase === "pending" || tenant.phase === "failed")
    await startTenantOperation(ctx, tenant)
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
    await startTenantOperation(ctx, tenant, "remove")
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
    const row = await findTenant(ctx, args.organizationId, args.region)
    if (row && tenantProvisioned(row))
      await ctx.db.patch("sesTenants", row._id, { phase: "pending" })
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
    const tenant = await ctx.db.get("sesTenants", id)
    if (!tenant || tenant.deleted || tenant.operation !== "remove")
      throw new ConvexError("Tenant cleanup not found")
    if (tenant.phase === "running") return null
    await startTenantOperation(ctx, tenant)
    return null
  },
})
export const get = internalQuery({
  args: { id: v.id("sesTenants") },
  returns: v.union(v.null(), schema.doc("sesTenants")),
  handler: (ctx, { id }) => ctx.db.get("sesTenants", id),
})
export const prepareDomain = internalMutation({
  args: { domainId: v.id("domains") },
  returns: v.union(v.null(), v.id("sesTenants")),
  handler: async (ctx, { domainId }): Promise<Id<"sesTenants"> | null> => {
    const domain = await findActiveDomain(ctx, domainId)
    if (domain.operation === "remove" || domain.operation === "settings")
      return null
    const tenantId = await ensureTeamTenant(
      ctx,
      domain.organizationId,
      domain.region
    )
    /* A provision can recreate the identity, and a different tenant makes the
       old association meaningless; a refresh only re-checks the association it
       already has, so it must not take a verified domain out of sending. */
    await ctx.db.patch("domains", domainId, {
      tenantId,
      ...(domain.operation === "provision" || domain.tenantId !== tenantId
        ? { tenantAssociated: false }
        : {}),
    })
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
    const tenant = await ctx.db.get("sesTenants", args.id)
    if (
      !tenant ||
      tenant.generation !== args.generation ||
      tenant.phase !== "running"
    )
      return null
    await ctx.db.patch("sesTenants", args.id, {
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
    const tenant = await ctx.db.get("sesTenants", args.id)
    if (tenant?.generation === args.generation && tenantProvisioned(tenant))
      await ctx.db.patch("sesTenants", args.id, {
        ...(args.error ? { phase: "failed" as const, error: args.error } : {}),
        ...(args.sendingStatus ? { sendingStatus: args.sendingStatus } : {}),
        checkedAt: Date.now(),
      })
    return null
  },
})
