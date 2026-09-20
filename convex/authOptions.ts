import type { BetterAuthOptions } from "better-auth"
import { organization } from "better-auth/plugins/organization"
import { twoFactor } from "better-auth/plugins/two-factor"
import {
  genericOAuth,
  type GenericOAuthConfig,
} from "better-auth/plugins/generic-oauth"
import { convex } from "@convex-dev/better-auth/plugins"
import authConfig from "./auth.config"
import { sendAuthEmail } from "./authEmail"
import { oauthProvider } from "@better-auth/oauth-provider"
import { jwt } from "better-auth/plugins/jwt"

/** Shared by the runtime, component adapter and schema generator. */
export function createAuthOptions(providers: GenericOAuthConfig[] = []) {
  return {
    appName: "Opensend",
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        sendAuthEmail({ to: user.email, kind: "reset", url }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) =>
        sendAuthEmail({ to: user.email, kind: "verify", url }),
    },
    user: {
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, url }) =>
          sendAuthEmail({ to: user.email, kind: "change-email", url }),
      },
    },
    session: { freshAge: 300, cookieCache: { enabled: false } },
    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false,
      },
    },
    plugins: [
      // Schema only: protocol endpoints live in the isolated OAuth server.
      {
        id: "oauth-storage",
        schema: {
          ...oauthProvider({
            loginPage: "/login",
            consentPage: "/oauth/consent",
          }).schema,
          oauthJwks: jwt().schema.jwks,
        },
      },
      organization({
        creatorRole: "owner",
        membershipLimit: 100,
        organizationLimit: 50,
      }),
      twoFactor({ issuer: "Opensend" }),
      genericOAuth({ config: providers }),
      convex({ authConfig }),
    ],
  } satisfies BetterAuthOptions
}
