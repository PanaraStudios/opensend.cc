import { createNote, noteBody } from "../contactNotes"
import { botVoiceGender } from "../../services/call-gateway/src/voice/voices"
import { ConvexError } from "convex/values"
import { updateVoiceBotVoice } from "../../lib/voice-bot-defaults"
import {
  assembleCallerContext,
  callerContextEnabled,
} from "../../lib/voice-caller-context"
import { lookupContact } from "./callerContext"
import { own as ownedIvr } from "../ivr/definitions"
import {
  resolveCallPerson,
  resolveOrCreateCallPerson,
} from "../channels/identity"
import { knownUserForPhone } from "../calling/rows"
import { minuteUsage } from "./usage"
import { v } from "convex/values"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { apiError, notFound } from "../api/caller"
import { decryptSecret } from "../secrets"
import { requireActiveTeam } from "../teamLifecycle"
import { CALL_TERMINAL } from "../../lib/meta/calling"
import {
  validateTool,
  toolDeclarations,
  type VoiceToolName,
} from "../../lib/voice-bots"
import { object, string } from "../../lib/meta/parse"
import { createChannelMessage } from "../channels/messages"
import { availableAgent } from "./routing"
import { emitEvent } from "../events"
import { payload } from "../calling/rows"
const envelope = {
  nonce: v.string(),
  expiresAt: v.number(),
  data: v.record(v.string(), v.any()),
}
async function nonce(
  ctx: MutationCtx,
  value: { nonce: string; expiresAt: number }
) {
  if (
    await ctx.db
      .query("gatewayNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", value.nonce))
      .unique()
  )
    throw apiError(401, "gateway_replay", "Gateway nonce already used")
  const id = await ctx.db.insert("gatewayNonces", {
    nonce: value.nonce,
    expiresAt: value.expiresAt,
  })
  await ctx.scheduler.runAfter(
    Math.max(0, value.expiresAt - Date.now()),
    internal.calling.gatewayState.expireNonce,
    { id }
  )
}
async function gatewayCall(
  ctx: MutationCtx,
  data: Record<string, unknown>,
  active = true,
  bot = true
) {
  const id = ctx.db.normalizeId("calls", string(data.callId)),
    call = id ? await ctx.db.get("calls", id) : null
  if (
    !call ||
    call.mode !== "gateway" ||
    (bot && (!call.botId || !call.botConfig)) ||
    (active && (!call.botActive || CALL_TERMINAL.has(call.status))) ||
    (data.organizationId !== undefined &&
      data.organizationId !== call.organizationId)
  )
    throw notFound("Bot call")
  await requireActiveTeam(ctx, call.organizationId)
  return call
}
export const session = internalMutation({
  args: envelope,
  returns: v.any(),
  handler: async (ctx, args) => {
    await nonce(ctx, args)
    const call = await gatewayCall(ctx, args.data)
    const credential = await ctx.db.get(
      "voiceProviders",
      call.botConfig!.credentialId
    )
    if (
      !credential ||
      credential.organizationId !== call.organizationId ||
      credential.provider !== call.botConfig!.provider
    )
      throw notFound("Voice credential")
    const keys: Record<string, string> = {}
    if (call.botConfig!.engine === "gemini_live")
      keys.live = await decryptSecret(credential.encryptedKey)
    else
      for (const name of ["stt", "llm", "tts"] as const) {
        const stage = call.botConfig![name]
        const key = stage
          ? await ctx.db.get("voiceProviders", stage.credentialId)
          : null
        if (
          !key ||
          key.organizationId !== call.organizationId ||
          key.provider !== stage!.provider
        )
          throw notFound("Voice credential")
        keys[name] = await decryptSecret(key.encryptedKey)
      }
    const callerContextBlock = callerContextEnabled(
      call.botConfig?.callerContext
    )
      ? await assembleCallerContext(
          (deadline) => lookupContact(ctx, call, deadline),
          {
            onDiagnostic: (reason) => {
              console.error(
                `caller context unavailable call=${call._id} reason=${reason}`
              )
            },
          }
        )
      : undefined
    let liveVoices:
      { value: string; gender: "female" | "male" | "unknown" }[] | undefined
    const tts = call.botConfig!.tts
    if (
      call.botConfig!.engine !== "gemini_live" &&
      tts?.provider === "elevenlabs"
    ) {
      const cache = (
        await ctx.db
          .query("elevenLabsVoiceCaches")
          .withIndex("by_credentialId", (q) =>
            q.eq("credentialId", tts.credentialId)
          )
          .take(1)
      )[0]
      // No row keeps the static Sarah/Adam fallback. An empty cache is unknown.
      if (cache) liveVoices = cache.voices
    }
    return {
      ...updateVoiceBotVoice(call.botConfig!, liveVoices),
      voiceGender: botVoiceGender(call.botConfig!, liveVoices),
      botId: call.botId,
      keys,
      toolCatalog: toolDeclarations(call.botConfig!.tools as VoiceToolName[]),
      ...(callerContextBlock ? { callerContextBlock } : {}),
    }
  },
})
export const tool = internalMutation({
  args: envelope,
  returns: v.any(),
  handler: async (ctx, args) => {
    await nonce(ctx, args)
    const call = await gatewayCall(ctx, args.data)
    const request = object(args.data.toolCall),
      arguments_ = object(request.arguments)
    const toolCall = {
      id: string(request.id),
      name: string(request.name),
      arguments: arguments_,
    }
    try {
      validateTool(toolCall)
    } catch {
      return { ok: false, error: "Invalid tool arguments" }
    }
    if (!call.botConfig!.tools.includes(toolCall.name))
      return { ok: false, error: "Tool is not enabled for this bot" }
    const previous = await ctx.db
      .query("callTranscripts")
      .withIndex("by_callId_and_toolId", (q) =>
        q.eq("callId", call._id).eq("toolId", toolCall.id)
      )
      .unique()
    const serialized = JSON.stringify(arguments_)
    if (previous)
      return previous.toolName === toolCall.name &&
        previous.arguments === serialized
        ? JSON.parse(previous.result!)
        : { ok: false, error: "Tool id reused with different arguments" }
    const lifetime = await ctx.db
      .query("callTranscripts")
      .withIndex("by_callId", (q) => q.eq("callId", call._id))
      .take(2001)
    if (
      lifetime.length > 2000 ||
      lifetime.filter((line) => line.kind === "tool").length >= 128
    )
      return { ok: false, error: "Call tool limit reached" }
    let result: { ok: boolean; result?: unknown; error?: string }
    // Side effects and durable deduplication commit in the same transaction.
    try {
      result = {
        ok: true,
        result: await execute(
          ctx,
          call,
          toolCall.name as VoiceToolName,
          arguments_
        ),
      }
    } catch (error) {
      result = {
        ok: false,
        // These are backend validation/availability errors, never provider SDK exceptions.
        error: (error instanceof ConvexError && typeof error.data === "string"
          ? error.data
          : error instanceof Error
            ? error.message
            : "Tool could not be completed for this caller"
        ).slice(0, 512),
      }
    }
    await ctx.db.insert("callTranscripts", {
      organizationId: call.organizationId,
      callId: call._id,
      eventId: `tool:${toolCall.id}`,
      kind: "tool",
      timestampMs: callTimestamp(call),
      timeline: "call",
      toolId: toolCall.id,
      toolName: toolCall.name,
      arguments: serialized,
      result: JSON.stringify(result),
    })
    return result
  },
})
async function execute(
  ctx: MutationCtx,
  call: Doc<"calls">,
  name: VoiceToolName,
  args: Record<string, unknown>
) {
  switch (name) {
    case "lookup_contact": {
      const lookup = await lookupContact(ctx, call)
      const { found, ...profile } = lookup
      if (!found) return { contact: null }
      return profile
    }
    case "create_note": {
      const body = noteBody(string(args.text))
      const person = await resolveOrCreateCallPerson(ctx, call)
      if (person.contact || person.identity)
        await ctx.db.patch("calls", call._id, {
          ...(person.contact ? { contactId: person.contact._id } : {}),
          ...(person.identity ? { channelContactId: person.identity._id } : {}),
          ...(person.conversationId
            ? { conversationId: person.conversationId }
            : {}),
        })
      await ctx.db.insert("callTranscripts", {
        organizationId: call.organizationId,
        callId: call._id,
        eventId: crypto.randomUUID(),
        kind: "note",
        text: body,
        timestampMs: callTimestamp(call),
        timeline: "call",
      })
      if (person.contact) {
        const note = await createNote(ctx, person.contact, {
          body,
          author: { kind: "bot", id: call.botId!, name: call.botConfig!.name },
          source: { callId: call._id },
        })
        return { noteId: note._id, storedOn: "contact" }
      }
      return {
        storedOn: "call",
        message: "Saved on the call record; caller identity unavailable.",
      }
    }
    case "send_whatsapp_message": {
      if (call.test)
        return {
          test: true,
          action: "send_whatsapp_message",
          preview: args,
          message: "Test preview; no message sent",
        }
      const person = await resolveCallPerson(ctx, call)
      const account = await ctx.db.get("channelAccounts", call.accountId)
      const userId =
        call.userId ??
        (account && person.phone
          ? await knownUserForPhone(ctx, account, person.phone)
          : undefined)
      if (!userId && !person.phone)
        throw new Error("Caller identity unavailable")
      const body = args.template
        ? { template: object(JSON.parse(string(args.template))) }
        : { text: { body: string(args.text) } }
      return {
        id: await createChannelMessage(
          ctx,
          {
            channel: "whatsapp",
            from: call.accountId,
            to: userId ? undefined : (person.phone ?? undefined),
            body: {
              ...(userId ? { recipient: userId } : {}),
              ...body,
            },
          },
          { organizationId: call.organizationId, source: "api" }
        ),
      }
    }
    case "transfer_to_ivr": {
      const id = call.botConfig!.handoff.ivrId
      if (!id) throw new Error("IVR handoff disabled")
      const ivr = await ownedIvr(ctx, call.organizationId, id)
      await ctx.db.patch("calls", call._id, { ivrHandoffId: ivr._id })
      return { action: "transfer_to_ivr", ivrId: ivr._id }
    }
    case "transfer_to_agent": {
      if (!call.botConfig!.handoff.agents)
        throw new Error("Agent handoff disabled")
      const agent = await availableAgent(ctx, call)
      if (!agent) throw new Error("No agent available")
      await ctx.db.patch("calls", call._id, {
        botSummary: string(args.summary).slice(0, 4000),
      })
      return { action: "transfer_to_agent", extension: agent.extension }
    }
    case "end_call":
      return { action: "end_call" }
  }
}
export const event = internalMutation({
  args: envelope,
  returns: v.null(),
  handler: async (ctx, args) => {
    await nonce(ctx, args)
    const call = await gatewayCall(ctx, args.data, false, false),
      data = args.data,
      eventId = string(data.eventId)
    if (
      await ctx.db
        .query("callTranscripts")
        .withIndex("by_callId_and_eventId", (q) =>
          q.eq("callId", call._id).eq("eventId", eventId)
        )
        .unique()
    )
      return null
    if (
      data.type === "state" &&
      call.botConfig &&
      ["hangup", "agent"].includes(string(data.state))
    )
      await ctx.db.patch("calls", call._id, { botActive: false })
    if (
      ["bot_completed", "usage"].includes(string(data.type)) &&
      !call.botConfig
    )
      throw notFound("Bot call")
    if (data.type === "bot_completed") {
      if (call.botEndedAt) return null
      const at = Math.min(Date.now(), Number(data.endedAt ?? data.timestamp)),
        outcome = string(data.outcome)
      if (
        ![
          "completed",
          "transferred_agent",
          "transferred_ivr",
          "ended_by_bot",
          "caller_hangup",
          "failed",
        ].includes(outcome)
      )
        throw apiError(400, "invalid_event", "Invalid bot outcome")
      const botOutcome = outcome as NonNullable<Doc<"calls">["botOutcome"]>
      const finalUsage = usage(data.usage),
        totalUsage = { ...call.botUsage }
      for (const [key, value] of Object.entries(finalUsage)) {
        const metric = key as keyof typeof totalUsage
        totalUsage[metric] =
          Math.max(
            0,
            (totalUsage[metric] ?? 0) - (call.botSessionUsage?.[metric] ?? 0)
          ) + value
      }
      await ctx.db.patch("calls", call._id, {
        botActive: false,
        botEndedAt: at,
        botDuration:
          (call.botDuration ?? 0) +
          Math.min(
            call.botConfig!.maxDurationSeconds,
            Math.max(
              0,
              (at - (call.botSessionStartedAt ?? call.botStartedAt!)) / 1000
            )
          ),
        botOutcome,
        botSummary: string(data.summary).slice(0, 4000),
        botUsage: totalUsage,
        botSessionUsage: finalUsage,
      })
      const updated = (await ctx.db.get("calls", call._id))!
      if (!call.test) await minuteUsage.replaceOrInsert(ctx, call, updated)
      if (!call.test)
        await emitEvent(
          ctx,
          call.organizationId,
          botOutcome.startsWith("transferred_")
            ? "whatsapp.call.transferred"
            : "whatsapp.call.bot_completed",
          await payload(ctx, updated)
        )
    } else if (data.type === "usage") {
      const delta = usage(data.usage),
        old = call.botUsage ?? {}
      const summed = { ...old },
        sessionUsage = { ...call.botSessionUsage }
      for (const [key, value] of Object.entries(delta)) {
        const metric = key as keyof typeof summed
        summed[metric] = (old[metric] ?? 0) + value
        sessionUsage[metric] = (sessionUsage[metric] ?? 0) + value
      }
      await ctx.db.patch("calls", call._id, {
        botUsage: summed,
        botSessionUsage: sessionUsage,
      })
    }
    const line = object(data.transcript)
    const supplied = Number(line.timestampMs)
    await ctx.db.insert("callTranscripts", {
      organizationId: call.organizationId,
      callId: call._id,
      eventId,
      kind: data.type === "transcript" ? "transcript" : "media",
      // Transcript lines already include the gateway session offset.
      timestampMs:
        data.type === "transcript" &&
        Number.isFinite(supplied) &&
        supplied >= 0
          ? Math.round(supplied)
          : callTimestamp(call, Number(data.timestamp)),
      timeline: "call",
      ...(data.type === "transcript"
        ? {
            role: line.role as "caller" | "agent",
            text: string(line.text).slice(0, 16000),
            final: line.final === true,
          }
        : {
            text: JSON.stringify(
              data.type === "bot_completed" ? { type: data.type } : data
            ).slice(0, 16000),
          }),
    })
    return null
  },
})
/** Milliseconds since the call was answered. */
function callTimestamp(call: Doc<"calls">, at = Date.now()) {
  const origin = call.connectedAt ?? call.botStartedAt ?? call._creationTime
  const delta = at - origin
  return Number.isFinite(delta) ? Math.max(0, Math.round(delta)) : 0
}
function usage(value: unknown) {
  const input = object(value),
    result: NonNullable<Doc<"calls">["botUsage"]> = {}
  for (const key of [
    "inputTokens",
    "outputTokens",
    "audioSeconds",
    "ttsCharacters",
  ] as const)
    if (
      typeof input[key] === "number" &&
      Number.isFinite(input[key]) &&
      input[key] >= 0 &&
      input[key] <= 1e9
    )
      result[key] = input[key]
  return result
}
