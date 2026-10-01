import { v } from "convex/values"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { insertRow, patchRow } from "../counts"
import { upsertChannelThread } from "../channels/identity"
import { emitEvent } from "../events"
import { customEventType } from "../automationEvents"
import { retirement } from "../teamLifecycle"
import { normalizePhone } from "../../lib/dashboard/phone"
import { CHANNEL_MESSAGE_TYPES } from "../tables/channels"
import { acceptChannelMessage } from "../channels/messages"
import { channelMessagePayload } from "../channels/payload"
import { live } from "./connect"
import { templateWebhook } from "../whatsapp/templates"
import { TEMPLATE_WEBHOOK_FIELDS } from "../../lib/meta/templates"
import {
  array,
  object,
  string,
  timestamp,
  MEDIA_TYPES,
  STATUS_RANK,
  outboundStatus,
  pageWebhookItems,
} from "../../lib/meta/webhooks"

/** Messages with a wamid. Meta's ids are unique, but a lookup must not
    throw on a duplicate row, so callers pick the row they mean. */
const messagesByExternalId = (
  ctx: MutationCtx,
  id: string,
  channel: Doc<"channelAccounts">["channel"] = "whatsapp"
) =>
  ctx.db
    .query("channelMessages")
    .withIndex("by_channel_and_externalId", (q) =>
      q.eq("channel", channel).eq("externalId", id)
    )
    .take(10)
/** The outbound message a status is about: this number's send of that wamid
    to the status's recipient. */
const statusMessage = async (
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  data: Record<string, unknown>
) => {
  const recipient = string(data.recipient_id)
  return (
    (await messagesByExternalId(ctx, string(data.id), account.channel)).find(
      (message) =>
        message.direction === "outbound" &&
        message.accountId === account._id &&
        (!recipient || message.to === recipient)
    ) ?? null
  )
}
/** The connected row for a phone number id; disconnected teams' rows stay. */
const accountByExternalId = async (
  ctx: MutationCtx,
  id: string,
  channel: Doc<"channelAccounts">["channel"] = "whatsapp"
) =>
  (
    await ctx.db
      .query("channelAccounts")
      .withIndex("by_channel_and_externalId", (q) =>
        q.eq("channel", channel).eq("externalId", id)
      )
      .take(20)
  ).find(live) ?? null

async function receive(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  value: Record<string, unknown>,
  raw: unknown,
  event: Doc<"metaWebhookEvents">
) {
  const data = object(raw)
  const externalId = string(data.id)
  const sender = string(data.from).replace(/^\+/, "")
  const phone = normalizePhone(sender.startsWith("+") ? sender : `+${sender}`)
  if (
    !externalId ||
    !sender ||
    (account.channel === "whatsapp" && !phone) ||
    (await messagesByExternalId(ctx, externalId, account.channel)).some(
      (message) => message.accountId === account._id
    )
  )
    return
  const at = timestamp(data.timestamp, event.receivedAt)
  const profile = array(value.contacts)
    .map(object)
    .find((contact) => string(contact.wa_id) === sender)
  const profileName = string(object(profile?.profile).name)
  const type =
    CHANNEL_MESSAGE_TYPES.find((type) => type === data.type) ?? "unsupported"
  const media = object(data[type])
  const preview = (
    type === "text"
      ? string(object(data.text).body)
      : string(media.caption) || `[${type}]`
  ).slice(0, 1000)
  const { contactId, channelContactId, conversationId } =
    await upsertChannelThread(ctx, account, {
      externalId: sender,
      ...(account.channel === "whatsapp" && phone ? { phone } : {}),
      profileName,
      at,
      preview,
      direction: "inbound",
    })
  const message = await insertRow(
    ctx,
    "channelMessages",
    {
      organizationId: account.organizationId,
      channel: account.channel,
      accountId: account._id,
      conversationId,
      channelContactId,
      direction: "inbound",
      from: sender,
      to: account.externalId,
      type,
      status: "received",
      preview,
      externalId,
      generation: 1,
      attempts: 0,
      search: [sender, account.handle, preview].join(" "),
    },
    true
  )
  const messageId = message._id
  const mediaId = string(media.id)
  const files =
    account.channel === "whatsapp"
      ? MEDIA_TYPES.some((t) => t === type) && mediaId
        ? [
            {
              mediaId,
              contentType:
                string(media.mime_type) || "application/octet-stream",
              ...(string(media.filename)
                ? { filename: string(media.filename) }
                : {}),
            },
          ]
        : []
      : array(data.attachments)
          .map(object)
          .flatMap((attachment, index) => {
            const url = string(object(attachment.payload).url)
            return url &&
              ["image", "video", "audio", "file", "sticker"].includes(
                string(attachment.type)
              )
              ? [
                  {
                    mediaId: `${externalId}:${index}`,
                    url,
                    contentType: "application/octet-stream",
                  },
                ]
              : []
          })
  await ctx.db.insert("channelMessageContents", {
    messageId,
    payload: JSON.stringify(data),
    ...(files.length ? { media: files } : {}),
  })
  await ctx.db.insert("channelMessageEvents", {
    messageId,
    type: "received",
    at,
    webhookEventId: event._id,
  })
  for (const file of files)
    await ctx.scheduler.runAfter(0, internal.channels.media.fetch, {
      messageId,
      mediaId: file.mediaId,
    })
  if (account.channel !== "whatsapp")
    await ctx.scheduler.runAfter(0, internal.meta.pageConnectActions.profile, {
      identityId: channelContactId,
      accountId: account._id,
    })
  const payload = channelMessagePayload(message, data)
  await emitEvent(
    ctx,
    account.organizationId,
    `${account.channel}.message.received`,
    payload
  )
  // Existing custom-event dispatch accepts reserved system names internally.
  await emitEvent(
    ctx,
    account.organizationId,
    customEventType(`opensend:${account.channel}.message.received`),
    { contact_id: contactId, payload }
  )
}

