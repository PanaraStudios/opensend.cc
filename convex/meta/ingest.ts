import { findMetaApp } from "./app"
import { v } from "convex/values"
import { internalMutation, internalQuery } from "../_generated/server"
import { internal } from "../_generated/api"
import { hasCallingChanges } from "../../lib/meta/calling"
import { object } from "../../lib/meta/parse"

/** No session is required: the HTTP action authenticates Meta's signature. */
export const appSecret = internalQuery({
  args: {},
  returns: v.union(v.null(), v.string()),
  handler: async (ctx) => (await findMetaApp(ctx))?.encryptedAppSecret ?? null,
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
    // Most deliveries are message statuses; only wake calling when it has work.
    let calling = args.object === "whatsapp_business_account"
    if (calling)
      try {
        calling = hasCallingChanges(object(JSON.parse(args.body)))
      } catch {
        // Let the projector see a body this check could not read.
      }
    if (calling)
      await ctx.scheduler.runAfter(0, internal.calling.projection.project, {
        id,
      })
    return id
  },
})
