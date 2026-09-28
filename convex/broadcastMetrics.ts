import { findTopicChoice } from "./audience"
import { effectiveTopicSubscription } from "../lib/dashboard/contacts"
import { broadcastStatsValue } from "./tables/broadcasts"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { query, type MutationCtx, type QueryCtx } from "./_generated/server"
import { requireTeam } from "./access"
import { counters, insertRow, patchRow } from "./counts"
import { emptyBroadcastStats } from "../lib/dashboard/broadcast"

export async function finishBroadcast(ctx: MutationCtx, id: Id<"broadcasts">) {
  const row = await ctx.db.get("broadcasts", id)
  if (!row || row.status !== "queued" || !row.audienceDone) return
  const pending = await counters.broadcastRecipients.total(ctx, id, [
    { is: false, among: [true, false] },
  ])
  if (pending) return
  const failed = await counters.broadcastRecipients.total(ctx, id, [
    { among: [true, false] },
    { is: true, among: [true, false] },
  ])
  await patchRow(ctx, "broadcasts", id, {
    status: failed ? "failed" : "sent",
    sentAt: Date.now(),
    settledAt: Date.now(),
    updatedAt: Date.now(),
  })
}
/** Retained independently of email retention, once per recipient milestone. */
export async function broadcastMetric(
  ctx: MutationCtx,
  email: Doc<"emails">,
  type: string
) {
  if (!email.broadcastId) return
  const recipient = await ctx.db
    .query("broadcastRecipients")
    .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
    .unique()
  if (!recipient) return
  if ((await ctx.db.get("broadcasts", recipient.broadcastId))?.retainedStats)
    return
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
  if (
    !recipient.settled &&
    ["sent", "failed", "suppressed", "canceled"].includes(type)
  ) {
    await patchRow(ctx, "broadcastRecipients", recipient._id, {
      settled: true,
      failed: type === "failed",
    })
    await finishBroadcast(ctx, recipient.broadcastId)
  }
}
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
  stats.recipients = (await counters.broadcastRecipients.total(ctx, id)) ?? 0
  for (const key of [
    "delivered",
    "opened",
    "clicked",
    "bounced",
    "suppressed",
    "complained",
    "unsubscribed",
  ] as const)
    stats[key] =
      (await counters.broadcastEvents.total(ctx, id, [
        { is: key, among: [] },
      ])) ?? 0
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
  const contact = await ctx.db.get("contacts", recipient.contactId)
  if (
    !contact ||
    contact.organizationId !== email.organizationId ||
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