async function status(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  raw: unknown,
  event: Doc<"metaWebhookEvents">
) {
  const data = object(raw)
  const next = outboundStatus(data.status)
  if (!next) return
  const message = await statusMessage(ctx, account, data)
  if (!message) return
  if (
    account.channel !== "whatsapp" &&
    STATUS_RANK[next] <= STATUS_RANK[message.status]
  )
    return
  if (next === "sent") {
    await acceptChannelMessage(
      ctx,
      message,
      string(data.id),
      timestamp(data.timestamp, event.receivedAt)
    )
    return
  }
  const errors = array(data.errors).map(object)
  const error = errors[0]
  const advances = STATUS_RANK[next] > STATUS_RANK[message.status]
  const current = advances
    ? await patchRow(ctx, "channelMessages", message._id, {
        status: next,
        ...(next === "failed"
          ? {
              error:
                string(error?.message) ||
                string(error?.title) ||
                "WhatsApp delivery failed",
              ...(string(error?.title)
                ? { errorTitle: string(error?.title) }
                : {}),
              ...(typeof error?.code === "number"
                ? { errorCode: error.code }
                : {}),
            }
          : {}),
      })
    : message
  await ctx.db.insert("channelMessageEvents", {
    messageId: message._id,
    type: next,
    at: timestamp(data.timestamp, event.receivedAt),
    webhookEventId: event._id,
    details: JSON.stringify(data),
  })
  // Every status stays on the timeline; customer events describe that observation.
  const content = await ctx.db
    .query("channelMessageContents")
    .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
    .unique()
  const payload = channelMessagePayload(
    { ...current, status: next },
    content ? object(JSON.parse(content.payload)) : {}
  )
  await emitEvent(
    ctx,
    account.organizationId,
    `${account.channel}.message.${next}`,
    {
      ...payload,
      ...(errors.length ? { errors } : {}),
      ...(data.pricing ? { pricing: data.pricing } : {}),
      ...(data.conversation ? { conversation: data.conversation } : {}),
    }
  )
  if (errors.some((error) => error.code === 131050))
    await ctx.db.patch("channelContacts", message.channelContactId, {
      marketingOptOut: true,
    })
}

/** Preflight unmatched statuses before any write, so a mixed batch is atomic
    and retries cannot repeat timeline entries, unread increments or events. */
