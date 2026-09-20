import { v, ConvexError } from "convex/values"
import { query, mutation } from "./_generated/server"
import { requireMember, sessionUser } from "./policy"
const configValue = v.object({
  organizationId: v.string(),
  issuer: v.string(),
  clientId: v.string(),
  encryptedSecret: v.string(),
  revision: v.string(),
  tested: v.boolean(),
  enforced: v.boolean(),
})
export const connection = query({
  args: { organizationId: v.string() },
  returns: v.union(v.null(), configValue),
  handler: async (ctx, { organizationId }) => {
    const c = await ctx.db
      .query("sso")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .unique()
    if (!c) return null
    return {
      organizationId,
      issuer: c.issuer,
      clientId: c.clientId,
      encryptedSecret: c.encryptedSecret,
      revision: c.revision,
      tested: c.tested,
      enforced: c.enforced,
    }
  },
})
export const save = mutation({
  args: {
    sessionId: v.string(),
    organizationId: v.string(),
    issuer: v.string(),
    clientId: v.string(),
    encryptedSecret: v.string(),
    revision: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.sessionId, args.organizationId, true)
    const old = await ctx.db
      .query("sso")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .unique()
    const data = {
      organizationId: args.organizationId,
      issuer: args.issuer,
      clientId: args.clientId,
      encryptedSecret: args.encryptedSecret,
      revision: args.revision,
      tested: false,
      enforced: false,
    }
    if (old) await ctx.db.replace("sso", old._id, data)
    else await ctx.db.insert("sso", data)
    return null
  },
})
/** Only called after Generic OAuth has verified state and the signed ID token. */
export const complete = mutation({
  args: {
    sessionId: v.string(),
    organizationId: v.string(),
    revision: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await sessionUser(ctx, args.sessionId)
    const c = await ctx.db
      .query("sso")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .unique()
    if (!c || c.revision !== args.revision)
      throw new ConvexError("Connection changed; sign in again")
    const member = await ctx.db
      .query("member")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", user._id)
      )
      .unique()
    const invitations = await ctx.db
      .query("invitation")
      .withIndex("email", (q) => q.eq("email", user.email))
      .take(100)
    if (
      !member &&
      !invitations.some(
        (i) =>
          i.organizationId === args.organizationId &&
          i.status === "pending" &&
          i.expiresAt > Date.now()
      )
    )
      throw new ConvexError("You need an invitation to this team")
    const proof = await ctx.db
      .query("ssoProof")
      .withIndex("by_sessionId_and_organizationId", (q) =>
        q
          .eq("sessionId", args.sessionId)
          .eq("organizationId", args.organizationId)
      )
      .unique()
    if (proof)
      await ctx.db.patch("ssoProof", proof._id, { revision: c.revision })
    else await ctx.db.insert("ssoProof", args)
    if (member?.role === "owner")
      await ctx.db.patch("sso", c._id, { tested: true })
    return null
  },
})
export const enforce = mutation({
  args: {
    sessionId: v.string(),
    organizationId: v.string(),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.sessionId, args.organizationId, true)
    const c = await ctx.db
      .query("sso")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .unique()
    if (!c || (args.enabled && !c.tested))
      throw new ConvexError("Complete a successful connection test first")
    await ctx.db.patch("sso", c._id, { enforced: args.enabled })
    return null
  },
})
export const recover = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const c = await ctx.db
      .query("sso")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .unique()
    if (c)
      await ctx.db.patch("sso", c._id, {
        enforced: false,
        tested: false,
        revision: `${c.revision}-recovered`,
      })
    return null
  },
})

/** A team-admin-controlled IdP is not a global authority over existing users. */
export const authorizeIdentity = query({
  args: {
    organizationId: v.string(),
    revision: v.string(),
    accountId: v.string(),
    email: v.string(),
    initiatorSessionId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("sso")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .unique()
    if (!connection || connection.revision !== args.revision)
      throw new ConvexError("Connection changed; start sign-in again")
    const user = await ctx.db
      .query("user")
      .withIndex("email_name", (q) => q.eq("email", args.email))
      .unique()
    const invitations = await ctx.db
      .query("invitation")
      .withIndex("email", (q) => q.eq("email", args.email))
      .take(100)
    const invited = invitations.some(
      (i) =>
        i.organizationId === args.organizationId &&
        i.status === "pending" &&
        i.expiresAt > Date.now()
    )
    const member = user
      ? await ctx.db
          .query("member")
          .withIndex("by_organizationId_and_userId", (q) =>
            q.eq("organizationId", args.organizationId).eq("userId", user._id)
          )
          .unique()
      : null
    if (!member && !invited)
      throw new ConvexError("A team membership or invitation is required")
    const linked = await ctx.db
      .query("account")
      .withIndex("accountId_providerId", (q) =>
        q.eq("accountId", args.accountId).eq("providerId", args.organizationId)
      )
      .unique()
    if (linked) {
      if (!user || linked.userId !== user._id || !user.emailVerified)
        throw new ConvexError(
          "The provider identity does not match this account"
        )
      return null
    }
    if (user) {
      if (!args.initiatorSessionId)
        throw new ConvexError(
          "Sign in to your existing account before connecting SSO"
        )
      const initiator = await sessionUser(ctx, args.initiatorSessionId)
      if (initiator.user._id !== user._id)
        throw new ConvexError(
          "Sign in to the matching account before connecting SSO"
        )
    }
    return null
  },
})
