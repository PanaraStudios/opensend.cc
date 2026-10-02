import type { HttpRouter } from "convex/server"
import { ConvexError } from "convex/values"
import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { limitedBody, BodyTooLarge } from "../ses/web"
import { verifyGatewayHmac } from "../../lib/meta/calling-gateway"
import { object, string } from "../../lib/meta/parse"
function handler(kind: "session" | "tool" | "event") {
  return httpAction(async (ctx, request) => {
    try {
      const raw = await limitedBody(request, 128 * 1024, { raw: true }),
        auth = await verifyGatewayHmac(
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
      if (
        data.version !== 1 ||
        !string(data.callId) ||
        (kind !== "event" && !string(data.organizationId))
      )
        return new Response(null, { status: 400 })
      if (kind === "event") {
        if (
          data.endedAt !== undefined &&
          (typeof data.endedAt !== "number" ||
            !Number.isFinite(data.endedAt) ||
            data.endedAt < 0 ||
            data.endedAt > Number(data.timestamp))
        )
          return new Response(null, { status: 400 })
        if (
          !/^[a-f0-9-]{36}$/i.test(string(data.eventId)) ||
          typeof data.timestamp !== "number" ||
          !Number.isFinite(data.timestamp) ||
          ![
            "state",
            "tool_call",
            "hangup",
            "ivr_digits",
            "transcript",
            "barge_in",
            "media",
            "usage",
            "latency",
            "bot_completed",
          ].includes(string(data.type))
        )
          return new Response(null, { status: 400 })
        if (
          data.type === "tool_call" &&
          (typeof data.toolId !== "string" ||
            data.toolId.length > 128 ||
            typeof data.toolName !== "string" ||
            data.toolName.length > 128 ||
            (data.latencyMs !== undefined &&
              (typeof data.latencyMs !== "number" ||
                !Number.isFinite(data.latencyMs) ||
                data.latencyMs < 0)) ||
            !["requested", "succeeded", "failed"].includes(string(data.status)))
        )
          return new Response(null, { status: 400 })
        if (
          data.type === "hangup" &&
          (typeof data.reason !== "string" || data.reason.length > 1024)
        )
          return new Response(null, { status: 400 })
        if (data.type === "transcript") {
          const line = object(data.transcript)
          if (
            !["caller", "agent"].includes(string(line.role)) ||
            typeof line.text !== "string" ||
            line.text.length > 16000 ||
            typeof line.final !== "boolean" ||
            typeof line.timestampMs !== "number" ||
            !Number.isFinite(line.timestampMs) ||
            line.timestampMs < 0
          )
            return new Response(null, { status: 400 })
        }
        if (
          data.type === "bot_completed" &&
          (typeof data.summary !== "string" || data.summary.length > 4000)
        )
          return new Response(null, { status: 400 })
      }
      const result = await ctx.runMutation(internal.voice.gateway[kind], {
        ...auth,
        data,
      })
      return Response.json(kind === "event" ? { ok: true } : result, {
        headers: { "Cache-Control": "no-store" },
      })
    } catch (error) {
      const status =
        error instanceof BodyTooLarge
          ? 413
          : error instanceof ConvexError &&
              typeof error.data === "object" &&
              error.data &&
              "statusCode" in error.data
            ? Number(error.data.statusCode)
            : 503
      return new Response(null, { status })
    }
  })
}
export function registerVoiceGatewayRoutes(http: HttpRouter) {
  for (const [path, kind] of [
    ["session", "session"],
    ["tools", "tool"],
    ["events", "event"],
  ] as const)
    http.route({
      path: `/calling/gateway/voice/${path}`,
      method: "POST",
      handler: handler(kind),
    })
}
