import { v } from "convex/values"
import { internalMutation, internalQuery } from "../_generated/server"
import { internal } from "../_generated/api"

/** No session is required: the HTTP action authenticates Meta's signature. */
export const appSecret = internalQuery({
  args: {},
  returns: v.union(v.null(), v.string()),
  handler: async (ctx) =>
    (
      await ctx.db
        .query("metaApps")
        .withIndex("by_key", (q) => q.eq("key", "metaApp"))
        .unique()
    )?.encryptedAppSecret ?? null,
})

export const store = internalMutation({
  args: { body: v.string(), bodyHash: v.string(), object: v.string() },
  returns: v.id("metaWebhookEvents"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("metaWebhookEvents")
      .withIndex("by_bodyHash", (q) => q.eq("bodyHash", args.bodyHash))
      .unique()
    if (existing) return existing._id
    const id = await ctx.db.insert("metaWebhookEvents", {
      ...args,
      receivedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.meta.projection.project, { id })
    return id
  },
})
