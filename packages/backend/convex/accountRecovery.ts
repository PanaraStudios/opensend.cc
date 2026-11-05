import { ConvexError, v } from "convex/values"
import { env, internalAction } from "./_generated/server"
import { createAuth } from "./auth"

/** Operator-only: uses Better Auth's own issuance and one-time reset endpoint. */
export const resetPassword = internalAction({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, { email }): Promise<string> => {
    let link: string | undefined
    const auth = createAuth(ctx, [], async (message) => {
      link = message.url
    })
    const context = await auth.$context
    // The upstream unknown-user path logs the email address; stop before that path.
    if (
      !(await context.internalAdapter.findUserByEmail(
        email.trim().toLowerCase()
      ))
    )
      throw new ConvexError("Unable to create an account recovery link")
    await auth.api.requestPasswordReset({
      body: {
        email: email.trim().toLowerCase(),
        redirectTo: `${env.SITE_URL}/reset-password`,
      },
    })
    if (!link)
      throw new ConvexError("Unable to create an account recovery link")
    return link
  },
})
