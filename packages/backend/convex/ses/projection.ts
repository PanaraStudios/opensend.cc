import { v } from "convex/values"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { acceptEmail, emailEventData, tagSafe } from "../emails"
import { insertEmailEvent, patchEmail } from "../emailRows"
import { recordMetric, emailAddresses, loadMetricContext } from "../metricRows"
import { upsertSuppression } from "../suppressions"
import { emitEvent } from "../events"
import { retirement } from "../teamLifecycle"

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const string = (value: unknown) => (typeof value === "string" ? value : "")
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const time = (value: unknown, fallback: number) => {
  const parsed = Date.parse(string(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

const TYPES = {
  SEND: ["sent", "send"],
  DELIVERY: ["delivered", "delivery"],
  BOUNCE: ["bounced", "bounce"],
  COMPLAINT: ["complained", "complaint"],
  DELIVERYDELAY: ["delivery_delayed", "deliveryDelay"],
  REJECT: ["failed", "reject"],
  RENDERINGFAILURE: ["failed", "failure"],
} as const

// Delivery evidence supersedes pre-delivery failures. Recipient feedback
// stays visible even when another recipient subsequently engages.
const RANK: Record<Doc<"emails">["status"], number> = {
  scheduled: 0,
  queued: 0,
  sent: 1,
  delivery_delayed: 2,
  failed: 3,
  delivered: 4,
  opened: 5,
  clicked: 6,
  bounced: 7,
  complained: 8,
  canceled: 9,
  suppressed: 9,
}

/** A raw event and all projections commit together. Unmatched events stay
    replayable: tags can be absent and the send response may not be saved yet. */
export async function projectEvent(ctx: MutationCtx, event: Doc<"sesEvents">) {
  if (event.projectedAt !== undefined) return
  let payload: unknown
  try {
    payload = JSON.parse(event.message)
  } catch {
    return
  }
  const root = object(payload)
  const kind = string(root.eventType ?? root.notificationType)
    .replace(/[ _]/g, "")
    .toUpperCase()
  if (!(kind in TYPES)) return
  const [status, field] = TYPES[kind as keyof typeof TYPES]
  const mail = object(root.mail)
  const messageId = string(mail.messageId)
  if (!messageId) return
  const tags = object(mail.tags)
  const tag = (name: string) => string(array(tags[name])[0])
  const taggedId = ctx.db.normalizeId("emails", tag("opensend_email"))
  const tagged = taggedId ? await ctx.db.get("emails", taggedId) : null
  const byMessage = await ctx.db
    .query("emails")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .unique()
  if (tagged && byMessage && tagged._id !== byMessage._id) return
  const email = tagged ?? byMessage
  if (
    !email ||
    (email.messageId && email.messageId !== messageId) ||
    (await retirement(ctx, email.organizationId))
  )
    return
  if (["scheduled", "canceled", "suppressed"].includes(email.status)) return
  if (
    !email.messageId &&
    !email.claimed &&
    email.status !== "sent" &&
    !(email.status === "failed" && email.attempts > 0)
  )
    return
  const domain = await ctx.db.get("domains", email.domainId)
  const region = await ctx.db
    .query("sesRegions")
    .withIndex("by_topicArn", (q) => q.eq("topicArn", event.topicArn))
    .unique()
  if (!domain || !region || domain.region !== region.region) return
  if (
    tag("opensend_team") &&
    tag("opensend_team") !== tagSafe(domain.organizationId)
  )
    return
  if (
    email.source !== "system" &&
    domain.organizationId !== email.organizationId
  )
    return
  const detail = object(root[field])
  const at = time(detail.timestamp, time(mail.timestamp, event._creationTime))
  const allowed = new Set(emailAddresses(email))
  const recipientData =
    status === "bounced"
      ? array(detail.bouncedRecipients)
      : status === "complained"
        ? array(detail.complainedRecipients)
        : status === "delivery_delayed"
          ? array(detail.delayedRecipients)
          : status === "delivered"
            ? array(detail.recipients)
            : array(mail.destination)
  const recipients = [
    ...new Set(
      recipientData
        .map((entry) =>
          string(typeof entry === "string" ? entry : object(entry).emailAddress)
            .trim()
            .toLowerCase()
        )
        .filter((address) => allowed.has(address))
    ),
  ]
  // Never infer a bounce/complaint victim from the entire original envelope.
  if (
    ["bounced", "complained", "delivery_delayed", "delivered"].includes(
      status
    ) &&
    !recipients.length
  )
    return
  const context = await loadMetricContext(ctx, email, domain)
  const current = await acceptEmail(
    ctx,
    email,
    messageId,
    time(mail.timestamp, at),
    context
  )
  /* Sent is stamped on our clock when SES's response arrives, a little after
     SES accepted the message; a fast bounce can carry an earlier SES time.
     The timeline stays in lifecycle order; metrics and `details` keep SES's
     own time. */
  const eventAt = Math.max(at, current.sentAt ?? at)
  const extra: Record<string, unknown> = {}
  if (status === "bounced") {
    const bounceType = string(detail.bounceType)
    const type =
      bounceType === "Permanent" || bounceType === "Transient"
        ? bounceType
        : "Undetermined"
    extra.bounce = {
      type,
      subType: string(detail.bounceSubType),
      message: recipientData
        .map((entry) => string(object(entry).diagnosticCode))
        .filter(Boolean)
        .join("; "),
    }
    await recordMetric(ctx, current, type, at, recipients, context)
    if (type === "Permanent" && current.source !== "system")
      for (const address of recipients)
        await upsertSuppression(
          ctx,
          current.organizationId,
          address,
          "bounced",
          current._id
        )
  }
  if (status === "complained") {
    await recordMetric(ctx, current, "delivered", at, recipients, context)
    if (current.source !== "system")
      for (const address of recipients)
        await upsertSuppression(
          ctx,
          current.organizationId,
          address,
          "complained",
          current._id
        )
  }
  if (status === "failed")
    extra.failed = {
      reason:
        string(detail.errorMessage ?? detail.reason) ||
        "SES rejected the email",
    }
  if (RANK[status] > RANK[current.status])
    await patchEmail(ctx, current._id, {
      status,
      error:
        status === "failed" ? string(object(extra.failed).reason) : undefined,
    })
  // The sender owns the single sent entry and webhook, including the race
  // where SNS is the first evidence that SES accepted the message.
  if (status !== "sent") {
    await insertEmailEvent(
      ctx,
      current,
      status,
      eventAt,
      {
        sesEventId: event._id,
        recipients,
        details: { ...detail, recipients: recipientData },
      },
      context
    )
    if (current.source !== "system") {
      const addressed = [
        "bounced",
        "complained",
        "delivered",
        "delivery_delayed",
      ].includes(status)
      const destinations = addressed
        ? recipients.map((recipient) => [recipient])
        : [current.to]
      for (const to of destinations)
        await emitEvent(ctx, current.organizationId, `email.${status}`, {
          ...(await emailEventData(ctx, current)),
          to,
          ...extra,
        })
    }
  }
  await ctx.db.patch("sesEvents", event._id, { projectedAt: Date.now() })
}

export const project = internalMutation({
  args: { id: v.id("sesEvents"), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, attempt = 0 }) => {
    const event = await ctx.db.get("sesEvents", id)
    if (event) {
      await projectEvent(ctx, event)
      if (
        (await ctx.db.get("sesEvents", id))?.projectedAt === undefined &&
        attempt < 6
      )
        await ctx.scheduler.runAfter(
          10000 * 2 ** attempt,
          internal.ses.projection.project,
          { id, attempt: attempt + 1 }
        )
    }
    return null
  },
})

/** Each first-party HTTP hit gets its own timeline and webhook entry;
    milestone metrics remain unique through the shared writer. */
export async function projectEngagement(
  ctx: MutationCtx,
  email: Doc<"emails">,
  status: "opened" | "clicked",
  detail: { link: string; ipAddress: string; userAgent: string }
) {
  const at = Date.now()
  const recipients = emailAddresses(email)
  const context = await loadMetricContext(ctx, email)
  await recordMetric(ctx, email, "delivered", at, recipients, context)
  if (status === "clicked")
    await recordMetric(ctx, email, "opened", at, recipients, context)
  if (RANK[status] > RANK[email.status])
    await patchEmail(ctx, email._id, {
      status,
      error: undefined,
      expiresAt: email.expiresAt ?? at + 30 * 86_400_000,
    })
  await insertEmailEvent(
    ctx,
    email,
    status,
    at,
    {
      recipients,
      details: detail,
    },
    context
  )
  if (email.source !== "system")
    await emitEvent(ctx, email.organizationId, `email.${status}`, {
      ...(await emailEventData(ctx, email)),
      ...(status === "clicked"
        ? { click: { ...detail, timestamp: new Date(at).toISOString() } }
        : {}),
    })
}
