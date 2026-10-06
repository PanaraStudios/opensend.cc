import { completeOnHangup } from "../ivr/runtime"
import { INACTIVE_CALL_MS, lastActivity } from "./activity"
import { settleTerminal } from "./terminal"
import { requireAvailable } from "./agentAccess"
import { callPageValue, callDetailValue } from "./values"
import { v } from "convex/values"
import { stream } from "convex-helpers/server/stream"
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
  type MutationCtx,
} from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import schema from "../schema"
import { requireTeam } from "../access"
import {
  requireCaller,
  notFound,
  invalid,
  apiError,
  type Caller,
} from "../api/caller"
import { channelAccountAccess } from "../channels/messages"
import { findMetaApp } from "../meta/app"
import {
  upsertChannelThread,
  findWhatsAppIdentity,
  resolveCallPerson,
} from "../channels/identity"
import { idempotent } from "../api/idempotency"
import { fileUrl } from "../storage/urls"
import { emitEvent } from "../events"
import { internal } from "../_generated/api"
import {
  callSession,
  callStatus,
  handlingMode,
  callingRouting,
} from "../tables/calling"
import { listArgs, cursorPage } from "../api/paging"
import { CALL_TERMINAL } from "../../lib/meta/calling"
import { normalizePhone, toWaId } from "../../lib/dashboard/phone"
import { retirement } from "../teamLifecycle"

import { actorArgs } from "./actor"
export { actorArgs } from "./actor"
export async function authorize(
  ctx: QueryCtx,
  args: {
    organizationId: string
    caller?: Caller
    automationRunId?: Id<"automationRuns">
  },
  write = false
) {
  if (args.caller) {
    if (args.caller.organizationId !== args.organizationId)
      throw notFound("Call")
    await requireCaller(ctx, args.caller, {
      resource: "calling",
      access: write ? "write" : "read",
    })
  } else if (args.automationRunId) {
    const run = await ctx.db.get("automationRuns", args.automationRunId)
    const automation = run
      ? await ctx.db.get("automations", run.automationId)
      : null
    if (
      run?.organizationId !== args.organizationId ||
      run.status !== "running" ||
      !automation ||
      automation.deleted
    )
      throw notFound("Automation run")
  } else await requireTeam(ctx, args.organizationId, write ? "write" : "read")
  if (await retirement(ctx, args.organizationId)) throw notFound("Team")
}
export const gatewayConfigured = () =>
  !!process.env.CALL_GATEWAY_URL && !!process.env.CALL_GATEWAY_SECRET
export const numberSettings = (
  ctx: QueryCtx,
  accountId: Id<"channelAccounts">
) =>
  ctx.db
    .query("callingSettings")
    .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
    .unique()
export const defaultMode = () =>
  gatewayConfigured() ? ("gateway" as const) : ("api" as const)
