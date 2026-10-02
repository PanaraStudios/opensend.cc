"use node"
import { ConvexError, v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { ActionCtx } from "../_generated/server"
import { actorArgs } from "./rows"
import { graph, markTokenInvalid } from "../meta/graph"
import { decryptSecret } from "../secrets"
import { MetaError } from "../../lib/meta/errors"
import {
  CALL_ERRORS,
  CALL_TERMINAL,
  callOptions,
  validateSdp,
} from "../../lib/meta/calling"
import { object, string, array } from "../../lib/meta/parse"
import { apiError, invalid } from "../api/caller"
import { CallGatewayClient } from "../../services/call-gateway/src/client"
import { GatewayError } from "../../services/call-gateway/src/errors"

export function gateway() {
  if (!process.env.CALL_GATEWAY_URL || !process.env.CALL_GATEWAY_SECRET)
    throw apiError(
      503,
      "gateway_unavailable",
      "The calling gateway is not configured."
    )
  return new CallGatewayClient(
    process.env.CALL_GATEWAY_URL,
    process.env.CALL_GATEWAY_SECRET
  )
}
export function callingFailure(error: unknown): never {
  if (error instanceof MetaError) {
    const [name, message, status] = CALL_ERRORS[error.code ?? 0] ?? [
      "meta_call_failed",
      error.message,
      error.status >= 500 ? 503 : 422,
    ]
    throw apiError(
      status,
      name,
      `${message}${error.code ? ` (Meta ${error.code})` : ""}`
    )
  }
  if (error instanceof GatewayError)
    throw apiError(error.status, error.code.toLowerCase(), error.message)
  if (error instanceof ConvexError) throw error
  throw apiError(
    503,
    "calling_service_unavailable",
    "Could not reach the calling service. Inspect the call log before retrying."
  )
}
export async function signal(
  ctx: ActionCtx,
  target: {
    encryptedToken: string
    version: string
    phoneNumberId: string
    connectionId?: Id<"metaConnections">
  },
  body: object
) {
  try {
    return await graph({
      token: await decryptSecret(target.encryptedToken),
      version: target.version,
      method: "POST",
      path: `${target.phoneNumberId}/calls`,
      body: { json: { messaging_product: "whatsapp", ...body } },
    })
  } catch (error) {
    if (error instanceof MetaError && error.code === 190 && target.connectionId)
      await markTokenInvalid(ctx, target.connectionId)
    callingFailure(error)
  }
}
const options = (input: Record<string, unknown>) => {
  try {
    return callOptions(input)
  } catch (e) {
    throw invalid((e as Error).message)
  }
}
const sdp = (value: unknown) => {
  try {
    return validateSdp(value)
  } catch (e) {
    throw invalid((e as Error).message)
  }
}
const getContext = (ctx: ActionCtx, id: Id<"calls">) =>
  ctx.runQuery(internal.calling.rows.context, { id })
async function active(ctx: ActionCtx, id: Id<"calls">) {
  const target = await getContext(ctx, id)
  if (!target || CALL_TERMINAL.has(target.call.status)) return null
  return target
}
async function cleanupCall(ctx: ActionCtx, id: Id<"calls">) {
  const call = await ctx.runQuery(internal.calling.rows.cleanupContext, { id })
  if (call?.mode === "gateway") await gateway().hangup(id)
}
export const cleanup = internalAction({
  args: { id: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await cleanupCall(ctx, id)
    return null
  },
})
export const connect = internalAction({
  args: {
    ...actorArgs,
    agentPresenceId: v.optional(v.id("callAgents")),
    agentLeaseId: v.optional(v.string()),
    input: v.record(v.string(), v.any()),
  },
  returns: v.object({ id: v.id("calls") }),
  handler: connectCall,
})
export async function connectCall(
  ctx: ActionCtx,
  {
    input,
    agentPresenceId,
    agentLeaseId,
    ...actor
  }: {
    organizationId: string
    caller?: import("../api/caller").Caller
    agentPresenceId?: Id<"callAgents">
    agentLeaseId?: string
    input: Record<string, unknown>
  }
): Promise<{ id: Id<"calls"> }> {
  if (
    input.route !== undefined &&
    input.route !== "gateway" &&
    input.route !== "api"
  )
    throw invalid("route must be gateway or api.")
  const extra = options(input)
  const target = await ctx.runQuery(internal.calling.rows.target, {
    ...actor,
    from: typeof input.from === "string" ? input.from : undefined,
    write: true,
  })
  const mode =
    (input.route as "gateway" | "api" | undefined) ??
    (input.session
      ? "api"
      : (target.settings?.mode ??
        (process.env.CALL_GATEWAY_URL && process.env.CALL_GATEWAY_SECRET
          ? "gateway"
          : "api")))
  const session = object(input.session)
  if (mode === "api" && session.sdp_type !== "offer")
    throw invalid("API calls require session.sdp_type=offer.")
  if (mode === "gateway" && input.session !== undefined)
    throw invalid("Gateway calls generate their own SDP.")
  const offer = mode === "api" ? sdp(session.sdp) : undefined
  const id = await ctx.runMutation(internal.calling.rows.create, {
    ...actor,
    from: typeof input.from === "string" ? input.from : undefined,
    to: typeof input.to === "string" ? input.to : undefined,
    recipient:
      typeof input.recipient === "string" ? input.recipient : undefined,
    mode,
    opaque: extra.biz_opaque_callback_data as string | undefined,
    agentPresenceId,
    agentLeaseId,
  })
  const operation = crypto.randomUUID()
  await ctx.runMutation(internal.calling.rows.lease, { id, operation })
  try {
    const offerSdp = offer ?? (await gateway().outbound(id)).offerSdp
    const signaling = await active(ctx, id)
    if (!signaling)
      throw apiError(409, "call_ended", "Call ended during media setup.")
    const reply = object(
      await signal(
        ctx,
        {
          ...target,
          phoneNumberId: target.account.externalId,
          connectionId: target.account.connectionId,
        },
        {
          action: "connect",
          recipient: signaling.call.userId,
          ...(signaling.call.to ? { to: signaling.call.to } : {}),
          session: { sdp_type: "offer", sdp: offerSdp },
          ...extra,
        }
      )
    )
    const wacid = string(object(array(reply.calls)[0]).id)
    if (!wacid)
      throw apiError(502, "invalid_meta_response", "Meta returned no call id.")
    await ctx.runMutation(internal.calling.rows.finish, {
      id,
      wacid,
      status: "ringing",
      session: { sdp_type: "offer", sdp: offerSdp },
      operation,
    })
    // A connect webhook may already have supplied the answer before Graph returned.
    const current = await active(ctx, id)
    if (
      mode === "gateway" &&
      current?.call.remoteSession?.sdp_type === "answer"
    )
      await ctx.scheduler.runAfter(
        0,
        internal.calling.callActions.gatewayConnect,
        { id }
      )
    return { id }
  } catch (error) {
    await ctx.runMutation(internal.calling.rows.finish, {
      id,
      status: "failed",
      error:
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "message" in error.data
          ? String(error.data.message)
          : error instanceof Error
            ? error.message
            : "Call failed",
      errorCode: error instanceof MetaError ? error.code : undefined,
      operation,
    })
    if (mode === "gateway") await cleanupCall(ctx, id)
    callingFailure(error)
  }
}

export const perform = internalAction({
  args: {
    ...actorArgs,
    id: v.string(),
    expectedAgentLeaseId: v.optional(v.string()),
    action: v.union(
      v.literal("pre_accept"),
      v.literal("accept"),
      v.literal("reject"),
      v.literal("terminate")
    ),
    input: v.record(v.string(), v.any()),
  },
  returns: v.object({ id: v.id("calls"), success: v.boolean() }),
  handler: performCall,
})
export async function performCall(
  ctx: ActionCtx,
  {
    id,
    action,
    input,
    expectedAgentLeaseId,
    ...actor
  }: {
    organizationId: string
    caller?: import("../api/caller").Caller
    id: string
    expectedAgentLeaseId?: string
    action: "pre_accept" | "accept" | "reject" | "terminate"
    input: Record<string, unknown>
  }
): Promise<{ id: Id<"calls">; success: boolean }> {
  const target = await ctx.runQuery(internal.calling.rows.target, {
    ...actor,
    id,
    write: true,
  })
  const row = target.call!
  if (CALL_TERMINAL.has(row.status)) {
    if (action === "terminate" || action === "reject")
      return { id: row._id, success: true }
    throw apiError(409, "call_ended", "The call has ended.")
  }
  if (!row.wacid)
    throw apiError(409, "call_pending", "Meta has not assigned a call id.")
  if (
    (action === "accept" || action === "pre_accept") &&
    row.direction !== "inbound"
  )
    throw invalid("Only user-initiated calls can be accepted.")
  if (action === "accept" || action === "pre_accept") {
    const policy = JSON.parse(target.settings?.settings ?? "{}") as Record<
      string,
      unknown
    >
    if (
      policy.status === "DISABLED" ||
      policy.call_icon_visibility === "DISABLE_ALL"
    )
      throw apiError(
        422,
        "calling_disabled",
        "Incoming calling is disabled for this phone number."
      )
    if ((row.offeredAt ?? row._creationTime) + 60000 < Date.now())
      throw apiError(
        409,
        "call_timeout",
        "The incoming call acceptance window has expired."
      )
  }
  const extra = action === "accept" ? options(input) : {}
  let answer: string | undefined
  if (action === "accept" || action === "pre_accept") {
    const session = object(input.session)
    if (row.mode === "api" && session.sdp_type !== "answer")
      throw invalid("API acceptance requires session.sdp_type=answer.")
    answer = row.mode === "api" ? sdp(session.sdp) : row.localSession?.sdp
    if (row.preAcceptedSdp && answer && row.preAcceptedSdp !== answer)
      throw apiError(
        409,
        "call_sdp_conflict",
        "accept must use the same SDP as pre_accept."
      )
    if (row.status === "connected") return { id: row._id, success: true }
    if (action === "pre_accept" && row.preAcceptedSdp)
      return { id: row._id, success: true }
  }
  const operation = crypto.randomUUID()
  await ctx.runMutation(internal.calling.rows.lease, {
    id: row._id,
    operation,
    expectedAgentLeaseId,
  })
  try {
    if ((action === "accept" || action === "pre_accept") && !answer) {
      if (!row.remoteSession?.sdp)
        throw apiError(
          409,
          "call_offer_missing",
          "The incoming offer is unavailable."
        )
      answer = (await gateway().inbound(row.remoteSession.sdp, row._id))
        .answerSdp
    }
    if (!(await active(ctx, row._id)))
      throw apiError(409, "call_ended", "The call has ended.")
    await signal(
      ctx,
      {
        ...target,
        phoneNumberId: target.account.externalId,
        connectionId: target.account.connectionId,
      },
      {
        action,
        call_id: row.wacid,
        ...(answer ? { session: { sdp_type: "answer", sdp: answer } } : {}),
        ...extra,
      }
    )
    if (action === "reject")
      await signal(
        ctx,
        {
          ...target,
          phoneNumberId: target.account.externalId,
          connectionId: target.account.connectionId,
        },
        { action: "terminate", call_id: row.wacid }
      )
    // Graph acceptance alone releases media; callbacks never trigger this route.
    const current = await ctx.runMutation(internal.calling.rows.finish, {
      id: row._id,
      operation,
      ...(answer ? { session: { sdp_type: "answer", sdp: answer } } : {}),
      ...(action === "pre_accept"
        ? { preAcceptedSdp: answer }
        : {
            status:
              action === "accept"
                ? "connected"
                : action === "reject"
                  ? "rejected"
                  : "completed",
          }),
    })
    if (row.mode === "gateway") {
      if (CALL_TERMINAL.has(current.status)) await cleanupCall(ctx, row._id)
      else if (action === "accept") {
        const route = await ctx.runMutation(internal.voice.routing.select, {
          id: row._id,
        })
        await gateway().route(route)
        await ctx.runMutation(internal.calling.rows.finish, {
          id: row._id,
          routed: true,
        })
      }
    }
    return { id: row._id, success: true }
  } catch (error) {
    await ctx.runMutation(internal.calling.rows.finish, {
      id: row._id,
      operation,
      ...(row.mode === "gateway"
        ? {
            status: "failed",
            error:
              error instanceof Error ? error.message : "Gateway call failed",
          }
        : {}),
    })
    if (row.mode === "gateway") {
      await cleanupCall(ctx, row._id)
      await signal(
        ctx,
        {
          ...target,
          phoneNumberId: target.account.externalId,
          connectionId: target.account.connectionId,
        },
        { action: "terminate", call_id: row.wacid }
      ).catch(() => undefined)
    }
    callingFailure(error)
  }
}

export const gatewayConnect = internalAction({
  args: { id: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const target = await active(ctx, id)
    if (!target || target.call.mode !== "gateway" || target.call.gatewayRouted)
      return null
    const row = target.call
    if (row.direction === "outbound") {
      if (row.remoteSession?.sdp_type !== "answer") return null
      try {
        await gateway().remoteAnswer(id, row.remoteSession.sdp)
        if (!(await active(ctx, id))) {
          await cleanupCall(ctx, id)
          return null
        }
        await gateway().route({
          callId: id,
          target: row.agentExtension ? "agent" : "ivr",
          extension: row.agentExtension,
        })
        await ctx.runMutation(internal.calling.rows.finish, {
          id,
          routed: true,
        })
      } catch (error) {
        await ctx.runMutation(internal.calling.rows.finish, {
          id,
          status: "failed",
          error:
            error instanceof Error ? error.message : "Gateway setup failed",
        })
        await cleanupCall(ctx, id)
        if (row.wacid)
          await signal(ctx, target, {
            action: "terminate",
            call_id: row.wacid,
          }).catch(() => undefined)
      }
    } else {
      // Park inbound audio and prepare the answer; API acceptance chooses when to release it.
      const operation = crypto.randomUUID()
      try {
        await ctx.runMutation(internal.calling.rows.lease, { id, operation })
      } catch {
        return null
      }
      try {
        if (!row.remoteSession?.sdp) return null
        const { answerSdp } = await gateway().inbound(row.remoteSession.sdp, id)
        if (!(await active(ctx, id))) {
          await cleanupCall(ctx, id)
          return null
        }
        await signal(ctx, target, {
          action: "pre_accept",
          call_id: row.wacid,
          session: { sdp_type: "answer", sdp: answerSdp },
        })
        await ctx.runMutation(internal.calling.rows.finish, {
          id,
          operation,
          session: { sdp_type: "answer", sdp: answerSdp },
          preAcceptedSdp: answerSdp,
        })
        if (
          target.settings?.routing?.kind === "ivr" ||
          target.settings?.routing?.kind === "bot" ||
          target.settings?.routing?.kind === "agents"
        ) {
          await signal(ctx, target, {
            action: "accept",
            call_id: row.wacid,
            session: { sdp_type: "answer", sdp: answerSdp },
          })
          const accepted = await ctx.runMutation(internal.calling.rows.finish, {
            id,
            status: "connected",
          })
          if (CALL_TERMINAL.has(accepted.status)) return null
          const route = await ctx.runMutation(internal.voice.routing.select, {
            id,
          })
          await gateway().route(route)
          await ctx.runMutation(internal.calling.rows.finish, {
            id,
            routed: true,
          })
        }
        await ctx.scheduler.runAfter(
          Math.max(
            0,
            (row.offeredAt ?? row._creationTime) + 60000 - Date.now()
          ),
          internal.calling.callActions.timeout,
          { id }
        )
      } catch (error) {
        await ctx.runMutation(internal.calling.rows.finish, {
          id,
          operation,
          status: "failed",
          error:
            error instanceof Error ? error.message : "Gateway setup failed",
        })
        await cleanupCall(ctx, id)
        if (row.wacid)
          await signal(ctx, target, {
            action: "terminate",
            call_id: row.wacid,
          }).catch(() => undefined)
      }
    }
    return null
  },
})
export const timeout = internalAction({
  args: { id: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const target = await active(ctx, id)
    if (!target || target.call.status === "connected") return null
    if (target.call.wacid)
      await signal(ctx, target, {
        action: "terminate",
        call_id: target.call.wacid,
      })
    await ctx.runMutation(internal.calling.rows.finish, {
      id,
      status: target.call.wacid ? "missed" : "failed",
      ...(target.call.wacid
        ? {}
        : { error: "Call setup timed out before Meta assigned a call id." }),
    })
    if (target.call.mode === "gateway") await cleanupCall(ctx, id)
    return null
  },
})
export const gatewayHangup = internalAction({
  args: { id: v.id("calls"), at: v.number(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, at, reason }) => {
    const target = await active(ctx, id)
    if (!target || at < target.call.observedAt) return null
    if (target.call.wacid)
      await signal(ctx, target, {
        action: "terminate",
        call_id: target.call.wacid,
      })
    await ctx.runMutation(internal.calling.rows.finish, {
      id,
      status: target.call.connectedAt ? "completed" : "missed",
      error: reason,
    })
    await cleanupCall(ctx, id)
    return null
  },
})

export const disposeGateway = internalAction({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (_ctx, { id }) => {
    await gateway().hangup(id)
    return null
  },
})

export const blockInbound = internalAction({
  args: { id: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const target = await active(ctx, id)
    if (!target) return null
    if (target.call.wacid)
      await signal(ctx, target, {
        action: "terminate",
        call_id: target.call.wacid,
      })
    await ctx.runMutation(internal.calling.rows.finish, {
      id,
      status: "missed",
    })
    if (target.call.mode === "gateway") await cleanupCall(ctx, id)
    return null
  },
})
