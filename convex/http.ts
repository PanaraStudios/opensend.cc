import { env } from "./_generated/server"
import { httpRouter } from "convex/server"
import { httpAction } from "./_generated/server"
import { createAuth } from "./auth"
import { loadProvider } from "./oidc"
import { components } from "./_generated/api"
const http = httpRouter()
const handler = httpAction(async (ctx, request) => {
  try {
    const url = new URL(request.url)
    let providerId: string | undefined
    const callback = url.pathname.match(
      /^\/api\/auth\/oauth2\/callback\/([^/]+)$/
    )
    if (callback) providerId = callback[1]
    if (
      url.pathname === "/api/auth/sign-in/oauth2" &&
      request.method === "POST"
    ) {
      const body: unknown = await request.clone().json()
      if (
        body &&
        typeof body === "object" &&
        "providerId" in body &&
        typeof body.providerId === "string"
      )
        providerId = body.providerId
    }
    const loaded = providerId ? await loadProvider(ctx, providerId) : null
    if (loaded && !callback) {
      const initiatingSession = await createAuth(ctx).api.getSession({
        headers: request.headers,
      })
      const body: unknown = await request.json()
      if (!body || typeof body !== "object" || Array.isArray(body))
        return Response.json({ message: "Invalid request" }, { status: 400 })
      request = new Request(request, {
        body: JSON.stringify({
          ...body,
          additionalData: {
            opensendOrganizationId: loaded.connection.organizationId,
            opensendRevision: loaded.connection.revision,
            opensendInitiatorSessionId: initiatingSession?.session.id,
          },
        }),
      })
    }
    const auth = createAuth(ctx, loaded ? [loaded.provider] : [])
    // Proof is minted by an after hook only after the OAuth callback creates a
    // session. It never depends on a client-provided success flag or redirect.
    if (callback && loaded) {
      const { createAuthMiddleware } = await import("better-auth/api")
      const { betterAuth } = await import("better-auth/minimal")
      const options = auth.options
      const callbackAuth = betterAuth({
        ...options,
        hooks: {
          ...options.hooks,
          after: createAuthMiddleware(async (context) => {
            const created = context.context.newSession
            if (created && context.path.startsWith("/oauth2/callback/"))
              await ctx.runMutation(components.betterAuth.sso.complete, {
                sessionId: created.session.id,
                organizationId: loaded.connection.organizationId,
                revision: loaded.connection.revision,
              })
          }),
        },
      })
      const response = await callbackAuth.handler(request)
      if (response.status >= 400)
        return Response.redirect(`${env.SITE_URL}/login?error=oidc`, 302)
      return response
    }
    return await auth.handler(request)
  } catch {
    if (new URL(request.url).pathname.includes("/oauth2/callback/"))
      return Response.redirect(`${env.SITE_URL}/login?error=oidc`, 302)
    return Response.json(
      { message: "Authentication failed. Check the connection and try again." },
      { status: 400 }
    )
  }
})
http.route({ pathPrefix: "/api/auth/", method: "GET", handler })
http.route({ pathPrefix: "/api/auth/", method: "POST", handler })
export default http
