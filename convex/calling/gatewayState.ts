import { v } from "convex/values"
import { internalMutation } from "../_generated/server"
import { internal } from "../_generated/api"
import { apiError } from "../api/caller"
import { CALL_TERMINAL } from "../../lib/meta/calling"
import { retirement } from "../teamLifecycle"
import { string } from "../../lib/meta/parse"
import { recordActivity } from "./activity"
export const consume = internalMutation({
  args: {
    nonce: v.string(),
    expiresAt: v.number(),
    data: v.record(v.string(), v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { nonce, expiresAt, data }) => {
    if (
      await ctx.db
        .query("gatewayNonces")
        .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
        .unique()
    )
      throw apiError(401, "gateway_replay", "Gateway nonce was already used.")
    const nonceId = await ctx.db.insert("gatewayNonces", { nonce, expiresAt })
    await ctx.scheduler.runAfter(
      Math.max(0, expiresAt - Date.now()),
      internal.calling.gatewayState.expireNonce,
      { id: nonceId }
    )
    if (
      await ctx.db
        .query("gatewayEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", string(data.eventId)))
        .unique()
    )
      return null
    const id = ctx.db.normalizeId("calls", string(data.callId)),
      row = id ? await ctx.db.get("calls", id) : null
    if (
      !row ||
      row.mode !== "gateway" ||
      (await retirement(ctx, row.organizationId))
    )
      throw apiError(404, "call_not_found", "Gateway call not found.")
    const event = string(data.event),
      at = Number(data.timestamp)
    await ctx.db.insert("gatewayEvents", {
      organizationId: row.organizationId,
      eventId: string(data.eventId),
      callId: row._id,
      at,
      event,
    })
    if (event === "heartbeat" || event === "media_up")
      await recordActivity(ctx, row)
    if (event === "recording_ready") {
      await ctx.db.patch("calls", row._id, {
        gatewayRecordingFile: string(data.recordingFile),
      })
      await ctx.scheduler.runAfter(0, internal.calling.media.gatewayRecording, {
        id: row._id,
      })
    } else if (
      !CALL_TERMINAL.has(row.status) &&
      (event === "hangup" || at >= (row.gatewayAt ?? 0))
    ) {
      if (event === "answer_ready" || event === "offer_ready") {
        const sdp = string(data.answerSdp || data.offerSdp)
        if (row.localSession && row.localSession.sdp !== sdp)
          throw apiError(
            409,
            "call_sdp_conflict",
            "Gateway changed the call SDP."
          )
        await ctx.db.patch("calls", row._id, {
          localSession: {
            sdp_type: event === "answer_ready" ? "answer" : "offer",
            sdp,
          },
          gatewayAt: at,
        })
      } else if (event === "media_up")
        await ctx.db.patch("calls", row._id, {
          mediaUpAt: at,
          gatewayAt: at,
          ...(row.test
            ? {
                status: "connected" as const,
                connectedAt: row.connectedAt ?? at,
                observedAt: at,
              }
            : {}),
        })
      else if (event === "hangup")
        await ctx.scheduler.runAfter(
          0,
          row.test
            ? internal.calling.playground.ended
            : internal.calling.callActions.gatewayHangup,
          { id: row._id, at, reason: string(data.reason) }
        )
    }
    return null
  },
})
export const expireNonce = internalMutation({
  args: { id: v.id("gatewayNonces") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("gatewayNonces", id)
    if (row && row.expiresAt <= Date.now())
      await ctx.db.delete("gatewayNonces", id)
    return null
  },
})