export async function ownedCall(
  ctx: QueryCtx,
  organizationId: string,
  id: string
) {
  const normalized = ctx.db.normalizeId("calls", id)
  const row = normalized ? await ctx.db.get("calls", normalized) : null
  if (!row || row.organizationId !== organizationId) throw notFound("Call")
  return row
}
export async function payload(
  ctx: QueryCtx,
  row: Doc<"calls">,
  includeSession = true
) {
  const person = await resolveCallPerson(ctx, row)
  const name = [person.contact?.firstName, person.contact?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim()
  const profileName = person.identity?.profileName?.trim()
  const readable = (value?: string) =>
    value && value !== row.userId && !/^[A-Z]{2}\.\d+$/.test(value)
      ? value
      : undefined
  return {
    contact_name:
      readable(name) ||
      readable(profileName) ||
      (row.test ? "Browser" : "WhatsApp user"),
    contact_phone: person.phone ?? null,
    object: "whatsapp_call" as const,
    id: row._id,
    test: row.test ?? false,
    account_id: row.accountId,
    wacid: row.wacid ?? null,
    direction: row.direction,
    status: row.status,
    handling_mode: row.mode,
    user_id: row.userId ?? null,
    from: row.from ?? null,
    to: row.to ?? null,
    contact_id: person.contact?._id ?? null,
    conversation_id: row.conversationId ?? null,
    created_at: new Date(row._creationTime).toISOString(),
    observed_at: row.observedAt,
    connected_at: row.connectedAt ?? null,
    ended_at: row.endedAt ?? null,
    duration: row.duration ?? null,
    biz_opaque_callback_data: row.bizOpaqueCallbackData ?? null,
    cta_payload: row.ctaPayload ?? null,
    deeplink_payload: row.deeplinkPayload ?? null,
    session:
      includeSession && row.mode === "api" ? (row.remoteSession ?? null) : null,
    recording: row.recording
      ? { ...row.recording, download_url: await fileUrl(ctx, row.recording) }
      : null,
    transcription: row.transcription
      ? {
          ...row.transcription,
          download_url: await fileUrl(ctx, row.transcription),
        }
      : null,
    outcome: row.connectedAt
      ? ("answered" as const)
      : row.status === "missed"
        ? ("no_answer" as const)
        : row.status === "rejected"
          ? ("rejected" as const)
          : row.status === "failed"
            ? ("failed" as const)
            : null,
    attempt: row.attempt ?? 1,
    purpose: row.callPurpose ?? null,
    route:
      row.outboundRoute?.kind === "bot"
        ? `bot:${row.outboundRoute.botId}`
        : row.outboundRoute?.kind === "ivr"
          ? `ivr:${row.outboundRoute.ivrId}`
          : null,
    error: row.error ?? null,
    error_code: row.errorCode ?? null,
    assigned_agent: row.assignedAgent ?? null,
    ivr_id: row.ivrId ?? null,
    ivr_path: row.ivrPath ?? [],
    ivr_outcome: row.ivrOutcome ?? null,
    bot_id: row.botId ?? null,
    bot_name: row.botConfig?.name ?? null,
    bot_outcome: row.botOutcome ?? null,
    bot_summary: row.botSummary ?? null,
    collected: row.collected ?? null,
    bot_duration: row.botDuration ?? null,
    bot_usage: row.botUsage ?? null,
    bot_fallback_reason: row.botFallbackReason ?? null,
  }
}
export async function callEvent(
  ctx: MutationCtx,
  row: Doc<"calls">,
  status: string
) {
  if (row.test) return
  const data = await payload(ctx, row)
  await emitEvent(
    ctx,
    row.organizationId,
    `whatsapp.call.${status === "rejected" ? "missed" : status}`,
    data
  )
  if (row.direction === "outbound")
    await emitEvent(ctx, row.organizationId, `call.outbound_${status}`, data)
}
export const byWacid = (
  ctx: QueryCtx,
  accountId: Id<"channelAccounts">,
  wacid: string
) =>
  ctx.db
    .query("calls")
    .withIndex("by_accountId_and_wacid", (q) =>
      q.eq("accountId", accountId).eq("wacid", wacid)
    )
    .unique()

/** Select the BSUID for this business, even if another business last updated the shared phone identity. */
export async function knownUserForPhone(
  ctx: QueryCtx,
  account: Doc<"channelAccounts">,
  phone: string
) {
  const identity = await findWhatsAppIdentity(
    ctx,
    account.organizationId,
    phone
  )
  const connection = await ctx.db.get("metaConnections", account.connectionId)
  if (!identity || !connection) return undefined
  const alias = await ctx.db
    .query("whatsappUserAliases")
    .withIndex("by_channelContactId_and_businessId", (q) =>
      q
        .eq("channelContactId", identity._id)
        .eq("businessId", connection.businessId)
    )
    .first()
  return alias?.organizationId === account.organizationId
    ? alias.userId
    : identity.userScopeId === connection.businessId
      ? identity.userId
      : undefined
}

export async function resolveIdentity(
  ctx: QueryCtx,
  account: Doc<"channelAccounts">,
  to?: string,
  recipient?: string
) {
  const phone = to
    ? normalizePhone(to.startsWith("+") ? to : `+${to}`)
    : undefined
  if (to && !phone) throw invalid("Invalid recipient phone number.")
  let userId = recipient
  if (!userId && phone) {
    userId = await knownUserForPhone(ctx, account, phone)
  }
  if (
    (!userId && !phone) ||
    (userId && !/^[A-Za-z0-9._:-]{1,256}$/.test(userId))
  )
    throw invalid(
      "Supply recipient (BSUID), or a phone number with a known BSUID."
    )
  return { userId, phone }
}
export const permissionIdentity = internalQuery({
  args: {
    ...actorArgs,
    from: v.optional(v.string()),
    identity: v.string(),
    bsuid: v.optional(v.boolean()),
  },
  returns: v.object({ identity: v.string(), bsuid: v.boolean() }),
  handler: async (ctx, { identity, bsuid, ...args }) => {
    await authorize(ctx, args)
    const { account } = await channelAccountAccess(
      ctx,
      args.organizationId,
      args.from,
      "whatsapp"
    )
    const phone = !bsuid && /^\+?\d+$/.test(identity)
    const resolved = await resolveIdentity(
      ctx,
      account,
      phone ? identity : undefined,
      phone ? undefined : identity
    )
    return {
      identity: resolved.userId ?? toWaId(resolved.phone!),
      bsuid: !!resolved.userId,
    }
  },
})

export const target = internalQuery({
  args: {
    ...actorArgs,
    from: v.optional(v.string()),
    id: v.optional(v.string()),
    write: v.optional(v.boolean()),
  },
  returns: v.object({
    account: schema.doc("channelAccounts"),
    encryptedToken: v.string(),
    version: v.string(),
    settings: v.union(v.null(), schema.doc("callingSettings")),
    call: v.union(v.null(), schema.doc("calls")),
  }),
  handler: async (ctx, args) => {
    await authorize(ctx, args, args.write)
    const call = args.id
      ? await ownedCall(ctx, args.organizationId, args.id)
      : null
    const { account, connection } = await channelAccountAccess(
      ctx,
      args.organizationId,
      call?.accountId ?? args.from,
      "whatsapp"
    )
    const app = await findMetaApp(ctx)
    if (!app) throw invalid("Meta app is not configured.")
    return {
      account,
      encryptedToken: connection.encryptedToken,
      version: app.graphVersion,
      settings: await numberSettings(ctx, account._id),
      call,
    }
  },
})
const pageArgs = {
  ...actorArgs,
  ...listArgs,
  accountId: v.optional(v.id("channelAccounts")),
}
async function listCalls(
  ctx: QueryCtx,
  args: {
    organizationId: string
    caller?: Caller
    limit: number
    after?: string
    before?: string
    accountId?: Id<"channelAccounts">
  }
) {
  await authorize(ctx, args)
  if (
    !Number.isInteger(args.limit) ||
    args.limit < 1 ||
    args.limit > 100 ||
    (args.after && args.before)
  )
    throw invalid("Use a limit from 1 to 100 and only one cursor.")
  const page = await cursorPage(
    args,
    async (id) => {
      try {
        const row = await ownedCall(ctx, args.organizationId, id)
        return !args.accountId || row.accountId === args.accountId ? row : null
      } catch {
        return null
      }
    },
    (order) =>
      args.accountId
        ? stream(ctx.db, schema)
            .query("calls")
            .withIndex("by_organizationId_and_accountId", (q) =>
              q
                .eq("organizationId", args.organizationId)
                .eq("accountId", args.accountId!)
            )
            .order(order)
        : stream(ctx.db, schema)
            .query("calls")
            .withIndex("by_organizationId", (q) =>
              q.eq("organizationId", args.organizationId)
            )
            .order(order)
  )
  return {
    object: "list" as const,
    has_more: page.has_more,
    data: await Promise.all(page.data.map((row) => payload(ctx, row))),
  }
}
export const list = internalQuery({
  args: pageArgs,
  returns: callPageValue,
  handler: listCalls,
})
export const dashboardList = query({
  args: {
    organizationId: v.string(),
    ...listArgs,
    accountId: v.optional(v.id("channelAccounts")),
  },
  returns: callPageValue,
  handler: listCalls,
})
export const get = internalQuery({
  args: { ...actorArgs, id: v.string() },
  returns: callDetailValue,
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const row = await ownedCall(ctx, args.organizationId, args.id)
    const events = await ctx.db
      .query("callEvents")
      .withIndex("by_callId", (q) => q.eq("callId", row._id))
      .take(100)
    return {
      ...(await payload(ctx, row)),
      events: events.map((e) => ({
        event: e.event,
        at: e.at,
        details: JSON.parse(e.details),
      })),
    }
  },
})
export const create = internalMutation({
  args: {
    ...actorArgs,
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    recipient: v.optional(v.string()),
    mode: v.optional(handlingMode),
    outboundRoute: v.optional(callingRouting),
    callPurpose: v.optional(v.string()),
    callVariables: v.optional(v.record(v.string(), v.string())),
    opaque: v.optional(v.string()),
    agentPresenceId: v.optional(v.id("callAgents")),
    agentLeaseId: v.optional(v.string()),
  },
  returns: v.id("calls"),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    const { account } = await channelAccountAccess(
      ctx,
      args.organizationId,
      args.from,
      "whatsapp"
    )
    const { userId, phone } = await resolveIdentity(
      ctx,
      account,
      args.to,
      args.recipient
    )
    if (args.outboundRoute)
      await ctx.runQuery(internal.voice.routing.validate, {
        organizationId: args.organizationId,
        caller: args.caller,
        automationRunId: args.automationRunId,
        input: args.outboundRoute,
        mode: "gateway",
        purpose: args.callPurpose,
        variables: args.callVariables,
      })
    const now = Date.now(),
      settings = await numberSettings(ctx, account._id)
    const mode = args.mode ?? settings?.mode ?? defaultMode()
    if (mode === "gateway" && !gatewayConfigured())
      throw apiError(
        503,
        "gateway_unavailable",
        "The calling gateway is not configured."
      )
    const links = await upsertChannelThread(ctx, account, {
      externalId: phone ? toWaId(phone) : userId!,
      ...(phone ? { phone } : {}),
      userId,
      at: now,
      direction: "outbound",
      preview: "Voice call",
      opensWindow: false,
    })
    const agent = args.agentPresenceId
      ? await ctx.db.get("callAgents", args.agentPresenceId)
      : null
    if (agent) {
      if (
        agent.organizationId !== args.organizationId ||
        agent.leaseId !== args.agentLeaseId
      )
        throw notFound("Agent")
      await requireAvailable(ctx, agent)
    }
    const previous = userId
      ? await ctx.db
          .query("calls")
          .withIndex("by_accountId_and_userId_and_direction", (q) =>
            q
              .eq("accountId", account._id)
              .eq("userId", userId)
              .eq("direction", "outbound")
          )
          .order("desc")
          .first()
      : await ctx.db
          .query("calls")
          .withIndex("by_accountId_and_to_and_direction", (q) =>
            q
              .eq("accountId", account._id)
              .eq("to", toWaId(phone!))
              .eq("direction", "outbound")
          )
          .order("desc")
          .first()
    const insert = async (): Promise<Id<"calls">> => {
      const id = await ctx.db.insert("calls", {
        organizationId: args.organizationId,
        accountId: account._id,
        direction: "outbound",
        ...(args.outboundRoute ? { outboundRoute: args.outboundRoute } : {}),
        ...(args.callPurpose !== undefined
          ? { callPurpose: args.callPurpose }
          : {}),
        ...(args.callVariables ? { callVariables: args.callVariables } : {}),
        attempt: (previous?.attempt ?? 0) + 1,
        ...(args.caller?.idempotencyId
          ? { apiIdempotencyId: args.caller.idempotencyId }
          : {}),
        ...(agent
          ? {
              assignedAgent: agent.userId,
              agentLeaseId: agent.leaseId,
              agentExtension: agent.extension,
            }
          : {}),
        mode,
        status: "queued",
        userId,
        ...(phone ? { to: toWaId(phone) } : {}),
        from: account.handle,
        observedAt: now,
        ...links,
        ...(args.opaque !== undefined
          ? { bizOpaqueCallbackData: args.opaque }
          : {}),
      })
      await emitEvent(
        ctx,
        args.organizationId,
        "call.outbound_queued",
        await payload(ctx, (await ctx.db.get("calls", id))!)
      )
      await ctx.scheduler.runAfter(
        60000,
        internal.calling.callActions.timeout,
        { id }
      )
      return id
    }
    return args.caller
      ? idempotent(ctx, args.caller, insert, (id) => ({
          body: args.outboundRoute ? { id, status: "queued" } : { id },
        }))
      : insert()
  },
})
export const context = internalQuery({
  args: { id: v.id("calls") },
  returns: v.union(
    v.null(),
    v.object({
      call: schema.doc("calls"),
      encryptedToken: v.string(),
      version: v.string(),
      phoneNumberId: v.string(),
      connectionId: v.id("metaConnections"),
      settings: v.union(v.null(), schema.doc("callingSettings")),
    })
  ),
  handler: async (ctx, { id }) => {
    const call = await ctx.db.get("calls", id)
    if (!call || (await retirement(ctx, call.organizationId))) return null
    const account = await ctx.db.get("channelAccounts", call.accountId),
      app = await findMetaApp(ctx)
    const connection = account
      ? await ctx.db.get("metaConnections", account.connectionId)
      : null
    if (
      !account ||
      !connection ||
      !app ||
      account.status === "disconnected" ||
      connection.status !== "active"
    )
      return null
    return {
      call,
      encryptedToken: connection.encryptedToken,
      phoneNumberId: account.externalId,
      connectionId: connection._id,
      version: app.graphVersion,
      settings: await numberSettings(ctx, account._id),
    }
  },
})
export const finish = internalMutation({
  args: {
    id: v.id("calls"),
    status: v.optional(callStatus),
    wacid: v.optional(v.string()),
    session: v.optional(callSession),
    preAcceptedSdp: v.optional(v.string()),
    error: v.optional(v.string()),
    errorCode: v.optional(v.number()),
    operation: v.optional(v.string()),
    routed: v.optional(v.boolean()),
  },
  returns: schema.doc("calls"),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("calls", args.id)
    if (!row) throw notFound("Call")
    if (await retirement(ctx, row.organizationId)) return row
    const patch: Partial<Doc<"calls">> = {}
    if (args.wacid) {
      const other = await byWacid(ctx, row.accountId, args.wacid)
      if (other && other._id !== row._id) {
        // Graph's webhook can beat the synchronous connect response. Keep the client-selected id.
        const { _id, _creationTime, ...fields } = other
        Object.assign(patch, fields)
        for (const event of await ctx.db
          .query("callEvents")
          .withIndex("by_callId", (q) => q.eq("callId", _id))
          .take(100))
          await ctx.db.patch("callEvents", event._id, { callId: row._id })
        await ctx.db.delete("calls", _id)
        void _creationTime
      }
      patch.wacid = args.wacid
    }
    const terminal = CALL_TERMINAL.has(patch.status ?? row.status)
    if (args.session && !terminal) patch.localSession = args.session
    if (args.preAcceptedSdp && !terminal)
      patch.preAcceptedSdp = args.preAcceptedSdp
    if (
      args.status &&
      !terminal &&
      (args.status !== "ringing" || row.status === "queued")
    ) {
      patch.status = args.status
      patch.observedAt = Date.now()
      if (args.status === "connected")
        patch.connectedAt = row.connectedAt ?? Date.now()
      if (CALL_TERMINAL.has(args.status)) {
        patch.endedAt = Date.now()
        if (row.test && row.connectedAt)
          patch.duration = Math.max(
            0,
            Math.round((Date.now() - row.connectedAt) / 1000)
          )
      }
    }
    if (args.error) {
      patch.error = args.error
      patch.errorCode = args.errorCode
    }
    if (args.routed) patch.gatewayRouted = true
    if (!args.operation || args.operation === row.operation) {
      patch.operation = undefined
      patch.operationUntil = undefined
    }
    await ctx.db.patch("calls", row._id, patch)
    if (
      !CALL_TERMINAL.has(row.status) &&
      CALL_TERMINAL.has(patch.status ?? row.status)
    )
      await settleTerminal(ctx, (await ctx.db.get("calls", row._id))!)
    const updated = (await ctx.db.get("calls", row._id))!
    if (updated.status !== row.status)
      await callEvent(ctx, updated, updated.status)
    if (CALL_TERMINAL.has(updated.status))
      await completeOnHangup(ctx, updated._id)
    if (updated.mode === "gateway" && CALL_TERMINAL.has(updated.status))
      await ctx.scheduler.runAfter(0, internal.calling.callActions.cleanup, {
        id: row._id,
      })
    return updated
  },
})
export const lease = internalMutation({
  args: {
    id: v.id("calls"),
    operation: v.string(),
    expectedAgentLeaseId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("calls", args.id)
    if (!row) throw notFound("Call")
    if (
      args.expectedAgentLeaseId &&
      row.agentLeaseId !== args.expectedAgentLeaseId
    )
      throw apiError(409, "call_claim_changed", "The call claim changed.")
    if (row.operation && (row.operationUntil ?? 0) > Date.now())
      throw apiError(
        409,
        "call_operation_pending",
        "Another call action is in progress."
      )
    await ctx.db.patch("calls", row._id, {
      operation: args.operation,
      operationUntil: Date.now() + 120000,
    })
    return null
  },
})

