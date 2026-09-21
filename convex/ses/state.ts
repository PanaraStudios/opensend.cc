import { internalQuery, internalMutation } from "../_generated/server"
import { v } from "convex/values"
import schema from "../schema"
export const region = internalQuery({
  args: { id: v.id("sesRegions") },
  returns: schema.doc("sesRegions"),
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get("sesRegions", id)
    if (!r) throw new Error("Region not found")
    return r
  },
})
export const patchRegion = internalMutation({
  args: {
    id: v.id("sesRegions"),
    changes: schema
      .doc("sesRegions")
      .omit("_id", "_creationTime", "region")
      .partial(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("sesRegions", args.id, args.changes)
    return null
  },
})
export const topic = internalQuery({
  args: { arn: v.string() },
  returns: v.union(v.null(), schema.doc("sesRegions")),
  handler: (ctx, { arn }) =>
    ctx.db
      .query("sesRegions")
      .withIndex("by_topicArn", (q) => q.eq("topicArn", arn))
      .unique(),
})
export const ingest = internalMutation({
  args: { topicArn: v.string(), messageId: v.string(), message: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const region = await ctx.db
      .query("sesRegions")
      .withIndex("by_topicArn", (q) => q.eq("topicArn", args.topicArn))
      .unique()
    if (!region) throw new Error("Unknown SNS topic")
    const existing = await ctx.db
      .query("sesEvents")
      .withIndex("by_topicArn_and_messageId", (q) =>
        q.eq("topicArn", args.topicArn).eq("messageId", args.messageId)
      )
      .unique()
    if (!existing) await ctx.db.insert("sesEvents", args)
    return null
  },
})