export const project = internalMutation({
  args: { id: v.id("metaWebhookEvents"), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, attempt = 0 }) => {
    const event = await ctx.db.get("metaWebhookEvents", id)
    if (!event || event.projectedAt !== undefined) return null
    const root = object(JSON.parse(event.body))
    const pageItems = []
    for (const item of pageWebhookItems(root, event.receivedAt)) {
      const account = await accountByExternalId(
        ctx,
        item.accountId,
        item.channel
      )
      if (!account || (await retirement(ctx, account.organizationId))) continue
      const connection = await ctx.db.get(
        "metaConnections",
        account.connectionId
      )
      if (connection?.status !== "active") continue
      if (item.kind === "status") {
        for (const mid of item.ids) {
          if (
            !(await statusMessage(ctx, account, {
              id: mid,
              recipient_id: item.sender,
            })) &&
            attempt < 6
          ) {
            await ctx.scheduler.runAfter(
              10000 * 2 ** attempt,
              internal.meta.projection.project,
              { id, attempt: attempt + 1 }
            )
            return null
          }
        }
      }
      pageItems.push({ item, account })
    }
    for (const { item, account } of pageItems) {
      if (item.kind === "message")
        await receive(ctx, account, {}, item.data, event)
      else {
        for (const mid of item.ids)
          await status(
            ctx,
            account,
            {
              id: mid,
              recipient_id: item.sender,
              status: item.status,
              timestamp: item.at / 1000,
            },
            event
          )
        if (item.watermark)
          await ctx.scheduler.runAfter(0, internal.meta.projection.watermark, {
            eventId: id,
            accountId: account._id,
            sender: item.sender,
            next: item.status,
            at: item.at,
            watermark: item.watermark,
            cursor: null,
          })
      }
    }
    const changes: {
      field: string
      value: Record<string, unknown>
      wabaId: string
      account: Doc<"channelAccounts"> | null
      organizationId: string
    }[] = []
    if (root.object === "whatsapp_business_account")
      for (const rawEntry of array(root.entry)) {
        const entry = object(rawEntry)
        for (const rawChange of array(entry.changes)) {
          const change = object(rawChange),
            value = object(change.value)
          const wabaId =
            string(object(value.waba_info).waba_id) || string(entry.id)
          const waba = await ctx.db
            .query("whatsappBusinessAccounts")
            .withIndex("by_wabaId", (q) => q.eq("wabaId", wabaId))
            .unique()
          if (!waba || (await retirement(ctx, waba.organizationId))) {
            console.info(
              "Ignoring Meta webhook for unknown or retired WABA",
              wabaId
            )
            continue
          }
          const field = string(change.field)
          const account =
            field === "messages"
              ? await accountByExternalId(
                  ctx,
                  string(object(value.metadata).phone_number_id)
                )
              : null
          if (
            field === "messages" &&
            (!account ||
              account.wabaId !== wabaId ||
              account.organizationId !== waba.organizationId)
          ) {
            console.info(
              "Ignoring Meta webhook for unknown phone number",
              string(object(value.metadata).phone_number_id)
            )
            continue
          }
          if (account)
            for (const rawStatus of array(value.statuses)) {
              const data = object(rawStatus)
              if (!outboundStatus(data.status) || !string(data.id)) continue
              if (!(await statusMessage(ctx, account, data))) {
                if (attempt < 6) {
                  await ctx.scheduler.runAfter(
                    10000 * 2 ** attempt,
                    internal.meta.projection.project,
                    { id, attempt: attempt + 1 }
                  )
                  return null
                }
                console.info(
                  "Dropping unmatched WhatsApp status after retries",
                  string(data.id)
                )
              }
            }
          changes.push({
            field,
            value,
            wabaId,
            account,
            organizationId: waba.organizationId,
          })
        }
      }
    for (const change of changes) {
      if (change.account) {
        for (const message of array(change.value.messages))
          await receive(ctx, change.account, change.value, message, event)
        for (const update of array(change.value.statuses))
          await status(ctx, change.account, update, event)
      } else if (
        TEMPLATE_WEBHOOK_FIELDS.some((field) => field === change.field)
      ) {
        await templateWebhook(
          ctx,
          change.organizationId,
          change.wabaId,
          change.field,
          change.value
        )
      } else if (
        [
          "phone_number_quality_update",
          "phone_number_name_update",
          "account_update",
        ].includes(change.field)
      )
        await ctx.scheduler.runAfter(0, internal.meta.projection.management, {
          wabaId: change.wabaId,
          organizationId: change.organizationId,
          field: change.field,
          value: change.value,
          cursor: null,
        })
    }
    await ctx.db.patch("metaWebhookEvents", id, { projectedAt: Date.now() })
    return null
  },
})

