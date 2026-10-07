import { env } from "./_generated/server"
import { getOAuthState } from "better-auth/api"
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose"
import { decryptSecret } from "./secrets"
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth"
import type { ActionCtx } from "./_generated/server"
import { components, internal } from "./_generated/api"
import { localHttpOrigin } from "../lib/net/public-host"

export async function loadProvider(ctx: ActionCtx, organizationId: string) {
  const connection = await ctx.runQuery(components.betterAuth.sso.connection, {
    organizationId,
  })
  if (!connection) throw new Error("SSO connection not found")
  // Discovery runs before Better Auth's handler and its rate limits.
  await ctx.runMutation(internal.botToolkitAccess.reserveOutbound, {
    organizationId,
    operation: "oidcDiscovery",
  })
  const discoveryUrl = `${connection.issuer}/.well-known/openid-configuration`
  const localOrigin =
    env.ALLOW_LOCAL_OIDC === "true"
      ? localHttpOrigin(connection.issuer)
      : undefined
  const fetchPublic = async (url: string, body?: string) => {
    const result = await ctx.runAction(internal.publicHttp.request, {
      url,
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? {}
          : { "content-type": "application/x-www-form-urlencoded" },
      ...(body === undefined ? {} : { body }),
      ...(localOrigin ? { localOrigin } : {}),
    })
    return new Response(
      [204, 205, 304].includes(result.status) ? null : result.body,
      { status: result.status }
    )
  }
  const response = await fetchPublic(discoveryUrl)
  if (!response.ok) throw new Error("Could not load the identity provider")
  const discovery: unknown = await response.json()
  if (
    !discovery ||
    typeof discovery !== "object" ||
    !("issuer" in discovery) ||
    discovery.issuer !== connection.issuer ||
    !("jwks_uri" in discovery) ||
    typeof discovery.jwks_uri !== "string" ||
    !("authorization_endpoint" in discovery) ||
    typeof discovery.authorization_endpoint !== "string" ||
    !("token_endpoint" in discovery) ||
    typeof discovery.token_endpoint !== "string"
  )
    throw new Error("Invalid OIDC discovery document")
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), {
    [customFetch]: (url) => fetchPublic(url),
  })
  const clientSecret = await decryptSecret(connection.encryptedSecret)
  const tokenUrl = discovery.token_endpoint
  const authorizationUrl = new URL(discovery.authorization_endpoint)
  if (
    (authorizationUrl.protocol !== "https:" &&
      authorizationUrl.origin !== localOrigin) ||
    authorizationUrl.username ||
    authorizationUrl.password
  )
    throw new Error("Invalid OIDC authorization endpoint")
  const provider: GenericOAuthConfig = {
    providerId: organizationId,
    issuer: connection.issuer,
    // No discovery URL: Better Auth's built-in fetches do not pin DNS. Its
    // sign-in route still requires a token URL, which only its refresh path
    // would call, and refresh needs a refresh token that `getToken` never
    // returns. The code exchange itself is the pinned one below.
    authorizationUrl: authorizationUrl.href,
    tokenUrl,
    clientId: connection.clientId,
    clientSecret,
    getToken: async ({ code, redirectURI, codeVerifier }) => {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectURI,
        client_id: connection.clientId,
        client_secret: clientSecret,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      })
      const response = await fetchPublic(tokenUrl, body.toString())
      const tokens: unknown = await response.json()
      if (
        !response.ok ||
        !tokens ||
        typeof tokens !== "object" ||
        !("id_token" in tokens) ||
        typeof tokens.id_token !== "string"
      )
        throw new Error("OIDC ID token required")
      return {
        idToken: tokens.id_token,
        accessToken:
          "access_token" in tokens && typeof tokens.access_token === "string"
            ? tokens.access_token
            : undefined,
        accessTokenExpiresAt:
          "expires_in" in tokens && typeof tokens.expires_in === "number"
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : undefined,
        scopes:
          "scope" in tokens && typeof tokens.scope === "string"
            ? tokens.scope.split(" ")
            : [],
      }
    },
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
