import { v } from "convex/values"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { normalizePhone, fromWaId } from "../../lib/dashboard/phone"
import { patchContact } from "../audience"
import { insertRow, patchRow } from "../counts"
import { upsertChannelThread, recordWhatsAppUser } from "../channels/identity"
import { broadcastMessageMetric } from "../broadcastMetrics"
import { emitEvent } from "../events"
import { retirement } from "../teamLifecycle"
import { CHANNEL_QUALITIES } from "../tables/channels"
import { HIGH_THROUGHPUT_MPS } from "../../lib/meta/whatsapp-account"
import { acceptChannelMessage } from "../channels/messages"
import { enqueueMediaFetch } from "../channels/mediaState"
import { hydratedChannelMessage } from "../channels/payload"
import { live, wabaByWabaId } from "./connect"
import { templateWebhook } from "../whatsapp/templates"
import { TEMPLATE_WEBHOOK_FIELDS } from "../../lib/meta/templates"
import { array, object, string, oneOf } from "../../lib/meta/parse"
import {
  STATUS_RANK,
  pageWebhookItems,
  whatsappWebhookItems,
  MANAGEMENT_WEBHOOK_FIELDS,
  ACCOUNT_REMOVED_EVENTS,
  ACCOUNT_RESTRICTED_EVENTS,
  type InboundItem,
  type StatusItem,
  type WebhookItem,
} from "../../lib/meta/webhooks"

export const MAX_ATTEMPTS = 3
export const retryLater = (attempt: number) =>
  attempt < MAX_ATTEMPTS ? 10000 * 2 ** attempt : null

/** Messages with a wamid. Meta's ids are unique, but a lookup must not
    throw on a duplicate row, so callers pick the row they mean. */
const messagesByExternalId = (
  ctx: MutationCtx,
  id: string,
  channel: Doc<"channelAccounts">["channel"]
) =>
  ctx.db
    .query("channelMessages")
    .withIndex("by_channel_and_externalId", (q) =>
      q.eq("channel", channel).eq("externalId", id)
    )
    .take(10)
/** Match the sending account and Meta id; the recipient only breaks ties. */
const statusMessage = async (
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  item: Pick<StatusItem, "sender" | "externalId">
) => {
  const candidates = (
    await messagesByExternalId(ctx, item.externalId, account.channel)
  ).filter(
    (message) =>
      message.direction === "outbound" && message.accountId === account._id
  )
  return (
    candidates.find((message) => message.to === item.sender) ??
    candidates[0] ??
    null
  )
}
/** The connected row for a phone number id; disconnected teams' rows stay. */
const accountByExternalId = async (
  ctx: MutationCtx,
  id: string,
  channel: Doc<"channelAccounts">["channel"]
) =>
  (
    await ctx.db
      .query("channelAccounts")
      .withIndex("by_channel_and_externalId_and_disconnectedAt", (q) =>
        q
          .eq("channel", channel)
          .eq("externalId", id)
          .eq("disconnectedAt", undefined)
      )
      .take(20)
  ).find(live) ?? null

