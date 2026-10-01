import type { HttpRouter } from "convex/server"
import { ConvexError } from "convex/values"
import { httpAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { limitedBody, BodyTooLarge } from "../ses/web"
import { verifyGatewayHmac } from "../../lib/meta/calling-gateway"
import { verifyPrompt } from "../../lib/ivr-prompts"
import type { Id } from "../_generated/dataModel"
function status(error: unknown) {
  return error instanceof BodyTooLarge
    ? 413
    : error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data &&
        "statusCode" in error.data
      ? Number(error.data.statusCode)
      : 503
}
function handler(starting: boolean) {
  return httpAction(async (ctx, request) => {
    try {
      const raw = await limitedBody(request, 8192, { raw: true })
      const auth = await verifyGatewayHmac(
        process.env.CALL_GATEWAY_SECRET ?? "",
        request,
        raw
      )
      if (!auth) return new Response(null, { status: 401 })
      let input: unknown
      try {
        input = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(raw)
        )
      } catch {
        return new Response(null, { status: 400 })
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        return new Response(null, { status: 400 })
      const d = input as Record<string, unknown>
      if (
        typeof d.callId !== "string" ||
        typeof d.ivrId !== "string" ||
        (!starting &&
          (typeof d.menuId !== "string" ||
            d.menuId.length > 128 ||
            typeof d.digits !== "string" ||
            !/^(?:[0-9*#]{1,12}|timeout|invalid)$/.test(d.digits) ||
            (d.step !== undefined && !Number.isSafeInteger(d.step)))) ||
        Object.keys(d).some(
          (k) =>
            !(
              starting
                ? ["callId", "ivrId"]
                : ["callId", "ivrId", "menuId", "digits", "step"]
            ).includes(k)
        )
      )
        return new Response(null, { status: 400 })
      const common = {
        callId: d.callId as Id<"calls">,
        ivrId: d.ivrId as Id<"ivrs">,
        origin: new URL(request.url).origin,
      }
      if (starting) {
        const result = await ctx.runMutation(internal.ivr.runtime.start, {
          ...common,
          ...auth,
        })
        if (!("webhook" in result)) return Response.json(result)
        const selected = await ctx
          .runAction(internal.ivr.webhook.decide, {
            callId: common.callId,
            ivrId: common.ivrId,
            menuId: "business_hours",
            digits: "closed",
            url: result.webhook.url,
            secretId: result.webhook.secretId,
          })
          .catch(() => ({ kind: "hangup" }))
        return Response.json(
          await ctx.runMutation(internal.ivr.runtime.complete, {
            ...common,
            menuId: "business_hours",
            digits: "closed",
            step: 0,
            selected,
          })
        )
      }
      const step = {
        menuId: d.menuId as string,
        digits: d.digits as string,
        step: d.step as number | undefined,
      }
      const claim = await ctx.runMutation(internal.ivr.runtime.claim, {
        ...common,
        ...auth,
        ...step,
      })
      if (claim.result) return Response.json(claim.result)
      const selected = await ctx
        .runAction(internal.ivr.webhook.decide, {
          callId: common.callId,
          ivrId: common.ivrId,
          menuId: step.menuId,
          digits: step.digits,
          url: claim.webhook.url,
          secretId: claim.webhook.secretId,
        })
        .catch(() => claim.fallback)
      return Response.json(
        await ctx.runMutation(internal.ivr.runtime.complete, {
          ...common,
          ...step,
          step: claim.step,
          selected,
        })
      )
    } catch (error) {
      return new Response(null, { status: status(error) })
    }
  })
}
export function registerIvrGatewayRoutes(http: HttpRouter) {
  http.route({
    path: "/calling/gateway/ivr/start",
    method: "POST",
    handler: handler(true),
  })
  http.route({
    path: "/calling/gateway/ivr/next",
    method: "POST",
    handler: handler(false),
  })
  http.route({
    pathPrefix: "/calling/ivr/audio/",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      try {
        const q = new URL(request.url).searchParams,
          callId = q.get("callId") ?? "",
          fileId = q.get("fileId") ?? "",
          expires = Number(q.get("expires")),
          signature = q.get("signature") ?? ""
        if (
          !(await verifyPrompt(
            process.env.CALL_GATEWAY_SECRET ?? "",
            callId,
            fileId,
            expires,
            signature
          ))
        )
          return new Response(null, { status: 401 })
        const file = await ctx.runQuery(internal.ivr.runtime.audio, {
          callId,
          fileId,
        })
        if (!file) return new Response(null, { status: 404 })
        const blob = await ctx.storage.get(file.storageId)
        return blob
          ? new Response(blob, {
              headers: {
                "content-type": file.contentType,
                "cache-control": "private, max-age=0",
              },
            })
          : new Response(null, { status: 404 })
      } catch (error) {
        return new Response(null, { status: status(error) })
      }
    }),
  })
}
