import { broadcastChannels } from "./broadcastChannels"
import { rowChannel } from "../lib/channels"
import { findTopicChoice } from "./audience"
import { effectiveTopicSubscription } from "../lib/dashboard/contacts"
import {
  broadcastStatsValue,
  whatsappStatsValue,
  skipReasonValue,
} from "./tables/broadcasts"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { internal } from "./_generated/api"
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireTeam } from "./access"
import { counters, insertRow, patchRow } from "./counts"
import { emptyBroadcastStats } from "../lib/dashboard/broadcast"

export async function finishBroadcast(ctx: MutationCtx, id: Id<"broadcasts">) {
  const row = await ctx.db.get("broadcasts", id)
  if (!row || row.status !== "queued" || !row.audienceDone) return
  const [pending, failedSettled, failedPending] =
    await counters.broadcastRecipients.prefixTotals(ctx, id, [
      [false],
      [true, true],
      [false, true],
    ])
  if (pending) return
  const failed = failedSettled + failedPending
  await patchRow(ctx, "broadcasts", id, {
    status: failed ? "failed" : "sent",
    sentAt: Date.now(),
    settledAt: Date.now(),
    updatedAt: Date.now(),
  })
}
export type BroadcastContext = {
  recipient: Doc<"broadcastRecipients"> | null
  broadcast: Doc<"broadcasts"> | null
}

export async function loadBroadcastContext(
  ctx: QueryCtx,
  email: Doc<"emails">
): Promise<BroadcastContext> {
  const recipient = email.broadcastId
    ? await ctx.db
        .query("broadcastRecipients")
        .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
        .unique()
    : null
  return {
    recipient,
    broadcast: recipient
      ? await ctx.db.get("broadcasts", recipient.broadcastId)
      : null,
  }
}

/** Retained independently of email retention, once per recipient milestone. */
export async function broadcastMetric(
  ctx: MutationCtx,
  email: Doc<"emails">,
  type: string,
  loaded?: BroadcastContext
) {
  if (!email.broadcastId) return
  const context = loaded ?? (await loadBroadcastContext(ctx, email))
  const { recipient, broadcast } = context
  if (!recipient || broadcast?.retainedStats) return
  const supported = [
    "delivered",
    "opened",
    "clicked",
    "bounced",
    "suppressed",
    "complained",
    "unsubscribed",
  ]
  if (supported.includes(type)) {
    const previous = await ctx.db
      .query("broadcastEvents")
      .withIndex("by_emailId_and_type", (q) =>
        q.eq("emailId", email._id).eq("type", type)
      )
      .unique()
    if (!previous)
      await insertRow(ctx, "broadcastEvents", {
        organizationId: email.organizationId,
        broadcastId: recipient.broadcastId,
        emailId: email._id,
        email: recipient.email,
        type,
      })
  }
  const sent = type === "sent" && !recipient.sent
  const settled =
    !recipient.settled &&
    ["sent", "failed", "suppressed", "canceled"].includes(type)
  if (sent || settled)
    context.recipient = await patchRow(
      ctx,
      "broadcastRecipients",
      recipient._id,
      {
        ...(sent ? { sent: true } : {}),
        ...(settled ? { settled: true, failed: type === "failed" } : {}),
      }
    )
  if (settled) await finishBroadcast(ctx, recipient.broadcastId)
}
/** Channel-tagged metrics for dashboard callers; legacy queries retain their shapes. */
export const channelStats = query({
  args: { organizationId: v.string(), id: v.id("broadcasts") },
  returns: v.union(
    v.object({ channel: v.literal("email"), stats: broadcastStatsValue }),
    v.object({ channel: v.literal("whatsapp"), stats: whatsappStatsValue })
  ),
  handler: async (ctx, { organizationId, id }) => {
    await requireTeam(ctx, organizationId)
    const row = await ctx.db.get("broadcasts", id)
    if (!row || row.organizationId !== organizationId)
      return { channel: "email" as const, stats: emptyBroadcastStats() }
    return broadcastChannels[rowChannel(row)].readStats(ctx, row)
  },
})

export const stats = query({
  args: { organizationId: v.string(), id: v.id("broadcasts") },
  returns: broadcastStatsValue,
  handler: async (ctx, { organizationId, id }) => {
    await requireTeam(ctx, organizationId)
    const row = await ctx.db.get("broadcasts", id)
    const stats = emptyBroadcastStats()
    if (!row || row.organizationId !== organizationId) return stats
    if (row.retainedStats) return row.retainedStats
    return readBroadcastStats(ctx, id)
  },
})

export async function readBroadcastStats(ctx: QueryCtx, id: Id<"broadcasts">) {
  const stats = emptyBroadcastStats()
  const keys = [
    "delivered",
    "opened",
    "clicked",
    "bounced",
    "suppressed",
    "complained",
    "unsubscribed",
  ] as const
  const [recipients, counts] = await Promise.all([
    counters.broadcastRecipients.total(ctx, id),
    counters.broadcastEvents.prefixTotals(
      ctx,
      id,
      keys.map((key) => [key])
    ),
  ])
  stats.recipients = recipients ?? 0
  keys.forEach((key, index) => {
    stats[key] = counts[index]
  })
  return stats
}

