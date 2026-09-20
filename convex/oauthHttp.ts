import { createLocalJWKSet, jwtVerify } from "jose"
import { ConvexError } from "convex/values"
import { httpAction, env } from "./_generated/server"
import type { ActionCtx } from "./_generated/server"
import { components } from "./_generated/api"
import { createAuth } from "./auth"
import { oauthServer } from "./oauthProvider"
import {
  parseScopes,
  publicScopes,
  randomToken,
  tokenHash,
} from "../lib/oauth/policy"
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  })
function browser(request: Request, flow: string) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`oauth_${flow}=`))
      ?.split("=")[1] ?? ""
  )
}
async function fields(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 16384)
    throw new Error("Request too large")
  const text = await request.text()
  if (text.length > 16384) throw new Error("Request too large")
  if (request.headers.get("content-type")?.includes("application/json")) {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid request")
    return value as Record<string, unknown>
  }
  const params = new URLSearchParams(text)
  for (const key of params.keys())
    if (params.getAll(key).length !== 1) throw new Error("Duplicate parameter")
  return Object.fromEntries(params)
}
async function credentials(
  ctx: ActionCtx,
  request: Request,
  body: Record<string, unknown>
) {
  let id = body.client_id,
    secret = body.client_secret
  let method = secret ? "client_secret_post" : "none"
  const auth = request.headers.get("authorization")
  if (auth) {
    if (!auth.startsWith("Basic ") || secret)
      throw new Error("Invalid client authentication")
    const decoded = atob(auth.slice(6)),
      colon = decoded.indexOf(":")
    if (colon < 0) throw new Error("Invalid client authentication")
    id = decodeURIComponent(decoded.slice(0, colon))
    secret = decodeURIComponent(decoded.slice(colon + 1))
    method = "client_secret_basic"
  }
  if (typeof id !== "string") throw new Error("Client ID required")
  const client = await ctx.runQuery(components.betterAuth.oauth.client, {
    clientId: id,
  })
  if (
    !client ||
    client.disabled ||
    client.tokenEndpointAuthMethod !== method ||
    (method !== "none" &&
      (typeof secret !== "string" ||
        (await tokenHash(secret)) !== client.clientSecret))
  )
    throw new Error("Invalid client authentication")
  return client
}
export async function authorizeOAuth(ctx: ActionCtx, token: string) {
  const keys = await oauthServer(ctx).api.getJwks()
  const { payload } = await jwtVerify(token, createLocalJWKSet(keys), {
    issuer: `${env.SITE_URL}/oauth`,
    audience: `${env.SITE_URL}/oauth/api`,
  })
  if (typeof payload.grant_id !== "string" || typeof payload.scope !== "string")
    throw new Error("Invalid access token")
  const grant = await ctx.runQuery(components.betterAuth.oauth.checkGrant, {
    id: payload.grant_id,
  })
  const scopes = payload.scope.split(" ").filter((s) => s !== "offline_access")
  if (
    !grant ||
    payload.sub !== grant.userId ||
    payload.azp !== grant.clientId ||
    payload.team_id !== grant.organizationId ||
    scopes.some((s) => !grant.scopes.includes(s))
  )
    throw new Error("Authorization revoked")
  return {
    user: grant.userId,
    team: grant.organizationId,
    application: grant.clientId,
    grant: grant._id,
    scopes,
    payload,
  }
}
export const handler = httpAction(async (ctx, request) => {
  const url = new URL(request.url),
    path = url.pathname
  try {
    const issuer = `${env.SITE_URL}/oauth`
    if (path.startsWith("/.well-known/oauth-authorization-server"))
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        revocation_endpoint: `${issuer}/revoke`,
        introspection_endpoint: `${issuer}/introspect`,
        jwks_uri: `${issuer}/jwks`,
        scopes_supported: publicScopes,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [
          "none",
          "client_secret_basic",
          "client_secret_post",
        ],
      })
    if (path === "/oauth/jwks")
      return json(await oauthServer(ctx).api.getJwks())
    if (path === "/oauth/authorize") {
      if (
        !(await ctx.runMutation(components.betterAuth.oauth.rate, {
          key: "authorization",
          max: 120,
          window: 60000,
        }))
      )
        return json({ error: "rate_limited" }, 429)
      const token = randomToken(),
        nonce = randomToken()
      await ctx.runMutation(components.betterAuth.oauth.start, {
        token,
        browserHash: await tokenHash(nonce),
        query: url.searchParams.toString(),
      })
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${issuer}/consent?flow=${token}`,
          "Cache-Control": "no-store",
          "Set-Cookie": `oauth_${token}=${nonce}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${env.SITE_URL?.startsWith("https:") ? "; Secure" : ""}`,
        },
      })
    }
    if (path === "/oauth/flow") {
      const token = url.searchParams.get("flow") ?? ""
      const browserHash = await tokenHash(browser(request, token))
      if (request.method === "GET")
        return json(
          await ctx.runQuery(components.betterAuth.oauth.pending, {
            token,
            browserHash,
          })
        )
      if (request.headers.get("origin") !== env.SITE_URL)
        return json({ error: "invalid_origin" }, 403)
      const session = await createAuth(ctx).api.getSession({
        headers: request.headers,
      })
      if (!session) return json({ error: "login_required" }, 401)
      const body = await fields(request)
      if (
        typeof body.accept !== "boolean" ||
        typeof body.organizationId !== "string"
      )
        throw new Error("Invalid decision")
      const decision = await ctx.runMutation(
        components.betterAuth.oauth.decide,
        {
          token,
          browserHash,
          sessionId: session.session.id,
          organizationId: body.organizationId,
          accept: body.accept,
        }
      )
      if (!decision.grantId) return json({ cancelled: true })
      const query = new URLSearchParams(decision.query)
      query.set("scope", `${query.get("scope")} offline_access`)
      const auth = oauthServer(ctx, decision.grantId)
      const headers = new Headers(request.headers)
      headers.set("accept", "application/json")
      headers.delete("content-type")
      const response = await auth.handler(
        new Request(
          `${env.SITE_URL}/api/oauth-provider/oauth2/authorize?${query}`,
          { headers }
        )
      )
      if (!response.ok && response.status !== 302)
        return json(
          { error: "Authorization failed. Start again from the application." },
          400
        )
      const location = response.headers.get("location")
      return location ? json({ url: location }) : response
    }
    if (path === "/oauth/register") {
      if (
        !(await ctx.runMutation(components.betterAuth.oauth.rate, {
          key: "registration",
          max: 20,
          window: 3600000,
        }))
      )
        return json({ error: "rate_limited" }, 429)
      const body = await fields(request)
      const allowed = [
        "client_name",
        "redirect_uris",
        "scope",
        "token_endpoint_auth_method",
        "grant_types",
        "response_types",
      ]
      if (Object.keys(body).some((k) => !allowed.includes(k)))
        throw new Error("Unsupported registration metadata")
      const scopes = parseScopes(body.scope)
      const method = body.token_endpoint_auth_method ?? "none"
      if (
        method !== "none" &&
        method !== "client_secret_basic" &&
        method !== "client_secret_post"
      )
        throw new Error("Unsupported client authentication")
      if (
        typeof body.client_name !== "string" ||
        !Array.isArray(body.redirect_uris) ||
        !body.redirect_uris.every((v) => typeof v === "string")
      )
        throw new Error("Name and callback URLs required")
      if (
        body.grant_types !== undefined &&
        (!Array.isArray(body.grant_types) ||
          !body.grant_types.includes("authorization_code") ||
          body.grant_types.some(
            (t) => !["authorization_code", "refresh_token"].includes(t)
          ))
      )
        throw new Error("Unsupported grant type")
      if (
        body.response_types !== undefined &&
        (!Array.isArray(body.response_types) ||
          body.response_types.length !== 1 ||
          body.response_types[0] !== "code")
      )
        throw new Error("Unsupported response type")
      const clientId = randomToken(),
        secret = method === "none" ? undefined : randomToken()
      await ctx.runMutation(components.betterAuth.oauthClients.register, {
        clientId,
        name: body.client_name,
        redirects: body.redirect_uris,
        scope: scopes.join(" "),
        method,
        secretHash: secret ? await tokenHash(secret) : undefined,
      })
      return json(
        {
          client_id: clientId,
          ...(secret ? { client_secret: secret } : {}),
          client_name: body.client_name,
          redirect_uris: body.redirect_uris,
          scope: scopes.join(" "),
          token_endpoint_auth_method: method,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        201
      )
    }
    if (path === "/oauth/grants" || path.startsWith("/oauth/grants/")) {
      const auth = await authorizeOAuth(
        ctx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? ""
      )
      if (!auth.scopes.includes("full_access"))
        return json({ error: "insufficient_scope" }, 403)
      const revokeId =
        request.method === "DELETE"
          ? path.slice("/oauth/grants/".length)
          : undefined
      return json(
        await ctx.runMutation(components.betterAuth.oauth.resource, {
          grantId: auth.grant,
          scopes: auth.scopes,
          revokeId,
        })
      )
    }
    if (["/oauth/token", "/oauth/revoke", "/oauth/introspect"].includes(path)) {
      if (
        !(await ctx.runMutation(components.betterAuth.oauth.rate, {
          key: "token-global",
          max: 300,
          window: 60000,
        }))
      )
        return json({ error: "rate_limited" }, 429)
      const body = await fields(request)
      const client = await credentials(ctx, request, body)
      if (
        !(await ctx.runMutation(components.betterAuth.oauth.rate, {
          key: `token:${client.clientId}`,
          max: 60,
          window: 60000,
        }))
      )
        return json({ error: "rate_limited" }, 429)
      if (path !== "/oauth/token") {
        if (typeof body.token !== "string") throw new Error("Token required")
        if (path === "/oauth/introspect") {
          try {
            const auth = await authorizeOAuth(ctx, body.token)
            return json(
              auth.application === client.clientId
                ? { active: true, ...auth.payload }
                : { active: false }
            )
          } catch {
            const refresh = await ctx.runQuery(
              components.betterAuth.oauth.inspectRefresh,
              { hash: await tokenHash(body.token), clientId: client.clientId }
            )
            return json(
              refresh ? { active: true, ...refresh } : { active: false }
            )
          }
        }
        try {
          const auth = await authorizeOAuth(ctx, body.token)
          await ctx.runMutation(components.betterAuth.oauth.revokeGrant, {
            id: auth.grant,
            clientId: client.clientId,
          })
        } catch {
          /* RFC 7009: unknown tokens succeed. */
        }
        await ctx.runMutation(components.betterAuth.oauth.revokeToken, {
          hash: await tokenHash(body.token),
          clientId: client.clientId,
        })
        return json({})
      }
      const kind =
        body.grant_type === "authorization_code"
          ? "code"
          : body.grant_type === "refresh_token"
            ? "refresh"
            : null
      if (!kind) return json({ error: "unsupported_grant_type" }, 400)
      if (body.scope !== undefined)
        body.scope = `${parseScopes(body.scope).join(" ")} offline_access`
      if (
        kind === "code" &&
        (typeof body.code_verifier !== "string" ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier))
      )
        throw new Error("S256 PKCE verifier required")
      const value = kind === "code" ? body.code : body.refresh_token
      if (typeof value !== "string") throw new Error("Token required")
      const grantId = await ctx.runMutation(components.betterAuth.oauth.claim, {
        hash: await tokenHash(value),
        kind,
        clientId: client.clientId,
      })
      if (!grantId) return json({ error: "invalid_grant" }, 400)
      body.resource = `${issuer}/api`
      const headers = new Headers(request.headers)
      headers.set("content-type", "application/x-www-form-urlencoded")
      headers.delete("cookie")
      const response = await oauthServer(ctx).handler(
        new Request(`${env.SITE_URL}/api/oauth-provider/oauth2/token`, {
          method: "POST",
          headers,
          body: new URLSearchParams(
            Object.entries(body).map(([key, value]) => [key, String(value)])
          ).toString(),
        })
      )
      if (!response.ok) return response
      if (
        !(await ctx.runQuery(components.betterAuth.oauth.checkGrant, {
          id: grantId,
        }))
      )
        return json({ error: "invalid_grant" }, 400)
      const result = await response.json()
      if (typeof result.scope === "string")
        result.scope = result.scope
          .split(" ")
          .filter((s: string) => s !== "offline_access")
          .join(" ")
      return json(result)
    }
    return json({ error: "not_found" }, 404)
  } catch (error) {
    const message =
      error instanceof ConvexError
        ? String(error.data)
        : error instanceof Error
          ? error.message
          : "Invalid request"
    if (path === "/oauth/authorize")
      return Response.redirect(
        `${env.SITE_URL}/oauth/consent?error=invalid_request`,
        302
      )
    return json({ error: "invalid_request", error_description: message }, 400)
  }
})
