import { vOnCompleteArgs, Workpool, type WorkId } from "@convex-dev/workpool"
import { v } from "convex/values"
import type { FunctionHandle } from "convex/server"
import schema from "./schema.js"

import { components, internal } from "./_generated/api.js"
import type { Doc } from "./_generated/dataModel.js"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server.js"
import {
  vDeliverResult,
  validateDelivery,
  validateEmail,
  vDelivery,
  vEmail,
  vEmailEvent,
  vEmailStatus,
  type EmailEvent,
  type Status,
} from "./shared.js"

const NOT_FINALIZED = Number.MAX_SAFE_INTEGER
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
const CLEANUP_BATCH = 100

/* Concurrency is not a rate limiter. Five workers bound load; HTTP 429s
   use exponential backoff. Other clients share the team's 10 req/s quota. */
const pool = new Workpool(components.workpool, { maxParallelism: 5 })

/* Queue an email. It is sent in the background and retried on network
   errors, rate limits, and server errors. */
export const sendEmail = mutation({
  args: {
    email: vEmail,
    delivery: vDelivery,
    onEmailEvent: v.optional(v.string()),
    enqueueKey: v.optional(v.string()),
  },
  returns: v.id("emails"),
  handler: async (ctx, { email, delivery, onEmailEvent, enqueueKey }) => {
    validateEmail(email)
    validateDelivery(delivery)
    if (enqueueKey) {
      const existing = await ctx.db
        .query("emails")
        .withIndex("by_enqueueKey", (q) => q.eq("enqueueKey", enqueueKey))
        .unique()
      if (existing) return existing._id
    }
    const emailId = await ctx.db.insert("emails", {
      ...email,
      onEmailEvent,
      enqueueKey,
      status: "queued",
      idempotencyKey: crypto.randomUUID(),
      opened: false,
      clicked: false,
      complained: false,
      finalizedAt: NOT_FINALIZED,
    })
    const workId = await pool.enqueueAction(
      ctx,
      internal.delivery.deliver,
      { emailId, apiKey: delivery.apiKey, baseUrl: delivery.baseUrl },
      {
        retry: {
          maxAttempts: delivery.maxAttempts,
          initialBackoffMs: delivery.initialBackoffMs,
          base: 2,
        },
        onComplete: internal.lib.onDeliverComplete,
        context: { emailId },
      }
    )
    await ctx.db.patch("emails", emailId, { workId })
    return emailId
  },
})

/* Best effort. An email that OpenSend already accepted cannot be called
   back. Returns whether the email was still queued. */
export const cancelEmail = mutation({
  args: { emailId: v.id("emails") },
  returns: v.boolean(),
  handler: async (ctx, { emailId }) => {
    const email = await ctx.db.get("emails", emailId)
    if (!email || email.status !== "queued") return false
    await ctx.db.patch("emails", emailId, {
      status: "cancelled",
      html: undefined,
      text: undefined,
      template: undefined,
      attachments: undefined,
      finalizedAt: Date.now(),
    })
    if (email.workId) await pool.cancel(ctx, email.workId as WorkId)
    return true
  },
})

export const status = query({
  args: { emailId: v.id("emails") },
  returns: v.union(v.null(), vEmailStatus),
  handler: async (ctx, { emailId }) => {
    const email = await ctx.db.get("emails", emailId)
    if (!email) return null
    const { status, opensendId, errorMessage, opened, clicked, complained } =
      email
    return { status, opensendId, errorMessage, opened, clicked, complained }
  },
})

export const get = query({
  args: { emailId: v.id("emails") },
  returns: v.union(
    v.null(),
    schema
      .doc("emails")
      .omit(
        "onEmailEvent",
        "workId",
        "idempotencyKey",
        "enqueueKey",
        "sentEventApplied"
      )
  ),
  handler: async (ctx, { emailId }) => {
    const email = await ctx.db.get("emails", emailId)
    if (!email) return null
    const {
      onEmailEvent: _callback,
      workId: _work,
      idempotencyKey: _key,
      enqueueKey: _enqueue,
      sentEventApplied: _sent,
      ...result
    } = email
    void [_callback, _work, _key, _enqueue, _sent]
    return result
  },
})

/* Applies one verified webhook event. Events for unknown ids are ignored. */
export const handleEmailEvent = mutation({
  args: { event: vEmailEvent },
  returns: v.null(),
  handler: async (ctx, { event }) => {
    let email = await ctx.db
      .query("emails")
      .withIndex("by_opensendId", (q) => q.eq("opensendId", event.opensendId))
      .unique()
    if (!email && event.componentEmailId) {
      const id = ctx.db.normalizeId("emails", event.componentEmailId)
      const candidate = id ? await ctx.db.get("emails", id) : null
      if (
        candidate &&
        !candidate.opensendId &&
        ["queued", "cancelled", "failed"].includes(candidate.status)
      ) {
        email = candidate
        await ctx.db.patch("emails", candidate._id, {
          opensendId: event.opensendId,
        })
      }
    }
    if (!email) return null
    const patch = eventPatch(email, event)
    if (patch) {
      await ctx.db.patch("emails", email._id, {
        ...patch,
        finalizedAt: Date.now(),
      })
      if (email.onEmailEvent) {
        await ctx.runMutation(
          email.onEmailEvent as FunctionHandle<
            "mutation",
            { id: string; event: EmailEvent }
          >,
          { id: email._id, event }
        )
      }
    }
    return null
  },
})