/** Preferences may change while SES pacing keeps a recipient in the queue. */
export async function broadcastRecipientProblem(
  ctx: MutationCtx,
  email: Doc<"emails">
) {
  if (!email.broadcastId) return null
  const recipient = await ctx.db
    .query("broadcastRecipients")
    .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
    .unique()
  if (!recipient) return "audience"
  const broadcast = await ctx.db.get("broadcasts", recipient.broadcastId)
  if (!broadcast || broadcast.organizationId !== email.organizationId)
    return "audience"
  if (
    broadcast.segmentId &&
    !(await ctx.db.get("segments", broadcast.segmentId))
  )
    return "audience"
  const topic = broadcast.topicId
    ? await ctx.db.get("topics", broadcast.topicId)
    : null
  if (broadcast.topicId && !topic) return "audience"
  const contact = recipient.contactId
    ? await ctx.db.get("contacts", recipient.contactId)
    : null
  if (
    !contact ||
    contact.organizationId !== email.organizationId ||
    !contact.email ||
    contact.email !== recipient.email ||
    contact.unsubscribed
  )
    return "unsubscribed"
  if (
    topic &&
    effectiveTopicSubscription(
      (await findTopicChoice(ctx, contact._id, topic._id))?.subscription,
      topic
    ) !== "subscribed"
  )
    return "unsubscribed"
  return null
}

/** Count actual engagement occurrences separately from unique milestone metrics. */
export async function recordBroadcastReport(
  ctx: MutationCtx,
  email: Doc<"emails">,
  event: Doc<"emailEvents">,
  loaded?: BroadcastContext
) {
  if (!email.broadcastId || event.broadcastReported) return
  const context = loaded ?? (await loadBroadcastContext(ctx, email))
  const { recipient, broadcast } = context
  if (!recipient || broadcast?.retainedStats) return
  if (event.type === "sent" && !recipient.sent)
    context.recipient = await patchRow(
      ctx,
      "broadcastRecipients",
      recipient._id,
      { sent: true }
    )
  const milestone = await ctx.db
    .query("broadcastEvents")
    .withIndex("by_emailId_and_type", (q) =>
      q.eq("emailId", email._id).eq("type", event.type)
    )
    .unique()
  if (milestone && ["opened", "clicked", "bounced"].includes(event.type)) {
    await patchRow(ctx, "broadcastEvents", milestone._id, {
      count: (milestone.count ?? 0) + 1,
      ...(event.type === "bounced"
        ? {
            bounceType: String(
              event.details?.bounceType ?? "Undetermined"
            ).toLowerCase(),
          }
        : {}),
    })
  }
  const url: unknown = event.details?.link
  if (event.type === "clicked" && typeof url === "string" && url) {
    const previous = await ctx.db
      .query("broadcastLinks")
      .withIndex("by_broadcastId_and_url", (q) =>
        q.eq("broadcastId", recipient.broadcastId).eq("url", url)
      )
      .unique()
    const linkId =
      previous?._id ??
      (await insertRow(ctx, "broadcastLinks", {
        organizationId: email.organizationId,
        broadcastId: recipient.broadcastId,
        url,
        clicks: 0,
        uniqueClicks: 0,
      }))
    const member = await ctx.db
      .query("broadcastRecipientLinks")
      .withIndex("by_emailId_and_linkId", (q) =>
        q.eq("emailId", email._id).eq("linkId", linkId)
      )
      .unique()
    if (member)
      await patchRow(ctx, "broadcastRecipientLinks", member._id, {
        clicks: member.clicks + 1,
      })
    else
      await insertRow(ctx, "broadcastRecipientLinks", {
        organizationId: email.organizationId,
        broadcastId: recipient.broadcastId,
        emailId: email._id,
        linkId,
        clicks: 1,
      })
    await patchRow(ctx, "broadcastLinks", linkId, {
      clicks: (previous?.clicks ?? 0) + 1,
      uniqueClicks: (previous?.uniqueClicks ?? 0) + (member ? 0 : 1),
    })
  }
  await patchRow(ctx, "emailEvents", event._id, { broadcastReported: true })
}

/** WhatsApp settles on delivery/read/failure. A sent message with no further
 * webhook settles after 24 hours; late read receipts still update its stats. */
