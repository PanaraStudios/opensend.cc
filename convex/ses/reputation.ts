import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { v, ConvexError } from "convex/values"
import { query, internalMutation } from "../_generated/server"
import { components } from "../_generated/api"
import { requireInstallationAdmin } from "../access"
import { counters, countValue } from "../counts"
import schema from "../schema"

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      tenant: schema.doc("sesTenants"),
      name: v.string(),
      volume: v.number(),
      bounced: v.number(),
      complained: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const now = Date.now()
    const page = await ctx.db
      .query("sesTenants")
      .withIndex("by_deleted", (q) => q.eq("deleted", false))
      .paginate(args.paginationOpts)
    const rows = await Promise.all(
      page.page.map(async (tenant) => {
        const team = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "organization",
          where: [{ field: "_id", value: tenant.organizationId }],
        })
        const totals = await counters.reputation.aggregate.countBatch(
          ctx,
          ["sent", "Permanent", "complained"].map((type) => ({
            namespace: tenant._id,
            bounds: {
              lower: { key: [type, now - 86400000], inclusive: true },
              upper: { key: [type, now], inclusive: true },
            },
          }))
        )
        return {
          tenant,
          name:
            typeof team?.name === "string" ? team.name : tenant.organizationId,
          volume: totals[0],
          bounced: totals[1],
          complained: totals[2],
        }
      })
    )
    return { ...page, page: rows }
  },
})
export const count = query({
  args: {},
  returns: countValue,
  handler: async (ctx) => {
    await requireInstallationAdmin(ctx)
    return { total: null }
  },
})

/** Serialize provider writes. A stalled operation may be retried after its
    lease expires; until a confirmed readback, the local send gate stays shut. */
export const begin = internalMutation({
  args: { id: v.id("sesTenants"), operation: v.string() },
  returns: schema.doc("sesTenants"),
  handler: async (ctx, { id, operation }) => {
    await requireInstallationAdmin(ctx)
    const tenant = await ctx.db.get("sesTenants", id)
    if (
      !tenant ||
      tenant.deleted ||
      tenant.operation !== "provision" ||
      tenant.phase !== "ready" ||
      !tenant.arn
    )
      throw new ConvexError("Team SES tenant is not ready")
    if (
      tenant.statusOperation &&
      Date.now() - (tenant.statusOperationAt ?? 0) < 300000
    )
      throw new ConvexError("A sending status update is already in progress")
    await ctx.db.patch("sesTenants", id, {
      statusOperation: operation,
      statusOperationAt: Date.now(),
      sendingStatus: "DISABLED",
    })
    return tenant
  },
})
export const finish = internalMutation({
  args: {
    id: v.id("sesTenants"),
    operation: v.string(),
    generation: v.number(),
    sendingStatus: v.string(),
    customerSendingStatus: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const tenant = await ctx.db.get("sesTenants", args.id)
    if (
      !tenant ||
      tenant.deleted ||
      tenant.generation !== args.generation ||
      tenant.statusOperation !== args.operation
    )
      return null
    await ctx.db.patch("sesTenants", args.id, {
      sendingStatus: args.sendingStatus,
      customerSendingStatus: args.customerSendingStatus,
      statusOperation: undefined,
      statusOperationAt: undefined,
      checkedAt: Date.now(),
    })
    return null
  },
})
