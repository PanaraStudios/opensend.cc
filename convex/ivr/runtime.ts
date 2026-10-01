import { availableAgent, selectBot } from "../voice/routing"
import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import { apiError, invalid, notFound } from "../api/caller"
import { retirement } from "../teamLifecycle"
import { CALL_TERMINAL } from "../../lib/meta/calling"
import {
  isIvrOpen,
  parseIvrAction,
  IVR_LIMITS,
  type IvrAction,
  type IvrPrompt,
} from "../../lib/ivr"
import { renderHash, signPrompt } from "../../lib/ivr-prompts"
import { audioFile, own, readDefinition, checkAction } from "./definitions"
import { action } from "./validators"
import { decryptSecret } from "../secrets"
import { emitEvent } from "../events"
import type { Doc, Id } from "../_generated/dataModel"
import type { IvrDecision } from "../../services/call-gateway/src/ivr-contracts"

export const requestArgs = {
  callId: v.id("calls"),
  ivrId: v.id("ivrs"),
  origin: v.string(),
}
const nonceArgs = { nonce: v.string(), expiresAt: v.number() }
async function nonce(
  ctx: MutationCtx,
  value: typeof nonceArgs.nonce.type,
  expiresAt: number
) {
  if (
    await ctx.db
      .query("gatewayNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", value))
      .unique()
  )
    throw apiError(401, "gateway_replay", "Gateway nonce was already used")
  const id = await ctx.db.insert("gatewayNonces", { nonce: value, expiresAt })
  await ctx.scheduler.runAfter(
    Math.max(0, expiresAt - Date.now()),
    internal.calling.gatewayState.expireNonce,
    { id }
  )
}
async function liveCall(ctx: QueryCtx, id: Id<"calls">) {
  const call = await ctx.db.get("calls", id)
  if (
    !call ||
    call.mode !== "gateway" ||
    CALL_TERMINAL.has(call.status) ||
    (await retirement(ctx, call.organizationId))
  )
    throw notFound("Active gateway call")
  return call
}
async function session(ctx: QueryCtx, callId: Id<"calls">, ivrId: Id<"ivrs">) {
  const call = await liveCall(ctx, callId)
  const s = await ctx.db
    .query("ivrSessions")
    .withIndex("by_callId", (q) => q.eq("callId", callId))
    .unique()
  if (!s || s.organizationId !== call.organizationId || s.ivrId !== ivrId)
    throw notFound("IVR session")
  return { call, s }
}
async function promptUrl(
  ctx: QueryCtx,
  s: Doc<"ivrSessions">,
  p: IvrPrompt,
  origin: string
) {
  let fileId = p.kind === "audio" ? p.fileId : undefined
  if (p.kind === "tts") {
    const hash = await renderHash(s.definition, p)
    const render = await ctx.db
      .query("ivrPromptRenders")
      .withIndex("by_organizationId_and_hash", (q) =>
        q.eq("organizationId", s.organizationId).eq("hash", hash)
      )
      .unique()
    if (render?.status !== "ready" || !render.fileId)
      throw invalid("IVR prompt is pending_render")
    fileId = render.fileId
  }
  const file = await audioFile(ctx, s.organizationId, fileId!)
  const expires = Date.now() + 10 * 60_000
  const signature = await signPrompt(
    process.env.CALL_GATEWAY_SECRET ?? "",
    s.callId,
    file._id,
    expires
  )
  // Filename extension helps libsndfile select the format after http_cache fetches it.
  const ext = file.contentType.includes("ogg")
    ? "ogg"
    : /mpeg|mp3/.test(file.contentType)
      ? "mp3"
      : "wav"
  const url = new URL(`/calling/ivr/audio/prompt.${ext}`, origin)
  url.search = new URLSearchParams({
    callId: s.callId,
    fileId: file._id,
    expires: String(expires),
    signature,
  }).toString()
  return url.toString()
}
async function record(
  ctx: MutationCtx,
  call: Doc<"calls">,
  s: Doc<"ivrSessions">,
  menuId: string,
  digits: string,
  selected: typeof action.type
) {
  const path = [
    ...(call.ivrPath ?? []),
    { menuId, digits, action: selected, at: Date.now() },
  ]
  if (path.length > IVR_LIMITS.steps) throw invalid("IVR step limit exceeded")
  const final = selected.kind !== "submenu"
  await ctx.db.patch("calls", call._id, {
    ivrId: s.ivrId,
    ivrPath: path,
    ...(final ? { ivrOutcome: selected } : {}),
  })
  await ctx.db.patch("ivrSessions", s._id, {
    step: s.step + 1,
    deciding: false,
    menuId: selected.kind === "submenu" ? selected.menuId : undefined,
    ...(final ? { finalAction: selected } : {}),
  })
  if (final && !call.test)
    await emitEvent(ctx, call.organizationId, "whatsapp.call.ivr_completed", {
      id: call._id,
      account_id: call.accountId,
      ivr_id: s.ivrId,
      path,
      final_action: selected,
    })
}
async function decision(
  ctx: MutationCtx,
  call: Doc<"calls">,
  s: Doc<"ivrSessions">,
  selected: IvrAction,
  origin: string,
  fallback: IvrAction = { kind: "hangup" }
): Promise<IvrDecision> {
  await checkAction(ctx, s.organizationId, s.definition, selected)
  const base = { step: s.step, organizationId: s.organizationId }
  if (selected.kind === "submenu") {
    const m = s.definition.menus.find((m) => m.id === selected.menuId)!
    try {
      const promptUrlValue = await promptUrl(ctx, s, m.prompt, origin)
      const invalidUrl = m.invalidPrompt
        ? await promptUrl(ctx, s, m.invalidPrompt, origin)
        : undefined
      return {
        ...base,
        action: { kind: "submenu", menuId: m.id },
        menu: {
          id: m.id,
          promptUrl: promptUrlValue,
          ...(invalidUrl ? { invalidUrl } : {}),
          timeoutSeconds: m.timeoutSeconds,
          retries: m.retries,
          maxDigits: m.maxDigits,
          digits: Object.keys(m.options),
        },
      }
    } catch {
      // Pending/unavailable prompts never leave a caller in a silent menu loop.
      if (fallback.kind === "submenu")
        return decision(ctx, call, s, { kind: "hangup" }, origin)
      return decision(ctx, call, s, fallback, origin)
    }
  }
  if (selected.kind === "bot") {
    const route = await selectBot(ctx, call, selected.botId)
    return {
      ...base,
      action:
        route.target === "bot"
          ? { kind: "bot", botId: route.botId! }
          : route.target === "agent"
            ? { kind: "agents" }
            : { kind: "voicemail" },
      ...("extension" in route ? { extension: route.extension } : {}),
      route,
    }
  }
  if (selected.kind === "agents") {
    const agent = await availableAgent(ctx, call)
    if (!agent)
      return decision(
        ctx,
        call,
        s,
        fallback.kind === "agents" ? { kind: "voicemail" } : fallback,
        origin
      )
    return { ...base, action: selected, extension: agent.extension }
  }
  if (selected.kind === "playAndHangup") {
    try {
      return {
        ...base,
        action: selected,
        promptUrl: await promptUrl(ctx, s, selected.prompt, origin),
      }
    } catch {
      return { ...base, action: { kind: "hangup" } }
    }
  }
  if (selected.kind === "webhook")
    throw invalid("Webhook action must be resolved by an action")
  return { ...base, action: selected }
}
// Convert wire decisions back to the persisted action; audio URLs are never stored.
function persisted(d: IvrDecision): typeof action.type {
  return d.action as typeof action.type
}
export const start = internalMutation({
  args: { ...requestArgs, ...nonceArgs },
  returns: v.any(),
  handler: async (ctx, args) => {
    await nonce(ctx, args.nonce, args.expiresAt)
    const call = await liveCall(ctx, args.callId)
    const existing = await ctx.db
      .query("ivrSessions")
      .withIndex("by_callId", (q) => q.eq("callId", call._id))
      .unique()

    const row = await own(ctx, call.organizationId, args.ivrId)
    // The settings authorization is resolved from persisted call ownership, never a supplied team.
    const settings = await ctx.db
      .query("callingSettings")
      .withIndex("by_accountId", (q) => q.eq("accountId", call.accountId))
      .unique()
    const botHandoff =
      call.ivrHandoffId === row._id &&
      call.botConfig?.handoff.ivrId === row._id &&
      call.botOutcome === "transferred_ivr" &&
      !call.botActive
    if (existing && (!existing.finalAction || !botHandoff))
      throw apiError(409, "ivr_started", "IVR is already started")
    if (
      !botHandoff &&
      (call.test
        ? call.ivrId !== row._id
        : settings?.routing?.kind !== "ivr" ||
          settings.routing.ivrId !== row._id)
    )
      throw notFound("Assigned IVR")
    if (botHandoff)
      await ctx.db.patch("calls", call._id, { ivrHandoffId: undefined })
    if (existing) await ctx.db.delete("ivrSessions", existing._id)
    const id = await ctx.db.insert("ivrSessions", {
      organizationId: call.organizationId,
      callId: call._id,
      ivrId: row._id,
      definition: readDefinition(
        row
      ) as typeof import("./validators").definition.type,
      webhookSecret: row.webhookSecret,
      step: 0,
      deciding: false,
    })
    const s = (await ctx.db.get("ivrSessions", id))!
    const open = isIvrOpen(row.businessHours, Date.now())
    const selected: IvrAction = open
      ? { kind: "submenu", menuId: row.entryMenuId }
      : row.businessHours!.closedAction
    if (selected.kind === "webhook") {
      await ctx.db.patch("ivrSessions", id, { deciding: true })
      return {
        ...{ step: 0, organizationId: call.organizationId },
        action: { kind: "hangup" },
        webhook: selected,
        starting: true,
      }
    }
    const result = await decision(
      ctx,
      call,
      s,
      selected,
      args.origin,
      row.menus.find((m) => m.id === row.entryMenuId)!.failureAction
    )
    if (result.action.kind === "submenu")
      await ctx.db.patch("ivrSessions", id, { menuId: result.action.menuId })
    else {
      await record(
        ctx,
        call,
        s,
        open ? row.entryMenuId : "business_hours",
        open ? "invalid" : "closed",
        persisted(result)
      )
      result.step = 1
    }
    await ctx.db.patch("calls", call._id, { ivrId: row._id })
    return result
  },
})
export const claim = internalMutation({
  args: {
    ...requestArgs,
    ...nonceArgs,
    menuId: v.string(),
    digits: v.string(),
    step: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await nonce(ctx, args.nonce, args.expiresAt)
    const { call, s } = await session(ctx, args.callId, args.ivrId)
    if (
      s.finalAction ||
      s.deciding ||
      (args.step !== undefined && args.step !== s.step) ||
      args.menuId !== s.menuId
    )
      throw apiError(
        409,
        "ivr_step_conflict",
        "IVR step is stale or already deciding"
      )
    if ((call.ivrPath?.length ?? 0) >= IVR_LIMITS.steps - 1) {
      const result = await decision(
        ctx,
        call,
        s,
        { kind: "hangup" },
        args.origin
      )
      await record(ctx, call, s, args.menuId, args.digits, { kind: "hangup" })
      return { result: { ...result, step: s.step + 1 } }
    }
    const m = s.definition.menus.find((m) => m.id === args.menuId)!
    const selected =
      args.digits === "timeout"
        ? m.noInputAction
        : args.digits === "invalid"
          ? m.failureAction
          : (m.options[args.digits] ?? m.failureAction)
    if (selected.kind === "webhook") {
      await ctx.db.patch("ivrSessions", s._id, { deciding: true })
      return {
        webhook: selected,
        fallback: m.failureAction,
        step: s.step,
        organizationId: s.organizationId,
      }
    }
    const result = await decision(
      ctx,
      call,
      s,
      selected,
      args.origin,
      m.failureAction
    )
    await record(ctx, call, s, args.menuId, args.digits, persisted(result))
    return { result: { ...result, step: s.step + 1 } }
  },
})
export const complete = internalMutation({
  args: {
    ...requestArgs,
    menuId: v.string(),
    digits: v.string(),
    step: v.number(),
    selected: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<IvrDecision> => {
    const { call, s } = await session(ctx, args.callId, args.ivrId)
    if (!s.deciding || s.step !== args.step || s.finalAction)
      throw apiError(409, "ivr_step_conflict", "IVR step changed")
    let selected: IvrAction
    try {
      selected = parseIvrAction(args.selected, false)
      await checkAction(ctx, s.organizationId, s.definition, selected)
    } catch {
      selected = s.definition.menus.find((m) => m.id === args.menuId)
        ?.failureAction ?? { kind: "hangup" }
    }
    if (selected.kind === "webhook") selected = { kind: "hangup" }
    const result = await decision(ctx, call, s, selected, args.origin)
    await record(ctx, call, s, args.menuId, args.digits, persisted(result))
    return { ...result, step: s.step + 1 }
  },
})
export const webhookContext = internalQuery({
  args: {
    callId: v.id("calls"),
    ivrId: v.id("ivrs"),
    secretId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { call, s } = await session(ctx, args.callId, args.ivrId)
    const id = args.secretId
      ? ctx.db.normalizeId("webhooks", args.secretId)
      : null
    const webhook = id ? await ctx.db.get("webhooks", id) : null
    if (
      args.secretId &&
      (!webhook || webhook.organizationId !== call.organizationId)
    )
      throw notFound("Webhook secret")
    return {
      call: {
        id: call._id,
        account_id: call.accountId,
        contact_id: call.contactId ?? null,
        direction: call.direction,
        user_id: call.userId ?? null,
      },
      definition: s.definition,
      secret: await decryptSecret(webhook?.secret ?? s.webhookSecret),
    }
  },
})
export const audio = internalQuery({
  args: { callId: v.string(), fileId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ storageId: v.id("_storage"), contentType: v.string() })
  ),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("calls", args.callId)
    if (!id) return null
    let call: Doc<"calls">
    try {
      call = await liveCall(ctx, id)
    } catch {
      return null
    }
    const s = await ctx.db
      .query("ivrSessions")
      .withIndex("by_callId", (q) => q.eq("callId", id))
      .unique()
    if (!s || s.organizationId !== call.organizationId) return null
    // A valid signature is scoped to the call and file; still re-check file ownership/state.
    const file = await audioFile(ctx, call.organizationId, args.fileId)
    return { storageId: file.storageId!, contentType: file.contentType }
  },
})

/** Remote hangup and duration caps also finish an unfinished IVR exactly once. */
export async function completeOnHangup(ctx: MutationCtx, callId: Id<"calls">) {
  const call = await ctx.db.get("calls", callId)
  const s = await ctx.db
    .query("ivrSessions")
    .withIndex("by_callId", (q) => q.eq("callId", callId))
    .unique()
  if (
    !call ||
    !s ||
    s.finalAction ||
    (await retirement(ctx, call.organizationId))
  )
    return
  await record(ctx, call, s, s.menuId ?? s.definition.entryMenuId, "hangup", {
    kind: "hangup",
  })
}
