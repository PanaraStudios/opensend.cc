import { v } from "convex/values"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { array, object, string } from "../../lib/meta/parse"
import { callTime, callWireStatus, CALL_TERMINAL } from "../../lib/meta/calling"
import { upsertChannelThread, recordWhatsAppPhone } from "../channels/identity"
import { patchRow } from "../counts"
import { emitEvent } from "../events"
import { live, wabaByWabaId } from "../meta/connect"
import { retirement } from "../teamLifecycle"
import {
  byWacid,
  callEvent,
  defaultMode,
  numberSettings,
  knownUserForPhone,
} from "./rows"

async function permission(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  raw: Record<string, unknown>,
  contacts: Record<string, unknown>[],
  receivedAt: number
) {
  const reply = object(object(raw.interactive).call_permission_reply)
  if (!["accept", "reject"].includes(string(reply.response))) return
  const identity =
    string(raw.from_user_id) ||
    string(contacts.find((c) => c.wa_id === raw.from)?.user_id)
  if (!identity || !string(raw.id)) return
  const at = callTime(raw.timestamp, receivedAt)
  const event = `permission:${string(raw.id)}`
  if (
    await ctx.db
      .query("callEvents")
      .withIndex("by_accountId_and_wacid_and_event", (q) =>
        q.eq("accountId", account._id).eq("wacid", identity).eq("event", event)
      )
      .unique()
  )
    return
  await ctx.db.insert("callEvents", {
    organizationId: account.organizationId,
    accountId: account._id,
    wacid: identity,
    event,
    at,
    details: JSON.stringify(raw),
  })
  const previous = await ctx.db
    .query("callPermissions")
    .withIndex("by_accountId_and_identity", (q) =>
      q.eq("accountId", account._id).eq("identity", identity)
    )
    .unique()
  if (previous && previous.observedAt > at) return
  const status =
    reply.response === "reject"
      ? "denied"
      : reply.is_permanent === true
        ? "permanent"
        : "temporary"
  const data = {
    permission: {
      status,
      ...(reply.expiration_timestamp
        ? { expiration_time: Number(reply.expiration_timestamp) }
        : {}),
    },
    response_source: reply.response_source ?? null,
    context_id: object(raw.context).id ?? null,
  }
  const fields = {
    organizationId: account.organizationId,
    accountId: account._id,
    identity,
    status,
    observedAt: at,
    expiresAt: reply.expiration_timestamp
      ? callTime(reply.expiration_timestamp, at)
      : undefined,
    data: JSON.stringify(data),
  }
  if (previous) await ctx.db.patch("callPermissions", previous._id, fields)
  else await ctx.db.insert("callPermissions", fields)
  await emitEvent(
    ctx,
    account.organizationId,
    "whatsapp.call.permission_updated",
    { account_id: account._id, user_id: identity, ...data }
  )
}
async function lifecycle(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  raw: Record<string, unknown>,
  contacts: Record<string, unknown>[],
  errors: unknown[],
  receivedAt: number
) {
  errors = errors.length ? errors : array(raw.errors)
  const wacid = string(raw.id),
    event = string(raw.event) || `status:${callWireStatus(raw.status)}`
  if (
    !wacid ||
    ![
      "connect",
      "terminate",
      "call_recording_available",
      "call_transcription_available",
      "status:RINGING",
      "status:ACCEPTED",
      "status:REJECTED",
    ].includes(event)
  )
    return
  if (
    await ctx.db
      .query("callEvents")
      .withIndex("by_accountId_and_wacid_and_event", (q) =>
        q.eq("accountId", account._id).eq("wacid", wacid).eq("event", event)
      )
      .unique()
  )
    return
  const at = callTime(raw.timestamp, callTime(raw.end_time, receivedAt))
  let row = await byWacid(ctx, account._id, wacid)
  const direction =
    raw.direction === "BUSINESS_INITIATED" ||
    raw.recipient_user_id ||
    event.startsWith("status:")
      ? ("outbound" as const)
      : (row?.direction ?? ("inbound" as const))
  const phone = string(
    direction === "inbound" ? raw.from : raw.to || raw.recipient_id
  )
  let userId =
    string(raw.from_user_id) ||
    string(raw.to_user_id) ||
    string(raw.recipient_user_id) ||
    string(contacts.find((c) => c.wa_id === phone)?.user_id) ||
    (contacts.length === 1 ? string(contacts[0].user_id) : "") ||
    row?.userId
  if (!userId && phone) {
    userId = await knownUserForPhone(
      ctx,
      account,
      `+${phone.replace(/^\+/, "")}`
    )
  }
  if (!row && direction === "outbound" && userId) {
    const pending = await ctx.db
      .query("calls")
      .withIndex("by_accountId_and_userId", (q) =>
        q.eq("accountId", account._id).eq("userId", userId)
      )
      .order("desc")
      .take(20)
    row =
      pending.find(
        (call) =>
          !call.wacid &&
          call.direction === "outbound" &&
          call.status === "queued"
      ) ?? null
    if (row) await ctx.db.patch("calls", row._id, { wacid })
  }
  const contact = contacts.find((c) => c.user_id === userId) ?? {}
  const links =
    !row?.conversationId && userId
      ? await upsertChannelThread(ctx, account, {
          externalId: userId,
          userId,
          parentUserId:
            string(
              raw.from_parent_user_id ||
                raw.to_parent_user_id ||
                contact.parent_user_id
            ) || undefined,
          profileName: string(object(contact.profile).name),
          username: string(object(contact.profile).username) || undefined,
          at,
          direction,
          preview: event === "terminate" ? "Voice call ended" : "Voice call",
          opensWindow: direction === "inbound",
        })
      : {}
  if (!row) {
    const settings = await numberSettings(ctx, account._id)
    const id = await ctx.db.insert("calls", {
      organizationId: account.organizationId,
      accountId: account._id,
      wacid,
      mode: settings?.mode ?? defaultMode(),
      direction,
      status: "queued",
      observedAt: 0,
      ...links,
      ...(userId ? { userId } : {}),
    })
    row = (await ctx.db.get("calls", id))!
  }
  await ctx.db.insert("callEvents", {
    organizationId: account.organizationId,
    accountId: account._id,
    wacid,
    event,
    callId: row._id,
    at,
    details: JSON.stringify({ ...raw, ...(errors.length ? { errors } : {}) }),
  })
  const patch: Partial<Doc<"calls">> = { ...links }
  if (event === "connect" && row.offeredAt === undefined) patch.offeredAt = at
  if (userId && !row.userId) patch.userId = userId
  for (const [key, wire] of [
    ["from", "from"],
    ["to", "to"],
    ["bizOpaqueCallbackData", "biz_opaque_callback_data"],
    ["ctaPayload", "cta_payload"],
    ["deeplinkPayload", "deeplink_payload"],
  ] as const)
    if (typeof raw[wire] === "string" && row[key] === undefined)
      patch[key] = raw[wire]
  const session = object(raw.session)
  const newSession =
    !CALL_TERMINAL.has(row.status) &&
    !row.remoteSession &&
    (session.sdp_type === "offer" || session.sdp_type === "answer") &&
    !!string(session.sdp)
  if (newSession)
    patch.remoteSession = {
      sdp_type: session.sdp_type as "offer" | "answer",
      sdp: string(session.sdp),
    }
  if (event === "terminate" && at >= (row.metaAt ?? 0)) {
    const rawStatus = callWireStatus(raw.status)
    patch.status =
      row.status === "rejected"
        ? "rejected"
        : row.status === "failed"
          ? "failed"
          : row.status === "missed" && !Number(raw.duration)
            ? "missed"
            : rawStatus === "FAILED"
              ? !row.connectedAt && !Number(raw.duration) && errors.length === 0
                ? "missed"
                : "failed"
              : "completed"
    patch.metaAt = at
    patch.observedAt = Math.max(row.observedAt, at)
    patch.endedAt = callTime(raw.end_time, at)
    if (raw.start_time && Number(raw.duration) > 0)
      patch.connectedAt = callTime(raw.start_time, at)
    if (Number.isFinite(Number(raw.duration)) && raw.duration !== undefined)
      patch.duration = Number(raw.duration)
    if (errors.length) {
      patch.errors = JSON.stringify(errors)
      const err = object(errors[0])
      patch.error = string(err.message) || "Meta call failed"
      if (typeof err.code === "number") patch.errorCode = err.code
    }
  }
  if (
    event === "call_recording_available" ||
    event === "call_transcription_available"
  ) {
    const kind =
      event === "call_recording_available" ? "recording" : "transcription"
    const media = object(
      kind === "recording"
        ? object(raw.call_recording).audio
        : object(raw.call_transcript).document
    )
    if (string(media.id) && !row[kind]?.fileId && !row[kind]?.storageId) {
      patch[kind] = {
        mediaId: string(media.id),
        ...(string(media.sha256) ? { sha256: string(media.sha256) } : {}),
        contentType:
          string(media.mime_type) ||
          (kind === "recording" ? "audio/ogg" : "application/json"),
      }
      await ctx.scheduler.runAfter(0, internal.calling.media.fetch, {
        id: row._id,
        kind,
      })
    }
  } else if (at >= (row.metaAt ?? 0) && !CALL_TERMINAL.has(row.status)) {
    let next = row.status
    if (event === "terminate") next = patch.status ?? row.status
    else if (event === "status:REJECTED") next = "rejected"
    else if (
      event === "status:ACCEPTED" ||
      (event === "connect" && direction === "outbound")
    )
      next = "connected"
    else if (row.status === "queued") next = "ringing"
    patch.status = next
    patch.metaAt = at
    patch.observedAt = Math.max(row.observedAt, at)
    const session = object(raw.session)
    if (
      (session.sdp_type === "offer" || session.sdp_type === "answer") &&
      string(session.sdp)
    )
      patch.remoteSession = {
        sdp_type: session.sdp_type,
        sdp: string(session.sdp),
      }
    if (next === "connected") patch.connectedAt = row.connectedAt ?? at
  }
  await ctx.db.patch("calls", row._id, patch)
  const updated = (await ctx.db.get("calls", row._id))!
  if (phone && updated.channelContactId)
    await recordWhatsAppPhone(ctx, account, updated.channelContactId, phone)
  // Inbound calls always refresh the service window, even when termination arrived first.
  if (
    ((event === "connect" && direction === "inbound") ||
      event === "status:ACCEPTED" ||
      (event === "connect" && direction === "outbound")) &&
    updated.conversationId
  ) {
    if (updated.channelContactId) {
      const identity = await ctx.db.get(
        "channelContacts",
        updated.channelContactId
      )
      if (identity)
        await ctx.db.patch("channelContacts", identity._id, {
          lastInboundAt: Math.max(at, identity.lastInboundAt ?? 0),
        })
    }
    const thread = await ctx.db.get("conversations", updated.conversationId)
    if (thread)
      await patchRow(ctx, "conversations", thread._id, {
        lastInboundAt: Math.max(at, thread.lastInboundAt ?? 0),
        windowExpiresAt: Math.max(at, thread.lastInboundAt ?? 0) + 86400000,
      })
  }
  if (
    updated.status !== row.status ||
    (newSession && event === "connect") ||
    (event === "terminate" &&
      at >= (row.metaAt ?? 0) &&
      updated.duration !== row.duration)
  )
    await callEvent(ctx, updated, updated.status)
  const settings = await numberSettings(ctx, account._id)
  const policy = JSON.parse(settings?.settings ?? "{}") as Record<
    string,
    unknown
  >
  if (
    event === "connect" &&
    direction === "inbound" &&
    !CALL_TERMINAL.has(updated.status) &&
    (policy.status === "DISABLED" ||
      policy.call_icon_visibility === "DISABLE_ALL" ||
      at + 60000 < receivedAt)
  ) {
    await ctx.scheduler.runAfter(0, internal.calling.callActions.blockInbound, {
      id: row._id,
    })
  } else if (updated.mode === "gateway") {
    if (CALL_TERMINAL.has(updated.status))
      await ctx.scheduler.runAfter(0, internal.calling.callActions.cleanup, {
        id: row._id,
      })
    else if (event === "connect" && updated.remoteSession)
      await ctx.scheduler.runAfter(
        0,
        internal.calling.callActions.gatewayConnect,
        { id: row._id }
      )
  }
}
export const project = internalMutation({
  args: { id: v.id("metaWebhookEvents") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const stored = await ctx.db.get("metaWebhookEvents", id)
    if (!stored) return null
    const root = object(JSON.parse(stored.body))
    if (root.object !== "whatsapp_business_account") return null
    for (const entryRaw of array(root.entry)) {
      const entry = object(entryRaw)
      for (const changeRaw of array(entry.changes)) {
        const change = object(changeRaw),
          value = object(change.value),
          field = string(change.field)
        if (
          ![
            "calls",
            "messages",
            "account_settings_update",
            "account_update",
          ].includes(field)
        )
          continue
        const phoneId =
          string(object(value.metadata).phone_number_id) ||
          string(value.phone_number_id) ||
          string(object(value.phone_number).id) ||
          string(object(value.phone_number_settings).phone_number_id)
        if (
          !phoneId &&
          (field === "account_update" || field === "account_settings_update")
        ) {
          await ctx.scheduler.runAfter(
            0,
            internal.calling.projection.management,
            { wabaId: string(entry.id), field, value, cursor: null }
          )
          continue
        }
        const accounts = phoneId
          ? await ctx.db
              .query("channelAccounts")
              .withIndex("by_channel_and_externalId", (q) =>
                q.eq("channel", "whatsapp").eq("externalId", phoneId)
              )
              .take(20)
          : await ctx.db
              .query("channelAccounts")
              .withIndex("by_wabaId", (q) => q.eq("wabaId", string(entry.id)))
              .take(100)
        for (const account of accounts) {
          if (
            !live(account) ||
            account.wabaId !== string(entry.id) ||
            (await retirement(ctx, account.organizationId))
          )
            continue
          const waba = await ctx.db
            .query("whatsappBusinessAccounts")
            .withIndex("by_wabaId", (q) => q.eq("wabaId", string(entry.id)))
            .unique()
          if (waba?.organizationId !== account.organizationId) continue
          const contacts = array(value.contacts).map(object)
          if (field === "calls") {
            for (const call of array(value.calls))
              await lifecycle(
                ctx,
                account,
                object(call),
                contacts,
                array(value.errors),
                stored.receivedAt
              )
            for (const status of array(value.statuses))
              if (object(status).type === "call")
                await lifecycle(
                  ctx,
                  account,
                  object(status),
                  contacts,
                  array(value.errors),
                  stored.receivedAt
                )
          } else if (field === "messages") {
            for (const message of array(value.messages))
              await permission(
                ctx,
                account,
                object(message),
                contacts,
                stored.receivedAt
              )
          } else {
            await managementChange(ctx, account, field, value)
          }
        }
      }
    }
    return null
  },
})

