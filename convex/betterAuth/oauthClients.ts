import { v, ConvexError } from "convex/values"
import { mutation, query } from "./_generated/server"
import { invalidate } from "./oauth"
import { parseScopes, validateCallback } from "../../lib/oauth/policy"
export const registration = {
  clientId: v.string(),
  name: v.string(),
  redirects: v.array(v.string()),
  scope: v.string(),
  method: v.union(
    v.literal("none"),
    v.literal("client_secret_basic"),
    v.literal("client_secret_post")
  ),
  secretHash: v.optional(v.string()),
}
export const register = mutation({
  args: registration,
  returns: v.null(),
  handler: async (ctx, args) => {
    if (
      !args.name.trim() ||
      args.name.length > 200 ||
      args.redirects.length < 1 ||
      args.redirects.length > 10
    )
      throw new ConvexError("Invalid application metadata")
    const scopes = parseScopes(args.scope)
    args.redirects.forEach(validateCallback)
    await ctx.db.insert("oauthClient", {
      clientId: args.clientId,
      name: args.name.trim(),
      redirectUris: args.redirects,
      scopes: [...scopes, "offline_access"],
      clientSecret: args.secretHash,
      tokenEndpointAuthMethod: args.method,
      public: args.method === "none",
      requirePKCE: true,
      skipConsent: true,
      disabled: false,
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    return null
  },
})
export const list = query({
  args: {},
  returns: v.array(
    v.object({ clientId: v.string(), name: v.string(), disabled: v.boolean() })
  ),
  handler: async (ctx) =>
    (await ctx.db.query("oauthClient").take(100)).map((c) => ({
      clientId: c.clientId,
      name: c.name ?? "Application",
      disabled: !!c.disabled,
    })),
})
export const maintain = mutation({
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
    secretHash: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const c = await ctx.db
      .query("oauthClient")
      .withIndex("clientId", (q) => q.eq("clientId", args.clientId))
      .unique()
    if (!c) throw new ConvexError("Application not found")
    await invalidate(ctx, `client:${c.clientId}`)
    if (args.operation === "delete") await ctx.db.delete(c._id)
    else if (args.operation === "disable")
      await ctx.db.patch(c._id, { disabled: true })
    else if (args.operation === "rotate") {
      if (c.public || !args.secretHash)
        throw new ConvexError("Only confidential applications have credentials")
      await ctx.db.patch(c._id, { clientSecret: args.secretHash })
    } else {
      if (
        args.name !== undefined &&
        (!args.name.trim() || args.name.length > 200)
      )
        throw new ConvexError("Invalid application name")
      if (
        args.redirects &&
        (args.redirects.length < 1 || args.redirects.length > 10)
      )
        throw new ConvexError("Use 1 to 10 callbacks")
      args.redirects?.forEach(validateCallback)
      await ctx.db.patch(c._id, {
        ...(args.name ? { name: args.name.trim() } : {}),
        ...(args.redirects ? { redirectUris: args.redirects } : {}),
        ...(args.scope
          ? { scopes: [...parseScopes(args.scope), "offline_access"] }
          : {}),
        updatedAt: Date.now(),
      })
    }
    return null
  },
})
