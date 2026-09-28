import type { FunctionReference, HttpRouter } from "convex/server"
import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { BodyTooLarge, limitedBody, setupProof } from "./web"
export const health = httpAction(async (_ctx, request) => {
  const challenge = new URL(request.url).searchParams.get("challenge") ?? ""
  if (challenge.length > 100) return new Response(null, { status: 400 })
  return Response.json(
    { challenge, proof: await setupProof(challenge) },
    { headers: { "Cache-Control": "no-store" } }
  )
})
/** An SNS HTTPS endpoint: the action verifies and stores the envelope. */
const snsEndpoint = (
  action: FunctionReference<"action", "internal", { body: string }, null>
) =>
  httpAction(async (ctx, request) => {
    if (!request.body) return new Response(null, { status: 400 })
    try {
      const body = await limitedBody(request, 300000)
      await ctx.runAction(action, { body })
      return new Response(null, { status: 204 })
    } catch (e) {
      if (e instanceof BodyTooLarge) return new Response(null, { status: 413 })
      // Keep legitimate provider/network failures retryable. Never echo signed data.
      return new Response("SNS event was not accepted", { status: 503 })
    }
  })
export const receive = snsEndpoint(internal.ses.events.receive)
/** Notifications of inbound mail SES stored in S3. */
export const receiveInbound = snsEndpoint(internal.ses.inbound.receive)
export function registerSesRoutes(http: HttpRouter) {
  http.route({ path: "/ses/health", method: "GET", handler: health })
  http.route({ path: "/ses/events", method: "POST", handler: receive })
  http.route({ path: "/ses/inbound", method: "POST", handler: receiveInbound })
}
