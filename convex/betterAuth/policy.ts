import { v, ConvexError } from "convex/values"
import { mutation, query } from "./_generated/server"
import type { QueryCtx, MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"

export async function sessionUser(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
) {
  const id = ctx.db.normalizeId("session", sessionId)
  const session = id ? await ctx.db.get("session", id) : null
  if (!session || session.expiresAt <= Date.now())
    throw new ConvexError("Sign in again")
  const user = await ctx.db.get("user", session.userId as Id<"user">)
  if (!user || !user.emailVerified)
    throw new ConvexError("Verify your email before continuing")
  return { user, session }
}
export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  organizationId: string,
  owner = false
) {
  const actor = await sessionUser(ctx, sessionId)
  const member = await ctx.db
    .query("member")
    .withIndex("by_organizationId_and_userId", (q) =>
      q.eq("organizationId", organizationId).eq("userId", actor.user._id)
    )
    .unique()
  if (!member || (owner && member.role !== "owner"))
    throw new ConvexError("You do not have permission")
  const sso = await ctx.db
    .query("sso")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .unique()
  if (sso?.enforced) {
    const proof = await ctx.db
      .query("ssoProof")
      .withIndex("by_sessionId_and_organizationId", (q) =>
        q.eq("sessionId", sessionId).eq("organizationId", organizationId)
      )
      .unique()
    if (proof?.revision !== sso.revision) throw new ConvexError("SSO_REQUIRED")
  }
  return { ...actor, member }
}

/** Runs from the adapter's user-create trigger, in the insertion transaction. */
export const admitUser = mutation({
  args: { userId: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, email }) => {
    const setup = await ctx.db
      .query("bootstrap")
      .withIndex("by_key", (q) => q.eq("key", "initial-account"))
      .unique()
    if (!setup) {
      await ctx.db.insert("bootstrap", { key: "initial-account", userId })
      return null
    }
    const invitations = await ctx.db
      .query("invitation")
      .withIndex("email", (q) => q.eq("email", email.toLowerCase()))
      .take(100)
    if (
      !invitations.some(
        (i) => i.status === "pending" && i.expiresAt > Date.now()
      )
    )
      throw new ConvexError("Registration requires a valid invitation")
    return null
  },
})
export const checkSession = query({
  args: { sessionId: v.string() },
  returns: v.object({
    userId: v.string(),
    email: v.string(),
    name: v.string(),
    mfa: v.boolean(),
    createdAt: v.number(),
  }),
  handler: async (ctx, { sessionId }) => {
    const { user } = await sessionUser(ctx, sessionId)
    return {
      userId: user._id,
      email: user.email,
      name: user.name,
      mfa: !!user.twoFactorEnabled,
      createdAt: user.createdAt,
    }
  },
})
