import { env } from "./_generated/server"
import { mutation, query, action } from "./_generated/server"
import { components } from "./_generated/api"
import { v, ConvexError } from "convex/values"
import { sessionId } from "./access"
import { snapshotValue } from "./betterAuth/teams"
import { sendAuthEmail } from "./authEmail"
const role = v.union(v.literal("admin"), v.literal("member"))
export const snapshot = query({
  args: {},
  returns: v.union(v.null(), snapshotValue),
  handler: async (ctx) => {
    try {
      return await ctx.runQuery(components.betterAuth.teams.snapshot, {
        sessionId: await sessionId(ctx),
      })
    } catch (error) {
      // MFA enrollment and logout can revoke the old JWT before the provider
      // fetches its replacement. Render the signed-out state instead of crashing.
      if (
        error instanceof ConvexError &&
        [
          "Sign in again",
          "Sign in to continue",
          "Verify your email before continuing",
        ].includes(String(error.data))
      )
        return null
      throw error
    }
  },
})
export const create = mutation({
  args: { name: v.string() },
  returns: v.string(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.teams.create, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
export const switchTeam = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.teams.switchTeam, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
export const rename = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.teams.rename, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
export const remove = mutation({
  args: { organizationId: v.string(), leave: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.teams.remove, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
export const changeMember = mutation({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
    role: v.optional(role),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.teams.changeMember, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
export const invite = mutation({
  args: { organizationId: v.string(), email: v.string(), role },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invitation = await ctx.runMutation(
      components.betterAuth.teams.invite,
      { ...args, sessionId: await sessionId(ctx) }
    )
    sendAuthEmail({
      to: invitation.email,
      kind: "invite",
      url: `${env.SITE_URL}/invitation?id=${invitation.id}`,
    })
    return null
  },
})
export const cancelInvitation = mutation({
  args: { invitationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.teams.cancelInvitation, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
export const respond = mutation({
  args: { invitationId: v.string(), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.teams.respond, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
export const deleteAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) =>
    ctx.runMutation(components.betterAuth.teams.deleteAccount, {
      sessionId: await sessionId(ctx),
    }),
})
export const uploadAvatar = action({
  args: {
    organizationId: v.string(),
    bytes: v.bytes(),
    contentType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runAction(components.betterAuth.teams.uploadAvatar, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
export const removeAvatar = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    ctx.runMutation(components.betterAuth.teams.setAvatar, {
      ...args,
      sessionId: await sessionId(ctx),
    }),
})