/** Account updates may cover every number in a WABA; bound each transaction. */
export const management = internalMutation({
  args: {
    wabaId: v.string(),
    organizationId: v.string(),
    field: v.string(),
    value: v.record(v.string(), v.any()),
    cursor: v.union(v.string(), v.null()),
    matched: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await retirement(ctx, args.organizationId)) return null
    const page = await ctx.db
      .query("channelAccounts")
      .withIndex("by_wabaId", (q) => q.eq("wabaId", args.wabaId))
      .paginate({ numItems: 100, cursor: args.cursor })
    let matched = args.matched ?? false
    const value = args.value,
      event = string(value.event)
    const phone = string(value.display_phone_number).replace(/\D/g, "")
    for (const account of page.page) {
      if (
        account.channel !== "whatsapp" ||
        !live(account) ||
        account.organizationId !== args.organizationId ||
        (args.field !== "account_update" &&
          (!phone || account.handle.replace(/\D/g, "") !== phone))
      )
        continue
      matched = true
      const patch: Partial<Doc<"channelAccounts">> = { checkedAt: Date.now() }
      if (args.field === "phone_number_quality_update") {
        const limit =
          string(value.max_daily_conversations_per_business) ||
          string(value.current_limit)
        if (limit) patch.messagingLimit = limit
        const quality = string(value.quality_rating).toLowerCase()
        if (
          quality === "green" ||
          quality === "yellow" ||
          quality === "red" ||
          quality === "unknown"
        )
          patch.quality = quality
        if (event === "THROUGHPUT_UPGRADE") patch.throughputMps = 1000
        if (event === "ONBOARDING") patch.status = "pending"
        if (event === "FLAGGED") patch.quality = "red"
      }
      if (
        args.field === "phone_number_name_update" &&
        value.decision === "APPROVED" &&
        string(value.requested_verified_name)
      )
        patch.displayName = string(value.requested_verified_name)
      if (args.field === "account_update") {
        const ban = string(object(value.ban_info).waba_ban_state)
        if (
          [
            "ACCOUNT_DELETED",
            "PARTNER_REMOVED",
            "PARTNER_APP_UNINSTALLED",
            "ACCOUNT_OFFBOARDED",
          ].includes(event)
        )
          patch.status = "disconnected"
        else if (
          ["ACCOUNT_RESTRICTION", "ACCOUNT_VIOLATION"].includes(event) ||
          (event === "DISABLED_UPDATE" && ban === "DISABLE")
        )
          patch.status = "restricted"
        else if (
          event === "ACCOUNT_RECONNECTED" ||
          (event === "DISABLED_UPDATE" && ban === "REINSTATE")
        )
          patch.status = "active"
      }
      await patchRow(ctx, "channelAccounts", account._id, patch)
      await emitEvent(
        ctx,
        account.organizationId,
        "whatsapp.phone_number.updated",
        {
          id: account._id,
          channel: "whatsapp",
          account_id: account._id,
          waba_id: args.wabaId,
          field: args.field,
          ...value,
        }
      )
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.meta.projection.management, {
        ...args,
        cursor: page.continueCursor,
        matched,
      })
    else if (!matched)
      console.info(
        "Ignoring Meta management webhook for unknown number",
        args.wabaId,
        phone
      )
    return null
  },
})

/** Read/delivery watermarks cover this recipient's messages up to a timestamp.
 * Page through a conversation so even a long thread fits transaction limits. */
export const watermark = internalMutation({
  args: {
    eventId: v.id("metaWebhookEvents"),
    accountId: v.id("channelAccounts"),
    sender: v.string(),
    next: v.union(v.literal("read"), v.literal("delivered")),
    at: v.number(),
    watermark: v.number(),
    cursor: v.union(v.string(), v.null()),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.get("channelAccounts", args.accountId),
      event = await ctx.db.get("metaWebhookEvents", args.eventId)
    if (
      !account ||
      !event ||
      !live(account) ||
      (await retirement(ctx, account.organizationId))
    )
      return null
    const identity = await ctx.db
      .query("channelContacts")
      .withIndex(
        "by_organizationId_and_channel_and_scopeId_and_externalId",
        (q) =>
          q
            .eq("organizationId", account.organizationId)
            .eq("channel", account.channel)
            .eq("scopeId", account.externalId)
            .eq("externalId", args.sender)
      )
      .unique()
    if (!identity) return null
    const thread = await ctx.db
      .query("conversations")
      .withIndex("by_accountId_and_channelContactId", (q) =>
        q.eq("accountId", account._id).eq("channelContactId", identity._id)
      )
      .unique()
    if (!thread) return null
    const page = await ctx.db
      .query("channelMessages")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", thread._id))
      .paginate({ cursor: args.cursor, numItems: 100 })
    let pending = false
    for (const message of page.page) {
      if (
        message.direction !== "outbound" ||
        message._creationTime > args.watermark ||
        (message.sentAt ?? 0) > args.watermark
      )
        continue
      if (!message.externalId && message.status === "queued") {
        pending = true
        continue
      }
      if (message.externalId)
        await status(
          ctx,
          account,
          {
            id: message.externalId,
            recipient_id: args.sender,
            status: args.next,
            timestamp: args.at / 1000,
          },
          event
        )
    }
    if (pending && (args.attempt ?? 0) < 6)
      await ctx.scheduler.runAfter(
        10000 * 2 ** (args.attempt ?? 0),
        internal.meta.projection.watermark,
        { ...args, attempt: (args.attempt ?? 0) + 1 }
      )
    else if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.meta.projection.watermark, {
        ...args,
        cursor: page.continueCursor,
        attempt: 0,
      })
    return null
  },
})