/* Deletes finalized rows in bounded transactions. Keep one cutoff throughout
   the run so activity during a multi-batch cleanup never broadens its scope. */
export const cleanupOldEmails = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { olderThan }) => {
    if (
      olderThan !== undefined &&
      (!Number.isFinite(olderThan) || olderThan < 0)
    )
      throw new Error("OpenSend olderThan must be finite and nonnegative.")
    return cleanupBatch(ctx, Date.now() - (olderThan ?? ONE_WEEK_MS))
  },
})

export const continueCleanup = internalMutation({
  args: { cutoff: v.number() },
  returns: v.null(),
  handler: (ctx, { cutoff }) => cleanupBatch(ctx, cutoff),
})

async function cleanupBatch(ctx: MutationCtx, cutoff: number): Promise<null> {
  const old = await ctx.db
    .query("emails")
    .withIndex("by_finalizedAt", (q) =>
      q.lt("finalizedAt", Math.min(cutoff, NOT_FINALIZED))
    )
    .take(CLEANUP_BATCH)
  for (const email of old) {
    if (email.status !== "queued") await ctx.db.delete("emails", email._id)
  }
  if (old.length === CLEANUP_BATCH)
    await ctx.scheduler.runAfter(0, internal.lib.continueCleanup, { cutoff })
  return null
}

export const getQueued = internalQuery({
  args: { emailId: v.id("emails") },
  returns: v.union(
    v.null(),
    v.object({ email: vEmail, idempotencyKey: v.string() })
  ),
  handler: async (ctx, { emailId }) => {
    const email = await ctx.db.get("emails", emailId)
    if (!email || email.status !== "queued") return null
    const {
      from,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      html,
      text,
      headers,
      template,
      tags,
      scheduledAt,
      topicId,
      attachments,
    } = email
    return {
      email: {
        from,
        to,
        cc,
        bcc,
        replyTo,
        subject,
        html,
        text,
        headers,
        template,
        tags,
        scheduledAt,
        topicId,
        attachments,
      },
      idempotencyKey: email.idempotencyKey,
    }
  },
})

export const recordAcceptance = internalMutation({
  args: { emailId: v.id("emails"), opensendId: v.string() },
  returns: v.null(),
  handler: async (ctx, { emailId, opensendId }) => {
    const email = await ctx.db.get("emails", emailId)
    if (email)
      await ctx.db.patch("emails", emailId, {
        opensendId,
        ...(email.status === "queued"
          ? { status: "sent" as const, finalizedAt: Date.now() }
          : {}),
        html: undefined,
        text: undefined,
        template: undefined,
        attachments: undefined,
      })
    return null
  },
})

export const onDeliverComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ emailId: v.id("emails") }), vDeliverResult),
  returns: v.null(),
  handler: async (ctx, { context: { emailId }, result }) => {
    const email = await ctx.db.get("emails", emailId)
    /* Cancelled while the attempt was in flight. */
    if (!email || email.status !== "queued") return null

    const finalizedAt = Date.now()
    if (result.kind === "canceled") {
      await ctx.db.patch("emails", emailId, {
        status: "cancelled",
        html: undefined,
        text: undefined,
        template: undefined,
        attachments: undefined,
        finalizedAt,
      })
      return null
    }
    const outcome =
      result.kind === "success"
        ? result.returnValue
        : { sent: false as const, error: result.error }
    if (outcome.sent) {
      /* The body is not needed once OpenSend has it. */
      await ctx.db.patch("emails", emailId, {
        status: "sent",
        opensendId: outcome.opensendId,
        html: undefined,
        text: undefined,
        template: undefined,
        attachments: undefined,
        finalizedAt,
      })
    } else {
      await ctx.db.patch("emails", emailId, {
        status: "failed",
        errorMessage: outcome.error,
        html: undefined,
        text: undefined,
        template: undefined,
        attachments: undefined,
        finalizedAt,
      })
    }
    return null
  },
})

/* Status only moves forward, so a late "sent" cannot undo "delivered". */
const STATUS_RANK: Record<Status, number> = {
  queued: 0,
  sent: 1,
  delivery_delayed: 2,
  delivered: 4,
  bounced: 5,
  failed: 3,
  cancelled: 6,
}

const EVENT_STATUS: Partial<Record<EmailEvent["type"], Status>> = {
  "email.sent": "sent",
  "email.delivery_delayed": "delivery_delayed",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.failed": "failed",
  "email.suppressed": "failed",
}

function eventPatch(
  email: Doc<"emails">,
  event: EmailEvent
): Partial<Doc<"emails">> | null {
  switch (event.type) {
    case "email.opened":
      return email.opened ? null : { opened: true }
    case "email.clicked":
      return email.clicked ? null : { clicked: true }
    case "email.complained":
      return email.complained ? null : { complained: true }
  }
  if (
    event.type === "email.sent" &&
    email.status === "sent" &&
    !email.sentEventApplied
  )
    return { sentEventApplied: true }
  const next = EVENT_STATUS[event.type]
  if (!next || STATUS_RANK[next] <= STATUS_RANK[email.status]) return null
  return {
    status: next,
    ...(event.type === "email.sent" ? { sentEventApplied: true } : {}),
    ...(next === "delivered"
      ? { errorMessage: undefined }
      : event.message
        ? { errorMessage: event.message }
        : {}),
  }
}
