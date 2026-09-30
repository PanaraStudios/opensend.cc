import type { HttpRouter } from "convex/server"
import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { BodyTooLarge, limitedBody } from "../ses/web"
import { decryptSecret } from "../secrets"
import { verifyMetaSignature } from "../../lib/meta/signature"
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

export const ingestWebhook = httpAction(async (ctx, request) => {
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = await limitedBody(request, 1024 * 1024, { raw: true })
  } catch (error) {
    return new Response(null, {
      status: error instanceof BodyTooLarge ? 413 : 503,
    })
  }
  try {
    const secret = await ctx.runQuery(internal.meta.ingest.appSecret, {})
    if (
      !secret ||
      !(await verifyMetaSignature(
        await decryptSecret(secret),
        raw,
        request.headers.get("X-Hub-Signature-256")
      ))
    )
      return new Response(null, { status: 401 })
    let body: string
    let payload: unknown
    try {
      body = new TextDecoder("utf-8", { fatal: true }).decode(raw)
      payload = JSON.parse(body)
    } catch {
      return new Response(null, { status: 400 })
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      !("object" in payload) ||
      typeof payload.object !== "string"
    )
      return new Response(null, { status: 400 })
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw))
    const bodyHash = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")
    await ctx.runMutation(internal.meta.ingest.store, {
      body,
      bodyHash,
      object: payload.object,
    })
    return new Response(null, { status: 200 })
  } catch {
    // Never acknowledge an event we could not durably record.
    return new Response(null, { status: 503 })
  }
})

export function registerMetaRoutes(http: HttpRouter) {
  http.route({ path: META_WEBHOOK_PATH, method: "GET", handler: verifyWebhook })
  http.route({
    path: META_WEBHOOK_PATH,
    method: "POST",
    handler: ingestWebhook,
  })
}
