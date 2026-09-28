import { v, ConvexError } from "convex/values"
import { internalMutation } from "./_generated/server"
import { components, internal } from "./_generated/api"
import { findInstallation } from "./access"
import { systemSenderDomain } from "./systemEmail"

/* Operator commands, run with the deployment admin key:
   pnpm backend run installationAdmin:transfer '{"email":"new@example.com"}' */
export const transfer = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: (ctx, args) =>
    ctx.runMutation(
      components.betterAuth.policy.transferInstallationAdmin,
      args
    ),
})

/* pnpm backend run installationAdmin:setSystemSender '{"from":"Opensend <no-reply@example.com>"}'
   Account email (verification, password resets, email changes, team
   invitations) is sent from this address through the tenant of the team
   that owns its domain. Without `from`, the sender is cleared and account
   email goes back to the server log. */
export const setSystemSender = internalMutation({
  args: { from: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { from }) => {
    const installation = await findInstallation(ctx)
    if (!installation) throw new ConvexError("Finish installation setup first")
    if (from === undefined) {
      await ctx.db.patch("installation", installation._id, {
        systemSender: undefined,
      })
      return null
    }
    const domain = await systemSenderDomain(ctx, from)
    // Refuses a tenant, region or IAM policy that cannot send yet.
    await ctx.runQuery(internal.ses.sendContext.get, {
      organizationId: domain.organizationId,
      domainId: domain._id,
    })
    await ctx.db.patch("installation", installation._id, {
      systemSender: { from: from.trim(), domainId: domain._id },
    })
    return null
  },
})
