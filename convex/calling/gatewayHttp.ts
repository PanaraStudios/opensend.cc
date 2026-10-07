import type { HttpRouter } from "convex/server"
import { ConvexError } from "convex/values"
import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { limitedBody, BodyTooLarge } from "../ses/web"
import { verifyGatewayHmac } from "../../lib/meta/calling-gateway"
import { object, string } from "../../lib/meta/parse"
export const events = httpAction(async (ctx, request) => {
  try {
    const raw = await limitedBody(request, 128 * 1024, { raw: true })
    const auth = await verifyGatewayHmac(
      process.env.CALL_GATEWAY_SECRET ?? "",
      request,
      raw
    )
    if (!auth) return new Response(null, { status: 401 })
    let data: Record<string, unknown>
    try {
      data = object(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))
      )
    } catch {
      return new Response(null, { status: 400 })
    }
    const event = string(data.event)
    if (
      data.version !== 1 ||
      !/^[a-f0-9-]{36}$/i.test(string(data.eventId)) ||
      !string(data.callId) ||
      typeof data.timestamp !== "number" ||
      !Number.isFinite(data.timestamp) ||
      ![
        "answer_ready",
        "offer_ready",
        "media_up",
        "heartbeat",
        "hangup",
        "recording_ready",
      ].includes(event) ||
      (event === "answer_ready" && !string(data.answerSdp)) ||
      (event === "offer_ready" && !string(data.offerSdp)) ||
      (event === "hangup" && typeof data.reason !== "string") ||
      (event === "recording_ready" &&
        !/^\/recordings\/[a-f0-9-]{36}\.wav$/i.test(string(data.recordingFile)))
    )
      return new Response(null, { status: 400 })
    await ctx.runMutation(internal.calling.gatewayState.consume, {
      ...auth,
      data,
    })
    return Response.json({ ok: true })
  } catch (error) {
    const status =
      error instanceof BodyTooLarge
        ? 413
        : error instanceof ConvexError &&
            typeof error.data === "object" &&
            error.data !== null &&
            "statusCode" in error.data
          ? Number(error.data.statusCode)
          : 503
    return new Response(null, { status })
  }
})
export const leave = httpAction(async (ctx, request) => {
  try {
    const raw = await limitedBody(request, 2048, { raw: true })
    const data: unknown = JSON.parse(new TextDecoder().decode(raw))
    if (
      !data ||
      typeof data !== "object" ||
      !("id" in data) ||
      !("browserId" in data) ||
      !("leaseId" in data) ||
      typeof data.id !== "string" ||
      typeof data.browserId !== "string" ||
      typeof data.leaseId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(data.leaseId)
    )
      return new Response(null, { status: 400 })
    await ctx.runMutation(internal.calling.softphoneState.disconnect, {
      id: data.id as import("../_generated/dataModel").Id<"callAgents">,
      browserId: data.browserId,
      leaseId: data.leaseId,
    })
    return new Response(null, { status: 204 })
  } catch {
    return new Response(null, { status: 400 })
  }
})
export function registerCallingGatewayRoutes(http: HttpRouter) {
  http.route({
    path: "/calling/softphone/leave",
    method: "POST",
    handler: leave,
  })
  http.route({
    path: "/calling/gateway/events",
    method: "POST",
    handler: events,
  })
}
