import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { components } from "./_generated/api"
import { configureSystemSender } from "./systemEmail"

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
  handler: (ctx, { from }): Promise<null> => configureSystemSender(ctx, from),
})
