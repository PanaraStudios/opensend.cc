import { env } from "./_generated/server"
import { createClient, type GenericCtx } from "@convex-dev/better-auth"
import { betterAuth } from "better-auth/minimal"
import { createAuthMiddleware, APIError } from "better-auth/api"
import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import schema from "./betterAuth/schema"
import { createAuthOptions } from "./authOptions"
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth"

export const authComponent: ReturnType<
  typeof createClient<DataModel, typeof schema>
> = createClient<DataModel, typeof schema>(components.betterAuth, {
  local: { schema },
  authFunctions: internal.auth,
  triggers: {
    user: {
      onCreate: async (ctx, user) => {
        await ctx.runMutation(components.betterAuth.policy.admitUser, {
          userId: user._id,
          email: user.email,
        })
      },
    },
  },
})
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi()
export function createAuth(
  ctx: GenericCtx<DataModel>,
  providers: GenericOAuthConfig[] = []
) {
  const options = createAuthOptions(providers)
  return betterAuth({
    ...options,
    emailAndPassword: {
      ...options.emailAndPassword,
      onPasswordReset: async ({ user }) => {
        if (!("runMutation" in ctx))
          throw new Error("Password reset requires a writable context")
        await ctx.runMutation(components.betterAuth.oauth.invalidateUser, {
          userId: user.id,
        })
      },
    },
    baseURL: env.SITE_URL,
    onAPIError: { errorURL: `${env.SITE_URL}/login` },
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.SITE_URL!],
    database: authComponent.adapter(ctx),
    hooks: {
      before: createAuthMiddleware(async (context) => {
        // All team operations run through our atomic component API. No alternate
        // organization endpoint may bypass SSO, ownership, or deletion checks.
        if (
          context.path.startsWith("/organization/") ||
          (context.path.startsWith("/oauth2/") &&
            !context.path.startsWith("/oauth2/callback/") &&
            context.path !== "/oauth2/link") ||
          context.path === "/delete-user" ||
          context.path === "/link-social" ||
          context.path === "/oauth2/link" ||
          context.path === "/unlink-account"
        ) {
          throw new APIError("FORBIDDEN", {
            message: "Use Opensend team and account settings",
          })
        }
      }),
    },
  })
}
