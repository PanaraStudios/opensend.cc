import { env } from "./_generated/server"
import { mutation, query, action } from "./_generated/server"
import { components } from "./_generated/api"
import { v, ConvexError } from "convex/values"
import {
  sessionId,
  requireTeam,
  findInstallation,
  installationAccess,
  requireSetupComplete,
  listRegions,
  allRegionsReady,
} from "./access"
import type { MutationCtx } from "./_generated/server"
import { snapshotValue } from "./betterAuth/teams"
import { sendAuthEmail } from "./authEmail"
import { ensureTeamTenant, removeTeamTenants } from "./tenants"
const role = v.union(v.literal("admin"), v.literal("member"))
/** A team is deleted only once it has no domains; its tenants go with it. */
async function retireTeam(ctx: MutationCtx, organizationId: string) {
  const domain = await ctx.db
    .query("domains")
    .withIndex("by_organizationId_and_deleted_and_name", (q) =>
      q.eq("organizationId", organizationId).eq("deleted", false)
    )
    .first()
  if (domain)
    throw new ConvexError(
      "Remove this team's sending domains before deleting the team"
    )
  await removeTeamTenants(ctx, organizationId)
}
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
  handler: async (ctx, args) => {
    const sid = await sessionId(ctx)
    const installation = await findInstallation(ctx)
    if (!installation?.completedAt) {
      const access = await installationAccess(ctx)
      // The account snapshot is the costly check, so it runs last.
      if (
        !access.admin ||
        installation?.setupStep !== "team" ||
        !installation.accountId ||
        !installation.environmentCheckedAt ||
        !allRegionsReady(await listRegions(ctx)) ||
        (
          await ctx.runQuery(components.betterAuth.teams.snapshot, {
            sessionId: sid,
          })
        ).teams.length
      )
        throw new ConvexError(
          "Create your first team at the team step of installation setup"
        )
    }
    const id = await ctx.runMutation(components.betterAuth.teams.create, {
      ...args,
      sessionId: sid,
    })
    if (installation?.defaultRegion)
      await ensureTeamTenant(ctx, id, installation.defaultRegion)
    if (installation && !installation.completedAt)
      await ctx.db.patch("installation", installation._id, {
        setupStep: "domain",
      })
    return id
  },
})
export const switchTeam = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireSetupComplete(ctx)
    return ctx.runMutation(components.betterAuth.teams.switchTeam, {
      ...args,
      sessionId: await sessionId(ctx),
    })
  },
})
export const rename = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireSetupComplete(ctx)
    return ctx.runMutation(components.betterAuth.teams.rename, {
      ...args,
      sessionId: await sessionId(ctx),
    })
  },
})
export const remove = mutation({
  args: { organizationId: v.string(), leave: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireSetupComplete(ctx)
    await requireTeam(ctx, args.organizationId, !args.leave)
    const sid = await sessionId(ctx)
    // Leaving retires the team only when this member is its last one.
    if (
      !args.leave ||
      (
        await ctx.runQuery(components.betterAuth.teams.snapshot, {
          sessionId: sid,
        })
      ).teams.find((team) => team.id === args.organizationId)?.members === 1
    )
      await retireTeam(ctx, args.organizationId)
    return ctx.runMutation(components.betterAuth.teams.remove, {
      ...args,
      sessionId: sid,
    })
  },
})
export const changeMember = mutation({
  args: {
    organizationId: v.string(),
    memberId: v.string(),
    role: v.optional(role),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireSetupComplete(ctx)
    return ctx.runMutation(components.betterAuth.teams.changeMember, {
      ...args,
      sessionId: await sessionId(ctx),
    })
  },
})
export const invite = mutation({
  args: { organizationId: v.string(), email: v.string(), role },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireSetupComplete(ctx)
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
  handler: async (ctx, args) => {
    await requireSetupComplete(ctx)
    return ctx.runMutation(components.betterAuth.teams.cancelInvitation, {
      ...args,
      sessionId: await sessionId(ctx),
    })
  },
})
export const respond = mutation({
  args: { invitationId: v.string(), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireSetupComplete(ctx)
    return ctx.runMutation(components.betterAuth.teams.respond, {
      ...args,
      sessionId: await sessionId(ctx),
    })
  },
})
export const deleteAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { access, installation } = await requireSetupComplete(ctx)
    if (installation.accountId && access.admin)
      throw new ConvexError(
        "The installation administrator cannot delete their account while AWS is connected"
      )
    const sid = await sessionId(ctx)
    const account = await ctx.runQuery(components.betterAuth.teams.snapshot, {
      sessionId: sid,
    })
    for (const team of account.teams)
      if (team.members === 1) await retireTeam(ctx, team.id)
    return ctx.runMutation(components.betterAuth.teams.deleteAccount, {
      sessionId: sid,
    })
  },
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
  handler: async (ctx, args) => {
    await requireSetupComplete(ctx)
    return ctx.runMutation(components.betterAuth.teams.setAvatar, {
      ...args,
      sessionId: await sessionId(ctx),
    })
  },
})
