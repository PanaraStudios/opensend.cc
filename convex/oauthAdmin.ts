import { v } from "convex/values"
import { internalAction, internalQuery } from "./_generated/server"
import { components } from "./_generated/api"
import { randomToken, tokenHash } from "../lib/oauth/policy"
export const list = internalQuery({
  args: {},
  returns: v.array(
    v.object({ clientId: v.string(), name: v.string(), disabled: v.boolean() })
  ),
  handler: (ctx) => ctx.runQuery(components.betterAuth.oauthClients.list, {}),
})
export const register = internalAction({
  args: {
    name: v.string(),
    redirects: v.array(v.string()),
    scope: v.string(),
    method: v.union(
      v.literal("none"),
      v.literal("client_secret_basic"),
      v.literal("client_secret_post")
    ),
  },
  returns: v.object({
    clientId: v.string(),
    clientSecret: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const clientId = randomToken(),
      clientSecret = args.method === "none" ? undefined : randomToken()
    await ctx.runMutation(components.betterAuth.oauthClients.register, {
      ...args,
      clientId,
      secretHash: clientSecret ? await tokenHash(clientSecret) : undefined,
    })
    return { clientId, clientSecret }
  },
})
export const maintain = internalAction({
  args: {
    clientId: v.string(),
    operation: v.union(
      v.literal("update"),
      v.literal("disable"),
      v.literal("delete"),
      v.literal("rotate")
    ),
    name: v.optional(v.string()),
    redirects: v.optional(v.array(v.string())),
    scope: v.optional(v.string()),
  },
  returns: v.object({ clientSecret: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const clientSecret = args.operation === "rotate" ? randomToken() : undefined
    await ctx.runMutation(components.betterAuth.oauthClients.maintain, {
      ...args,
      secretHash: clientSecret ? await tokenHash(clientSecret) : undefined,
    })
    return { clientSecret }
  },
})