async function receive(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  item: InboundItem,
  event: Doc<"metaWebhookEvents">
) {
  const {
    externalId,
    sender,
    phone,
    profileName,
    type,
    preview,
    files,
    at,
    data,
  } = item
  if (
    (await messagesByExternalId(ctx, externalId, account.channel)).some(
      (message) => message.accountId === account._id
    )
  )
    return
  const { contactId, channelContactId, conversationId } =
    await upsertChannelThread(ctx, account, {
      externalId: sender,
      ...(phone ? { phone } : {}),
      profileName,
      ...(item.userId ? { userId: item.userId } : {}),
      ...(item.parentUserId ? { parentUserId: item.parentUserId } : {}),
      ...(item.username ? { username: item.username } : {}),
      ...(item.identityKeyHash
        ? { identityKeyHash: item.identityKeyHash }
        : {}),
      at,
      preview,
      direction: "inbound",
      opensWindow: type !== "system",
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
      ...(type === "reaction" && string(object(data.reaction).message_id)
        ? { reactionTargetExternalId: string(object(data.reaction).message_id) }
        : {}),
      status: "received",
      observedAt: at,
      preview,
      externalId,
      generation: 1,
      attempts: 0,
    },
    true
  )
  const messageId = message._id
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
    await enqueueMediaFetch(ctx, {
      messageId,
      mediaId: file.mediaId,
    })
  if (type === "system") {
    const system = object(data.system)
    if (string(system.user_id))
      await recordWhatsAppUser(
        ctx,
        account,
        channelContactId,
        string(system.user_id)
      )
    const nextPhone = normalizePhone(fromWaId(string(system.wa_id)))
    if (nextPhone) {
      const existing = await ctx.db
        .query("contacts")
        .withIndex("by_organizationId_and_phone", (q) =>
          q.eq("organizationId", account.organizationId).eq("phone", nextPhone)
        )
        .first()
      const contact = await ctx.db.get("contacts", contactId)
      if (contact && (!existing || existing._id === contactId))
        await patchContact(ctx, contact, { phone: nextPhone }, at)
      const existingIdentity = await ctx.db
        .query("channelContacts")
        .withIndex(
          "by_organizationId_and_channel_and_scopeId_and_externalId",
          (q) =>
            q
              .eq("organizationId", account.organizationId)
              .eq("channel", "whatsapp")
              .eq("scopeId", "whatsapp")
              .eq("externalId", nextPhone.slice(1))
        )
        .first()
      if (!existingIdentity || existingIdentity._id === channelContactId)
        await ctx.db.patch("channelContacts", channelContactId, {
          phone: nextPhone,
          externalId: nextPhone.slice(1),
          scopeId: "whatsapp",
        })
    }
  }
  if (type === "revoke") {
    const target = (
      await messagesByExternalId(
        ctx,
        string(object(data.revoke).original_message_id),
        "whatsapp"
      )
    ).find(
      (m) => m.accountId === account._id && m.conversationId === conversationId
    )
    if (target)
      await patchRow(ctx, "channelMessages", target._id, { revokedAt: at })
  }
  const identity = await ctx.db.get("channelContacts", channelContactId)
  if (
    account.channel !== "whatsapp" &&
    !phone &&
    !identity?.profileName &&
    identity?.profileLookedUpAt === undefined
  ) {
    await ctx.db.patch("channelContacts", channelContactId, {
      profileLookedUpAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.meta.pageConnectActions.profile, {
      identityId: channelContactId,
      accountId: account._id,
    })
  }
  const payload = await hydratedChannelMessage(ctx, message, Date.now())
  await emitEvent(
    ctx,
    account.organizationId,
    `${account.channel}.message.received`,
    payload
  )
}

async function status(
  ctx: MutationCtx,
  account: Doc<"channelAccounts">,
  item: StatusItem,
  message: Doc<"channelMessages">,
  event: Doc<"metaWebhookEvents">
) {
  const { data, status: next, at } = item
  // Meta can rebundle the same observation under a new body hash. Only an
  // advancing milestone may update evidence, metrics, or the customer outbox.
  if (STATUS_RANK[next] <= STATUS_RANK[message.status]) return message
  const content = await ctx.db
    .query("channelMessageContents")
    .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
    .unique()
  if (content)
    await ctx.db.patch("channelMessageContents", content._id, {
      statusState: JSON.stringify(data),
    })
  if (next === "sent") {
    return acceptChannelMessage(ctx, message, item.externalId, at)
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
  if (advances) await broadcastMessageMetric(ctx, current)
  await ctx.db.insert("channelMessageEvents", {
    messageId: message._id,
    type: next,
    at,
    webhookEventId: event._id,
    details: JSON.stringify(data),
  })
  // Customer events describe the advancing milestone.
  const payload = await hydratedChannelMessage(
    ctx,
    { ...current, status: next },
    Date.now()
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
      status_raw: data,
      ...(data.biz_opaque_callback_data
        ? { biz_opaque_callback_data: data.biz_opaque_callback_data }
        : {}),
    }
  )
  if (errors.some((error) => error.code === 131050))
    await ctx.db.patch("channelContacts", message.channelContactId, {
      marketingOptOut: true,
    })
  return current
}

/** Project available items immediately. Retries contain only unmatched status indexes. */
export const project = internalMutation({
  args: {
    id: v.id("metaWebhookEvents"),
    attempt: v.optional(v.number()),
    statusIndexes: v.optional(v.array(v.number())),
    cursor: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { id, attempt = 0, statusIndexes, cursor = 0 }) => {
    const event = await ctx.db.get("metaWebhookEvents", id)
    if (
      !event ||
      (!statusIndexes &&
        (event.projectedAt !== undefined ||
          (event.projectionCursor ?? 0) !== cursor))
    )
      return null
    const root = object(JSON.parse(event.body))
    const retired = new Map<string, boolean>()
    const isRetired = async (org: string) => {
      if (!retired.has(org)) retired.set(org, !!(await retirement(ctx, org)))
      return retired.get(org)!
    }
    const accounts = new Map<string, Doc<"channelAccounts"> | null>()
    const connections = new Map<string, Doc<"metaConnections"> | null>()
    const accountFor = async (item: WebhookItem) => {
      const key = `${item.channel}:${item.accountId}`
      if (!accounts.has(key)) {
        let account = await accountByExternalId(
          ctx,
          item.accountId,
          item.channel
        )
        if (account && !(await isRetired(account.organizationId))) {
          if (!connections.has(account.connectionId))
            connections.set(
              account.connectionId,
              await ctx.db.get("metaConnections", account.connectionId)
            )
          // WhatsApp keeps accepting inbound during a token error, as before.
          if (
            item.channel !== "whatsapp" &&
            connections.get(account.connectionId)?.status !== "active"
          )
            account = null
        } else account = null
        accounts.set(key, account)
      }
      return accounts.get(key)!
    }
    const items: WebhookItem[] = pageWebhookItems(root, event.receivedAt)
    const changes: {
      field: string
      value: Record<string, unknown>
      wabaId: string
      organizationId: string
    }[] = []
    const wabas = new Map<string, Doc<"whatsappBusinessAccounts"> | null>()
    if (root.object === "whatsapp_business_account")
      for (const rawEntry of array(root.entry)) {
        const entry = object(rawEntry)
        for (const rawChange of array(entry.changes)) {
          const change = object(rawChange),
            value = object(change.value)
          const wabaId =
            string(object(value.waba_info).waba_id) || string(entry.id)
          if (!wabas.has(wabaId))
            wabas.set(wabaId, await wabaByWabaId(ctx, wabaId))
          const waba = wabas.get(wabaId)
          const field = string(change.field)
          if (field === "messages")
            items.push(...whatsappWebhookItems(value, wabaId, event.receivedAt))
          else if (waba && !(await isRetired(waba.organizationId)))
            changes.push({
              field,
              value,
              wabaId,
              organizationId: waba.organizationId,
            })
        }
      }
    const resolved: {
      item: WebhookItem
      account: Doc<"channelAccounts">
      message: Doc<"channelMessages"> | null
    }[] = []
    const pendingIndexes = statusIndexes ? new Set(statusIndexes) : null
    const unmatched: number[] = []
    for (const [index, item] of items.entries()) {
      // Ten messages leave headroom for contacts, counts, media and outbox
      // writes. The raw event and progress commit with the continuation.
      if (!pendingIndexes && (index < cursor || index >= cursor + 10)) continue
      if (
        pendingIndexes &&
        (!pendingIndexes.has(index) ||
          (item.kind !== "status" && item.kind !== "payment"))
      )
        continue
      const account = await accountFor(item)
      if (!account) continue
      if (item.wabaId) {
        const waba = wabas.get(item.wabaId)
        if (
          account.wabaId !== item.wabaId ||
          account.organizationId !== waba?.organizationId
        )
          continue
      }
      const message =
        item.kind === "status" || item.kind === "payment"
          ? await statusMessage(ctx, account, item)
          : null
      if ((item.kind === "status" || item.kind === "payment") && !message) {
        unmatched.push(index)
        continue
      }
      resolved.push({ item, account, message })
    }
    const observed = new Map<string, Doc<"channelMessages">>()
    for (const { item, account, message } of resolved) {
      if (
        (item.kind === "status" || item.kind === "payment") &&
        message &&
        string(item.data.recipient_user_id)
      )
        await recordWhatsAppUser(
          ctx,
          account,
          message.channelContactId,
          string(item.data.recipient_user_id),
          {
            ...(string(item.data.recipient_parent_user_id)
              ? { parentUserId: string(item.data.recipient_parent_user_id) }
              : {}),
          }
        )
      if (item.kind === "message") await receive(ctx, account, item, event)
      else if (item.kind === "payment" && message) {
        const content = await ctx.db
          .query("channelMessageContents")
          .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
          .unique()
        if (content)
          await ctx.db.patch("channelMessageContents", content._id, {
            paymentState: JSON.stringify(item.data),
          })
        await ctx.db.insert("channelMessageEvents", {
          messageId: message._id,
          type: "payment_updated",
          at: item.at,
          webhookEventId: event._id,
          details: JSON.stringify(item.data),
        })
        await emitEvent(
          ctx,
          account.organizationId,
          "whatsapp.message.payment_updated",
          {
            ...(await hydratedChannelMessage(ctx, message, Date.now())),
            status_raw: item.data,
          }
        )
      } else if (item.kind === "status" && message) {
        const current = await status(
          ctx,
          account,
          item,
          observed.get(message._id) ?? message,
          event
        )
        observed.set(message._id, current)
      } else if (item.kind === "watermark")
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
    const more = !statusIndexes && cursor + 10 < items.length
    for (const change of statusIndexes || more ? [] : changes) {
      if (oneOf(change.field, TEMPLATE_WEBHOOK_FIELDS))
        await templateWebhook(
          ctx,
          change.organizationId,
          change.wabaId,
          change.field,
          change.value
        )
      else if (oneOf(change.field, MANAGEMENT_WEBHOOK_FIELDS))
        await ctx.scheduler.runAfter(0, internal.meta.projection.management, {
          ...change,
          cursor: null,
        })
    }
    const delay = retryLater(attempt)
    if (unmatched.length && delay !== null)
      await ctx.scheduler.runAfter(delay, internal.meta.projection.project, {
        id,
        attempt: attempt + 1,
        statusIndexes: unmatched,
      })
    else if (unmatched.length)
      console.info(
        "Dropping unmatched Meta statuses after retries",
        unmatched.length
      )
    if (!statusIndexes) {
      await ctx.db.patch(
        "metaWebhookEvents",
        id,
        more
          ? { projectionCursor: cursor + 10 }
          : { projectedAt: Date.now(), projectionCursor: undefined }
      )
      if (more)
        await ctx.scheduler.runAfter(0, internal.meta.projection.project, {
          id,
          cursor: cursor + 10,
        })
    }
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
        patch.quality = oneOf(quality, CHANNEL_QUALITIES) ?? account.quality
        if (event === "THROUGHPUT_UPGRADE")
          patch.throughputMps = HIGH_THROUGHPUT_MPS
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
        if (oneOf(event, ACCOUNT_REMOVED_EVENTS)) patch.status = "disconnected"
        else if (
          oneOf(event, ACCOUNT_RESTRICTED_EVENTS) ||
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
      .withIndex("by_conversationId", (q) =>
        q.eq("conversationId", thread._id).lte("_creationTime", args.watermark)
      )
      .order("desc")
      .paginate({ cursor: args.cursor, numItems: 100 })
    let pending = false
    for (const message of page.page) {
      if (
        message.direction !== "outbound" ||
        message._creationTime > args.watermark ||
        (message.sentAt ?? 0) > args.watermark
      )
        continue
      if (
        message.status !== "failed" &&
        STATUS_RANK[message.status] >= STATUS_RANK[args.next]
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
            kind: "status",
            externalId: message.externalId,
            sender: args.sender,
            status: args.next,
            at: args.at,
            data: {
              id: message.externalId,
              recipient_id: args.sender,
              status: args.next,
              timestamp: args.at / 1000,
            },
          },
          message,
          event
        )
    }
    const delay = retryLater(args.attempt ?? 0)
    if (pending && delay !== null)
      await ctx.scheduler.runAfter(delay, internal.meta.projection.watermark, {
        ...args,
        attempt: (args.attempt ?? 0) + 1,
      })
    else if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.meta.projection.watermark, {
        ...args,
        cursor: page.continueCursor,
        attempt: 0,
      })
    return null
  },
})
