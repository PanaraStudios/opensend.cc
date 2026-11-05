import { v } from "convex/values"
import { query, mutation } from "./_generated/server"
import { components } from "./_generated/api"
import { sessionId } from "./access"
import { grantView } from "./betterAuth/oauth"
export const list = query({
  args: { organizationId: v.optional(v.string()) },
  returns: v.array(grantView),
  handler: async (ctx, args) =>
    ctx.runQuery(components.betterAuth.oauth.list, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
export const disconnect = mutation({
  args: { id: v.string(), organizationId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.oauth.disconnect, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