export async function broadcastMessageMetric(
  ctx: MutationCtx,
  message: Doc<"channelMessages">
) {
  if (!message.broadcastId) return
  const recipient = await ctx.db
    .query("broadcastRecipients")
    .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
    .unique()
  if (!recipient || recipient.organizationId !== message.organizationId) return
  const terminal = ["delivered", "read", "failed"].includes(message.status)
  if (!recipient.sent && message.sentAt !== undefined)
    await patchRow(ctx, "broadcastRecipients", recipient._id, { sent: true })
  if (!recipient.settled && terminal) {
    await patchRow(ctx, "broadcastRecipients", recipient._id, {
      settled: true,
      failed: message.status === "failed",
    })
    await finishBroadcast(ctx, recipient.broadcastId)
  }
  if (message.sentAt !== undefined) {
    const broadcast = await ctx.db.get("broadcasts", recipient.broadcastId)
    if (broadcast && message.sentAt > (broadcast.lastMessageSentAt ?? 0))
      await patchRow(ctx, "broadcasts", broadcast._id, {
        lastMessageSentAt: message.sentAt,
      })
  }
  await scheduleBroadcastSettle(ctx, recipient.broadcastId)
}

/** Schedule once all recipients have left the send queue. The deadline is
 * relative to the final send, regardless of audience size or delivery pacing. */
export async function scheduleBroadcastSettle(
  ctx: MutationCtx,
  id: Id<"broadcasts">
) {
  const row = await ctx.db.get("broadcasts", id)
  if (
    !row ||
    row.channel !== "whatsapp" ||
    !row.audienceDone ||
    row.settleJob ||
    !row.lastMessageSentAt
  )
    return
  const [queued] = await counters.broadcastMessages.prefixTotals(ctx, id, [
    ["queued"],
  ])
  if (queued) return
  const job = await ctx.scheduler.runAt(
    row.lastMessageSentAt + 24 * 3600_000,
    internal.broadcastMetrics.settleBroadcast,
    { id, cursor: null }
  )
  await patchRow(ctx, "broadcasts", id, { settleJob: job })
}
export const settleBroadcast = internalMutation({
  args: { id: v.id("broadcasts"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { id, cursor }) => {
    const row = await ctx.db.get("broadcasts", id)
    if (
      !row ||
      row.retainedWhatsAppStats ||
      (row.lastMessageSentAt ?? 0) + 24 * 3600_000 > Date.now()
    )
      return null
    const page = await ctx.db
      .query("broadcastRecipients")
      .withIndex("by_broadcastId_and_email", (q) => q.eq("broadcastId", id))
      .paginate({ numItems: 100, cursor })
    for (const recipient of page.page) {
      if (recipient.settled || !recipient.messageId) continue
      const message = await ctx.db.get("channelMessages", recipient.messageId)
      if (
        message?.status === "sent" &&
        message.sentAt !== undefined &&
        message.sentAt + 24 * 3600_000 <= Date.now()
      )
        await patchRow(ctx, "broadcastRecipients", recipient._id, {
          settled: true,
        })
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.broadcastMetrics.settleBroadcast,
        { id, cursor: page.continueCursor }
      )
    else await finishBroadcast(ctx, id)
    return null
  },
})

export const settleMessage = internalMutation({
  args: { id: v.id("channelMessages") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const message = await ctx.db.get("channelMessages", id)
    if (
      !message?.broadcastId ||
      message.status !== "sent" ||
      (message.sentAt ?? Number.MAX_SAFE_INTEGER) + 24 * 3600_000 > Date.now()
    )
      return null
    const recipient = await ctx.db
      .query("broadcastRecipients")
      .withIndex("by_messageId", (q) => q.eq("messageId", id))
      .unique()
    if (recipient && !recipient.settled) {
      await patchRow(ctx, "broadcastRecipients", recipient._id, {
        settled: true,
      })
      await finishBroadcast(ctx, recipient.broadcastId)
    }
    return null
  },
})
export const whatsappStats = query({
  args: { organizationId: v.string(), id: v.id("broadcasts") },
  returns: whatsappStatsValue,
  handler: async (ctx, { organizationId, id }) => {
    await requireTeam(ctx, organizationId)
    const row = await ctx.db.get("broadcasts", id)
    if (
      !row ||
      row.organizationId !== organizationId ||
      row.channel !== "whatsapp"
    )
      return emptyWhatsAppStats()
    return row.retainedWhatsAppStats ?? readWhatsAppStats(ctx, id)
  },
})
export function emptyWhatsAppStats() {
  return {
    recipients: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    skipped: 0,
  }
}
export async function readWhatsAppStats(ctx: QueryCtx, id: Id<"broadcasts">) {
  const [messages, skipCounts] = await Promise.all([
    counters.broadcastMessages.prefixTotals(ctx, id, [
      ["queued"],
      ["sent"],
      ["delivered"],
      ["read"],
      ["failed"],
    ]),
    counters.broadcastRecipients.prefixTotals(
      ctx,
      id,
      skipReasonValue.members.map(({ value }) => [true, false, value])
    ),
  ])
  const [queued, sent, delivered, read, failed] = messages
  return {
    recipients: queued + sent + delivered + read + failed,
    sent: sent + delivered + read,
    delivered: delivered + read,
    read,
    failed,
    skipped: skipCounts.reduce((sum, count) => sum + count, 0),
  }
}