export const cleanupContext = internalQuery({
  args: { id: v.id("calls") },
  returns: v.union(v.null(), schema.doc("calls")),
  handler: (ctx, { id }) => ctx.db.get("calls", id),
})

export const settleConnect = internalMutation({
  args: { id: v.id("calls"), status: v.number(), body: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, status, body }) => {
    const call = await ctx.db.get("calls", id)
    const reservation = call?.apiIdempotencyId
      ? await ctx.db.get("apiIdempotency", call.apiIdempotencyId)
      : null
    if (reservation && reservation.organizationId === call!.organizationId)
      await ctx.db.patch("apiIdempotency", reservation._id, {
        response: { status, body },
      })
    return null
  },
})

/** Claim the local terminal state before any best-effort network cleanup. */
export const endLocally = internalMutation({
  args: {
    id: v.id("calls"),
    kind: v.union(
      v.literal("timeout"),
      v.literal("hangup"),
      v.literal("inactive"),
      v.literal("blocked")
    ),
    at: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  returns: v.union(v.null(), schema.doc("calls")),
  handler: async (
    ctx,
    { id, kind, at, reason }
  ): Promise<Doc<"calls"> | null> => {
    const row = await ctx.db.get("calls", id)
    if (
      !row ||
      CALL_TERMINAL.has(row.status) ||
      (await retirement(ctx, row.organizationId))
    )
      return null
    // Acceptance wins over a timeout, but a terminal media callback cannot be
    // superseded by a later acceptance webhook or a different server clock.
    if (kind === "timeout" && row.status === "connected") return null
    if (kind === "hangup" && at === undefined) return null
    if (
      kind === "inactive" &&
      (row.mode !== "gateway" ||
        row.status !== "connected" ||
        lastActivity(row) > Date.now() - INACTIVE_CALL_MS)
    )
      return null
    await ctx.runMutation(internal.calling.rows.finish, {
      id,
      status:
        kind === "hangup" || kind === "inactive"
          ? kind === "inactive" || row.connectedAt
            ? "completed"
            : "missed"
          : kind === "timeout" && !row.wacid
            ? "failed"
            : "missed",
      ...(reason ? { error: reason } : {}),
      ...(kind === "timeout" && !row.wacid
        ? { error: "Call setup timed out before Meta assigned a call id." }
        : {}),
    })
    return row
  },
})

/** One bounded transaction; a heartbeat or hangup conflict retries the claim. */
export const reconcileInactive = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_mode_and_status_and_lastActivityAt", (q) =>
        q
          .eq("mode", "gateway")
          .eq("status", "connected")
          .lte("lastActivityAt", Date.now() - INACTIVE_CALL_MS)
      )
      .take(50)
    for (const call of calls) {
      // Initialize legacy timestamps so recent legacy rows cannot starve older calls.
      if (call.lastActivityAt === undefined)
        await ctx.db.patch("calls", call._id, {
          lastActivityAt: lastActivity(call),
        })
      await ctx.runMutation(internal.calling.rows.endLocally, {
        id: call._id,
        kind: "inactive",
        reason: "Ended: no audio for 2 minutes",
      })
    }
    return null
  },
})
