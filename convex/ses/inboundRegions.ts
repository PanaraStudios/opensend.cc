import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import schema from "../schema"
import { requireInstallationAdmin } from "../access"
import { startWorkflow } from "./workflows"

/* The only module that writes `inboundRegions`. */

type InboundRegion = Doc<"inboundRegions">
const findInbound = (ctx: MutationCtx, region: InboundRegion["region"]) =>
  ctx.db
    .query("inboundRegions")
    .withIndex("by_region", (q) => q.eq("region", region))
    .unique()

/** Runs a provision or cleanup of the region's inbound infrastructure. */
async function startOperation(
  ctx: MutationCtx,
  region: InboundRegion["region"],
  existing: InboundRegion | null,
  operation: InboundRegion["operation"]
) {
  const changes = { operation, phase: "running" as const, error: undefined }
  let id: Id<"inboundRegions">
  let generation = 1
  if (existing) {
    id = existing._id
    generation = existing.generation + 1
    await ctx.db.patch("inboundRegions", id, { ...changes, generation })
  } else
    id = await ctx.db.insert("inboundRegions", {
      region,
      ...changes,
      generation,
      callbackConfirmed: false,
    })
  await startWorkflow(ctx, internal.ses.workflows.inboundRegion, {
    id,
    generation,
  })
  return id
}
const provisioned = (row: InboundRegion) =>
  row.operation === "provision" && row.phase === "ready"

/** Before a domain operation that needs its region to receive mail: starts
    the region's inbound setup unless it is ready or running, and returns the
    row to wait on. Setup that failed is retried here, once per operation. */
export const prepare = internalMutation({
  args: { domainId: v.id("domains") },
  returns: v.union(v.null(), v.id("inboundRegions")),
  handler: async (ctx, { domainId }) => {
    const domain = await ctx.db.get("domains", domainId)
    if (
      !domain ||
      domain.deleted ||
      !domain.receiving ||
      (domain.operation !== "provision" && domain.operation !== "refresh")
    )
      return null
    const row = await findInbound(ctx, domain.region)
    if (row && (provisioned(row) || row.phase === "running")) return row._id
    return startOperation(ctx, domain.region, row, "provision")
  },
})
/** After the public URL moved: provisions a region's inbound setup again, so
    its topic subscribes the new URL. The callback counts as unconfirmed until
    SNS confirms the new subscription. */
export async function resubscribe(ctx: MutationCtx, row: InboundRegion) {
  await ctx.db.patch("inboundRegions", row._id, {
    callbackConfirmed: false,
    subscriptionArn: undefined,
  })
  await startOperation(ctx, row.region, row, "provision")
}
/** Where a waiting domain operation stands: a finished cleanup is followed
    by a fresh provision, and a finished or failed provision ends the wait. */
export const poll = internalMutation({
  args: { id: v.id("inboundRegions") },
  returns: v.union(v.literal("waiting"), v.literal("settled")),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("inboundRegions", id)
    if (!row) return "settled"
    if (row.phase === "running") return "waiting"
    if (row.operation === "provision") return "settled"
    await startOperation(ctx, row.region, row, "provision")
    return "waiting"
  },
})
export const get = internalQuery({
  args: { id: v.id("inboundRegions") },
  returns: schema.doc("inboundRegions"),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("inboundRegions", id)
    if (!row) throw new Error("Inbound region not found")
    return row
  },
})
const changesValue = schema
  .doc("inboundRegions")
  .pick(
    "bucket",
    "topicArn",
    "subscriptionArn",
    "ruleSet",
    "ownsRuleSet",
    "callbackConfirmed"
  )
  .partial()
/** Progress a running operation records before it goes on, such as the
    topic it is about to subscribe the callback to. */
export const save = internalMutation({
  args: {
    id: v.id("inboundRegions"),
    generation: v.number(),
    changes: changesValue,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("inboundRegions", args.id)
    if (row?.generation === args.generation && row.phase === "running")
      await ctx.db.patch("inboundRegions", args.id, args.changes)
    return null
  },
})
export const finish = internalMutation({
  args: {
    id: v.id("inboundRegions"),
    generation: v.number(),
    changes: changesValue,
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("inboundRegions", args.id)
    if (row?.generation !== args.generation || row.phase !== "running")
      return null
    await ctx.db.patch("inboundRegions", args.id, {
      ...args.changes,
      phase: args.error ? "failed" : "ready",
      error: args.error,
    })
    return null
  },
})
/** The callback confirmed its SNS subscription. */
export const confirm = internalMutation({
  args: { id: v.id("inboundRegions"), subscriptionArn: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("inboundRegions", args.id, {
      callbackConfirmed: true,
      subscriptionArn: args.subscriptionArn,
    })
    return null
  },
})
export const topic = internalQuery({
  args: { arn: v.string() },
  returns: v.union(v.null(), schema.doc("inboundRegions")),
  handler: (ctx, { arn }) =>
    ctx.db
      .query("inboundRegions")
      .withIndex("by_topicArn", (q) => q.eq("topicArn", arn))
      .unique(),
})

/** After a domain's receipt rule is gone: once no domain in the region
    receives mail, the region's setup is wound down. */
export async function cleanupIfUnused(
  ctx: MutationCtx,
  region: InboundRegion["region"]
) {
  const receiving = await ctx.db
    .query("domains")
    .withIndex("by_region_and_deleted_and_receiving", (q) =>
      q.eq("region", region).eq("deleted", false).eq("receiving", true)
    )
    .first()
  if (receiving) return
  const row = await findInbound(ctx, region)
  if (row?.operation === "provision" && row.phase !== "running")
    await startOperation(ctx, region, row, "cleanup")
}

/** Inbound setup per region, for the installation's Amazon SES settings. */
export const list = query({
  args: {},
  returns: v.array(schema.doc("inboundRegions")),
  handler: async (ctx) => {
    await requireInstallationAdmin(ctx)
    // At most one row per supported region.
    return ctx.db.query("inboundRegions").withIndex("by_region").take(20)
  },
})