async function managementChange(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  field: string,
  value: Record<string, unknown>
) {
  const settings = await numberSettings(ctx, account._id)
  if (
    field === "account_settings_update" &&
    value.type === "PHONE_NUMBER_SETTINGS"
  )
    await ctx.scheduler.runAfter(0, internal.calling.settings.refresh, {
      accountId: account._id,
    })
  else if (
    field === "account_update" &&
    ["ACCOUNT_RESTRICTION", "ACCOUNT_VIOLATION"].includes(string(value.event))
  ) {
    if (settings)
      await ctx.db.patch("callingSettings", settings._id, {
        restrictions: JSON.stringify(value),
      })
    else
      await ctx.db.insert("callingSettings", {
        organizationId: account.organizationId,
        accountId: account._id,
        mode: defaultMode(),
        settings: "{}",
        updatedAt: Date.now(),
        restrictions: JSON.stringify(value),
      })
  }
}
export const management = internalMutation({
  args: {
    wabaId: v.string(),
    field: v.string(),
    value: v.record(v.string(), v.any()),
    cursor: v.union(v.null(), v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const waba = await wabaByWabaId(ctx, args.wabaId)
    if (!waba || (await retirement(ctx, waba.organizationId))) return null
    const page = await ctx.db
      .query("channelAccounts")
      .withIndex("by_wabaId", (q) => q.eq("wabaId", args.wabaId))
      .paginate({ cursor: args.cursor, numItems: 100 })
    const phone = string(args.value.phone_number).replace(/\D/g, "")
    for (const account of page.page)
      if (
        account.organizationId === waba.organizationId &&
        live(account) &&
        (!phone ||
          phone === account.handle.replace(/\D/g, "") ||
          phone === account.externalId)
      )
        await managementChange(ctx, account, args.field, args.value)
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.calling.projection.management, {
        ...args,
        cursor: page.continueCursor,
      })
    return null
  },
})
