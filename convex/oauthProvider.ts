import { betterAuth } from "better-auth/minimal"
import { oauthProvider } from "@better-auth/oauth-provider"
import { jwt } from "better-auth/plugins/jwt"
import { APIError } from "better-auth/api"
import type { ActionCtx } from "./_generated/server"
import { env } from "./_generated/server"
import { components } from "./_generated/api"
import { oauthAdapter } from "./oauthAdapter"
import { tokenHash, publicScopes } from "../lib/oauth/policy"

/** Separate issuer, audience, JWKS table, and endpoint surface from browser auth. */
export function oauthServer(ctx: ActionCtx, grantId?: string) {
  const issuer = `${env.SITE_URL}/oauth`
  return betterAuth({
    baseURL: env.SITE_URL,
    basePath: "/api/oauth-provider",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.SITE_URL!],
    database: oauthAdapter(ctx),
    session: { cookieCache: { enabled: false } },
    plugins: [
      jwt({
        schema: { jwks: { modelName: "oauthJwks" } },
        jwt: { issuer, audience: `${issuer}/api` },
      }),
      oauthProvider({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        scopes: [...publicScopes, "offline_access"],
        grantTypes: ["authorization_code", "refresh_token"],
        accessTokenExpiresIn: 900,
        refreshTokenExpiresIn: 2592000,
        codeExpiresIn: 120,
        storeClientSecret: { hash: tokenHash },
        storeTokens: { hash: tokenHash },
        validAudiences: [`${issuer}/api`],
        allowDynamicClientRegistration: false,
        postLogin: {
          page: "/oauth/consent",
          shouldRedirect: async () => false,
          consentReferenceId: async ({ user }) => {
            const grant = grantId
              ? await ctx.runQuery(components.betterAuth.oauth.checkGrant, {
                  id: grantId,
                })
              : null
            if (!grant || grant.userId !== user.id)
              throw new APIError("FORBIDDEN", { message: "Consent required" })
            return grantId
          },
        },
        customAccessTokenClaims: async ({ referenceId, user, scopes }) => {
          const grant = referenceId
            ? await ctx.runQuery(components.betterAuth.oauth.checkGrant, {
                id: referenceId,
              })
            : null
          if (
            !grant ||
            grant.userId !== user?.id ||
            scopes.some(
              (s) => s !== "offline_access" && !grant.scopes.includes(s)
            )
          )
            throw new APIError("FORBIDDEN", {
              message: "Authorization revoked",
            })
          return { grant_id: grant._id, team_id: grant.organizationId }
        },
      }),
    ],
  })
}
