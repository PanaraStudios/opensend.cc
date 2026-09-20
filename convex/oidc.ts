import { env } from "./_generated/server"
import { getOAuthState } from "better-auth/api"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { symmetricDecrypt } from "better-auth/crypto"
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth"
import type { ActionCtx } from "./_generated/server"
import { components } from "./_generated/api"

export async function loadProvider(ctx: ActionCtx, organizationId: string) {
  const connection = await ctx.runQuery(components.betterAuth.sso.connection, {
    organizationId,
  })
  if (!connection) throw new Error("SSO connection not found")
  const discoveryUrl = `${connection.issuer}/.well-known/openid-configuration`
  const response = await fetch(discoveryUrl)
  if (!response.ok) throw new Error("Could not load the identity provider")
  const discovery: unknown = await response.json()
  if (
    !discovery ||
    typeof discovery !== "object" ||
    !("issuer" in discovery) ||
    discovery.issuer !== connection.issuer ||
    !("jwks_uri" in discovery) ||
    typeof discovery.jwks_uri !== "string"
  )
    throw new Error("Invalid OIDC discovery document")
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri))
  const provider: GenericOAuthConfig = {
    providerId: organizationId,
    issuer: connection.issuer,
    discoveryUrl,
    clientId: connection.clientId,
    clientSecret: await symmetricDecrypt({
      key: env.SSO_ENCRYPTION_KEY!,
      data: connection.encryptedSecret,
    }),
    scopes: ["openid", "email", "profile"],
    pkce: true,
    requireIssuerValidation: true,
    getUserInfo: async (tokens) => {
      const state = await getOAuthState()
      if (
        state?.opensendOrganizationId !== organizationId ||
        state?.opensendRevision !== connection.revision
      )
        throw new Error("The connection changed during sign-in; start again")
      if (!tokens.idToken) throw new Error("OIDC ID token required")
      const { payload } = await jwtVerify(tokens.idToken, jwks, {
        issuer: connection.issuer,
        audience: connection.clientId,
      })
      if (
        !payload.sub ||
        typeof payload.email !== "string" ||
        payload.email_verified !== true
      )
        throw new Error("A verified email address is required")
      const accountId = `${connection.revision}:${payload.sub}`
      await ctx.runQuery(components.betterAuth.sso.authorizeIdentity, {
        organizationId,
        revision: connection.revision,
        accountId,
        email: payload.email.toLowerCase(),
        initiatorSessionId:
          typeof state.opensendInitiatorSessionId === "string"
            ? state.opensendInitiatorSessionId
            : undefined,
      })
      return {
        id: accountId,
        email: payload.email.toLowerCase(),
        emailVerified: true,
        name: typeof payload.name === "string" ? payload.name : payload.email,
      }
    },
  }
  return { provider, connection }
}
