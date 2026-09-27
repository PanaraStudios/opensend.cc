import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { components } from "./_generated/api"

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
