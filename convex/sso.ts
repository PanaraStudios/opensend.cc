import { env } from "./_generated/server"
import { v, ConvexError } from "convex/values"
import { action, mutation, internalMutation } from "./_generated/server"
import { components } from "./_generated/api"
import { sessionId } from "./access"
import { symmetricEncrypt } from "better-auth/crypto"
export const save = action({
  args: {
    organizationId: v.string(),
    issuer: v.string(),
    clientId: v.string(),
    clientSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = await sessionId(ctx)
    const url = new URL(args.issuer)
    if (
      url.protocol !== "https:" &&
      !(env.ALLOW_LOCAL_OIDC === "true" && url.protocol === "http:")
    )
      throw new ConvexError("Use an HTTPS issuer")
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !args.clientId.trim() ||
      !args.clientSecret
    )
      throw new ConvexError("Enter a valid issuer, client ID, and secret")
    return ctx.runMutation(components.betterAuth.sso.save, {
      sessionId: id,
      organizationId: args.organizationId,
      issuer: args.issuer.replace(/\/$/, ""),
      clientId: args.clientId.trim(),
      encryptedSecret: await symmetricEncrypt({
        key: env.SSO_ENCRYPTION_KEY!,
        data: args.clientSecret,
      }),
      revision: crypto.randomUUID(),
    })
  },
})
export const enforce = mutation({
  args: { organizationId: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.sso.enforce, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
/** Admin CLI only: pnpm convex run sso:recover '{"organizationId":"…"}' */
export const recover = internalMutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: (ctx, args) =>
    ctx.runMutation(components.betterAuth.sso.recover, args),
})
