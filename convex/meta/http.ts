import type { HttpRouter } from "convex/server"
import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { META_WEBHOOK_PATH } from "./app"

/** Meta's subscription check: echo `hub.challenge` when `hub.verify_token`
    is the app's. https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests */
export const verifyWebhook = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams
  const token = params.get("hub.verify_token")
  const challenge = params.get("hub.challenge")
  if (
    params.get("hub.mode") !== "subscribe" ||
    !token ||
    token.length > 200 ||
    !challenge ||
    challenge.length > 200 ||
    !(await ctx.runQuery(internal.meta.app.matchesVerifyToken, { token }))
  )
    return new Response(null, { status: 403 })
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  })
})

export function registerMetaRoutes(http: HttpRouter) {
  http.route({ path: META_WEBHOOK_PATH, method: "GET", handler: verifyWebhook })
}
