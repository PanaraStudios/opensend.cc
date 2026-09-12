import { v } from "convex/values"
import type { FunctionHandle } from "convex/server"
import { Workpool } from "@convex-dev/workpool"
import { RateLimiter } from "@convex-dev/rate-limiter"
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js"
import { api, components, internal } from "./_generated/api.js"
import type { Doc, Id } from "./_generated/dataModel.js"
import schema from "./schema.js"
import {
  ACCEPTED_EVENT_TYPES,
  SES_EMAIL_ID_TAG,
  vEmailEvent,
  vNameValue,
  vOptions,
  vOnEmailEvent,
  vStatus,
  vTemplate,
  type EmailEvent,
  type RuntimeConfig,
  type Status,
} from "./shared.js"
import {
  createSesClient,
  planSendUnits,
  sendUnit,
  TransientSendError,
  unitRecipientCount,
  type OutboundEmail,
} from "./ses.js"
import {
  assertExhaustive,
  attemptToParse,
  isDeepEqual,
  assertRecipients,
  assertSimulatorRecipients,
  assertTuning,
  stableStringify,
  sleep,
  toArray,
} from "./utils.js"

/* ------------------------------------------------------------------------ */
/* Tuning constants                                                          */
/* ------------------------------------------------------------------------ */

const SECOND_MS = 1000
/** Emails are bucketed into time segments to avoid write contention between enqueues and batching. */
const SEGMENT_MS = 125
const BASE_BATCH_DELAY_MS = 1000
/** A batch holds roughly this many seconds' worth of sending at `maxSendRate`. */
const BATCH_WINDOW_SECONDS = 5
const MAX_BATCH_SIZE = 100
const EMAIL_POOL_SIZE = 4
const CALLBACK_POOL_SIZE = 4
const FINALIZED_EMAIL_RETENTION_MS = 7 * 24 * 60 * 60 * SECOND_MS
const ABANDONED_EMAIL_RETENTION_MS = 30 * 24 * 60 * 60 * SECOND_MS
const CLEANUP_BATCH_SIZE = 10
const ABANDONED_CLEANUP_BATCH_SIZE = 10
/** Sentinel for "not finalized yet"; lets us range-scan finalized emails by time. */
const FINALIZED_EPOCH = Number.MAX_SAFE_INTEGER

const getSegment = (now: number) => Math.floor(now / SEGMENT_MS)

/** How many emails to put in one batch for a given SES max send rate. */
export function batchSizeFor(maxSendRate: number): number {
  const size = Math.ceil(maxSendRate * BATCH_WINDOW_SECONDS)
  return Math.min(MAX_BATCH_SIZE, Math.max(1, size))
}

/* ------------------------------------------------------------------------ */
/* Infrastructure: workpools and rate limiter                                */
/* ------------------------------------------------------------------------ */

const emailPool = new Workpool(components.emailWorkpool, {
  maxParallelism: EMAIL_POOL_SIZE,
})

// Callbacks run in a separate pool so slow app code never starves sending.
const callbackPool = new Workpool(components.callbackWorkpool, {
  maxParallelism: CALLBACK_POOL_SIZE,
})

// Global token bucket sized from the account's SES max send rate. Config is
// supplied per call because the rate lives in the runtime options.
const sesRateLimiter = new RateLimiter(components.rateLimiter)

/**
 * Reserve `count` sends against the SES rate limit and return how long the
 * batch must wait before it may start.
 */
async function reserveSendSlots(
  ctx: MutationCtx,
  maxSendRate: number,
  count: number
): Promise<number> {
  const limit = await sesRateLimiter.limit(ctx, "sesSend", {
    count,
    reserve: true,
    config: {
      kind: "token bucket",
      rate: maxSendRate,
      period: SECOND_MS,
      capacity: maxSendRate,
    },
  })
  const jitter = Math.random() * 100
  return limit.retryAfter ? limit.retryAfter + jitter : 0
}

/* ------------------------------------------------------------------------ */
/* Enqueueing                                                                */
/* ------------------------------------------------------------------------ */

const vRecipients = v.array(v.string())

const emailInputFields = {
  from: v.string(),
  to: vRecipients,
  cc: v.optional(vRecipients),
  bcc: v.optional(vRecipients),
  subject: v.optional(v.string()),
  html: v.optional(v.string()),
  text: v.optional(v.string()),
  template: v.optional(vTemplate),
  replyTo: v.optional(vRecipients),
  headers: v.optional(v.array(vNameValue)),
  tags: v.optional(v.array(vNameValue)),
  configurationSetName: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
}

type EmailInput = {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  html?: string
  text?: string
  template?: Doc<"emails">["template"]
}

function assertValidContent(email: EmailInput) {
  assertRecipients(email)
  const hasContent = email.html !== undefined || email.text !== undefined
  const template = email.template
  if (!hasContent && !template) {
    throw new Error("Either html/text or template must be provided")
  }
  if (hasContent && template) {
    throw new Error("Cannot provide both html/text and template")
  }
  if (template) {
    const identities = [template.name, template.arn, template.content].filter(
      (x) => x !== undefined
    )
    if (identities.length !== 1) {
      throw new Error(
        "Template must specify exactly one of name, arn, or content"
      )
    }
  } else if (email.subject === undefined) {
    throw new Error("Subject is required when not using a template")
  }
}

async function storeContent(
  ctx: MutationCtx,
  data: string | undefined,
  mimeType: string
): Promise<Id<"content"> | undefined> {
  if (data === undefined) return undefined
  return await ctx.db.insert("content", {
    content: new TextEncoder().encode(data).buffer as ArrayBuffer,
    mimeType,
  })
}

const initialTrackingState = {
  bounced: false,
  complained: false,
  failed: false,
  deliveryDelayed: false,
  opened: false,
  clicked: false,
  finalizedAt: FINALIZED_EPOCH,
} as const

/**
 * Enqueue an email. A background worker groups waiting emails into batches
 * and hands them to a durable workpool that calls the SES API.
 */
export const sendEmail = mutation({
  args: { options: vOptions, ...emailInputFields },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    // Caller-supplied idempotency key: return the existing email instead of
    // enqueueing a duplicate. Mutations are transactional, so this is safe
    // under concurrent enqueues.
    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query("emails")
        .withIndex("by_idempotencyKey", (q) =>
          q.eq("idempotencyKey", args.idempotencyKey)
        )
        .first()
      if (existing) return existing._id
    }

    assertTuning(args.options)
    if (args.options.testMode) assertSimulatorRecipients(args)
    assertValidContent(args)
    if (args.tags?.some((tag) => tag.name === SES_EMAIL_ID_TAG)) {
      throw new Error(
        `${SES_EMAIL_ID_TAG} is reserved for correlating SES events`
      )
    }
    // Bound both document size and aggregate worker payloads below Convex limits.
    const payloadBytes = new TextEncoder().encode(
      JSON.stringify(args)
    ).byteLength
    if (payloadBytes > 128 * 1024) {
      throw new Error(
        "Email input exceeds the component limit of 128 KiB; use sendEmailManually for larger messages"
      )
    }
    if (args.headers?.some((h) => /[\r\n]/.test(h.name + h.value))) {
      throw new Error("Email headers cannot contain CR or LF")
    }

    const emailId = await ctx.db.insert("emails", {
      options: args.options,
      payloadBytes,
      onEmailEvent: args.options.onEmailEvent,
      from: args.from,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      html: await storeContent(ctx, args.html, "text/html"),
      text: await storeContent(ctx, args.text, "text/plain"),
      template: args.template,
      headers: args.headers,
      tags: args.tags,
      configurationSetName:
        args.configurationSetName ?? args.options.configurationSetName,
      replyTo: args.replyTo ?? [],
      idempotencyKey: args.idempotencyKey,
      segment: getSegment(Date.now()),
      status: "waiting",
      ...initialTrackingState,
    })

    await scheduleBatchRun(ctx, args.options)
    return emailId
  },
})

/** Register an email the app sends itself (outside the batching system) so it can be tracked. */
export const createManualEmail = mutation({
  args: {
    testMode: v.optional(v.boolean()),
    onEmailEvent: v.optional(vOnEmailEvent),
    from: v.string(),
    to: v.union(vRecipients, v.string()),
    cc: v.optional(v.union(vRecipients, v.string())),
    bcc: v.optional(v.union(vRecipients, v.string())),
    subject: v.string(),
    replyTo: v.optional(vRecipients),
    headers: v.optional(v.array(vNameValue)),
    tags: v.optional(v.array(vNameValue)),
    configurationSetName: v.optional(v.string()),
  },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    const recipients = {
      from: args.from,
      to: toArray(args.to) ?? [],
      cc: toArray(args.cc),
      bcc: toArray(args.bcc),
    }
    assertRecipients(recipients)
    if (args.testMode ?? true) assertSimulatorRecipients(recipients)
    return await ctx.db.insert("emails", {
      onEmailEvent: args.onEmailEvent,
      sendStarted: true,
      from: args.from,
      to: toArray(args.to) ?? [],
      cc: toArray(args.cc),
      bcc: toArray(args.bcc),
      subject: args.subject,
      headers: args.headers,
      tags: args.tags,
      configurationSetName: args.configurationSetName,
      replyTo: args.replyTo ?? [],
      segment: Infinity,
      status: "queued",
      ...initialTrackingState,
    })
  },
})

export const updateManualEmail = mutation({
  args: {
    emailId: v.id("emails"),
    status: vStatus,
    sesMessageId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get("emails", args.emailId)
    if (!email) throw new Error("Email not found")
    if (email.sesMessageId) return null // Preserve webhook progress and acceptance.
    const isFinal = args.status === "failed" || args.status === "cancelled"
    await ctx.db.patch("emails", args.emailId, {
      status: args.status,
      sesMessageId: args.sesMessageId,
      errorMessage: args.errorMessage,
      ...(args.status === "failed" ? { failed: true } : {}),
      ...(isFinal ? { finalizedAt: Date.now() } : {}),
    })
    return null
  },
})

/** Cancel an email that has not been handed to SES yet. */
export const cancelEmail = mutation({
  args: { emailId: v.id("emails") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get("emails", args.emailId)
    if (!email) throw new Error("Email not found")
    if (
      email.sendStarted ||
      (email.status !== "waiting" && email.status !== "queued")
    ) {
      throw new Error("Email has already been sent or sending has started")
    }
    await ctx.db.patch("emails", args.emailId, {
      status: "cancelled",
      options: undefined,
      finalizedAt: Date.now(),
    })
    return null
  },
})

/* ------------------------------------------------------------------------ */
/* Reading                                                                   */
/* ------------------------------------------------------------------------ */

const vEmailStatus = v.object({
  status: vStatus,
  errorMessage: v.union(v.string(), v.null()),
  sesMessageId: v.union(v.string(), v.null()),
  bounced: v.boolean(),
  complained: v.boolean(),
  failed: v.boolean(),
  deliveryDelayed: v.boolean(),
  opened: v.boolean(),
  clicked: v.boolean(),
})

export const getStatus = query({
  args: { emailId: v.id("emails") },
  returns: v.union(vEmailStatus, v.null()),
  handler: async (ctx, args) => {
    const email = await ctx.db.get("emails", args.emailId)
    if (!email) return null
    return {
      status: email.status,
      errorMessage: email.errorMessage ?? null,
      sesMessageId: email.sesMessageId ?? null,
      bounced: email.bounced,
      complained: email.complained,
      failed: email.failed,
      deliveryDelayed: email.deliveryDelayed,
      opened: email.opened,
      clicked: email.clicked,
    }
  },
})

const vEmailDetails = schema.tables.emails.validator
  .omit(
    "html",
    "text",
    "options",
    "onEmailEvent",
    "sendStarted",
    "payloadBytes"
  )
  .extend({
    createdAt: v.number(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
  })

async function readContent(
  ctx: QueryCtx,
  contentId: Id<"content"> | undefined
): Promise<string | undefined> {
  if (!contentId) return undefined
  const doc = await ctx.db.get("content", contentId)
  if (!doc) throw new Error("Content not found -- invariant")
  return new TextDecoder().decode(doc.content)
}

export const get = query({
  args: { emailId: v.id("emails") },
  returns: v.union(vEmailDetails, v.null()),
  handler: async (ctx, args) => {
    const email = await ctx.db.get("emails", args.emailId)
    if (!email) return null
    const {
      _id: _ignoredId,
      _creationTime,
      html,
      text,
      options: _options,
      onEmailEvent: _callback,
      sendStarted: _started,
      payloadBytes: _bytes,
      ...rest
    } = email
    return {
      ...rest,
      createdAt: _creationTime,
      html: await readContent(ctx, html),
      text: await readContent(ctx, text),
    }
  },
})

/* ------------------------------------------------------------------------ */
/* Batching worker                                                           */
/* ------------------------------------------------------------------------ */

/** Persist the latest options and make sure exactly one batch worker is scheduled. */
async function scheduleBatchRun(ctx: MutationCtx, options: RuntimeConfig) {
  const lastOptions = await ctx.db.query("lastOptions").unique()
  if (!lastOptions) {
    await ctx.db.insert("lastOptions", { options })
  } else if (!isDeepEqual(lastOptions.options, options)) {
    await ctx.db.replace("lastOptions", lastOptions._id, { options })
  }

  const existing = await ctx.db.query("nextBatchRun").unique()
  if (existing) return

  const runId = await ctx.scheduler.runAfter(
    BASE_BATCH_DELAY_MS,
    internal.lib.makeBatch,
    { reloop: false, segment: getSegment(Date.now() + BASE_BATCH_DELAY_MS) }
  )
  await ctx.db.insert("nextBatchRun", { runId })
}

/** Grab a batch of waiting emails and enqueue it on the durable email workpool. */
export const makeBatch = internalMutation({
  args: { reloop: v.boolean(), segment: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lastOptions = await ctx.db.query("lastOptions").unique()
    if (!lastOptions) throw new Error("No last options found -- invariant")
    const { options } = lastOptions
    const batchSize = batchSizeFor(options.maxSendRate)

    const candidates = await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) =>
        // Scan segments at least two back to avoid contending with fresh inserts.
        q.eq("status", "waiting").lte("segment", args.segment - 2)
      )
      .take(batchSize)

    const emails: Doc<"emails">[] = []
    let sendSeconds = 0
    let batchBytes = 0
    for (const email of candidates) {
      const count =
        email.to.length + (email.cc?.length ?? 0) + (email.bcc?.length ?? 0)
      const seconds = count / (email.options ?? options).maxSendRate
      const bytes = email.payloadBytes ?? 128 * 1024
      if (
        emails.length &&
        (sendSeconds + seconds > 50 || batchBytes + bytes > 2 * 1024 * 1024)
      )
        break
      emails.push(email)
      sendSeconds += seconds
      batchBytes += bytes
    }
    // New segments are picked up by a later scheduled pass.
    if (emails.length === 0) {
      await reschedule(ctx, emails.length > 0)
      return null
    }

    console.log(`Making a batch of ${emails.length} emails`)
    const emailIds = emails.map((e) => e._id)
    for (const emailId of emailIds) {
      await ctx.db.patch("emails", emailId, { status: "queued" })
    }

    // Credentials, retry policy, and callback belong to the enqueue, not the
    // latest SES instance to call this component.
    const groups = new Map<
      string,
      { options: RuntimeConfig; emailIds: Id<"emails">[] }
    >()
    for (const email of emails) {
      const config = email.options ?? options
      const key = stableStringify(config)
      const group = groups.get(key)
      if (group) group.emailIds.push(email._id)
      else groups.set(key, { options: config, emailIds: [email._id] })
    }
    for (const { options: config, emailIds } of groups.values()) {
      await emailPool.enqueueAction(
        ctx,
        internal.lib.sendBatch,
        {
          config: {
            region: config.region,
            credentials: config.credentials,
            maxSendRate: config.maxSendRate,
          },
          emailIds,
        },
        {
          retry: {
            maxAttempts: config.retryAttempts,
            initialBackoffMs: config.initialBackoffMs,
            base: 2,
          },
          context: { emailIds },
          onComplete: internal.lib.onBatchComplete,
        }
      )
    }

    // Keep going until this segment range is drained.
    await ctx.scheduler.runAfter(0, internal.lib.makeBatch, {
      reloop: true,
      segment: args.segment,
    })
    return null
  },
})

/**
 * Either sleep until newer segments are eligible, or, if nothing is waiting,
 * release the single worker slot so the system idles until the next enqueue.
 */
async function reschedule(ctx: MutationCtx, emailsLeft: boolean) {
  const anyWaiting =
    emailsLeft ||
    (await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) => q.eq("status", "waiting"))
      .first()) !== null

  if (!anyWaiting) {
    const batchRun = await ctx.db.query("nextBatchRun").unique()
    if (!batchRun) throw new Error("No batch run found -- invariant")
    await ctx.db.delete("nextBatchRun", batchRun._id)
    return
  }
  await ctx.scheduler.runAfter(BASE_BATCH_DELAY_MS, internal.lib.makeBatch, {
    reloop: false,
    segment: getSegment(Date.now() + BASE_BATCH_DELAY_MS),
  })
}

/* ------------------------------------------------------------------------ */
/* Sending                                                                   */
/* ------------------------------------------------------------------------ */

const vOutboundEmail = schema.tables.emails.validator
  .pick(
    "from",
    "to",
    "cc",
    "bcc",
    "subject",
    "replyTo",
    "template",
    "headers",
    "tags",
    "configurationSetName"
  )
  .extend({
    id: v.id("emails"),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
  })

/** Load the still-queued emails of a batch with their bodies, ready for SES. */
export const getBatchPayload = internalQuery({
  args: { emailIds: v.array(v.id("emails")) },
  returns: v.array(vOutboundEmail),
  handler: async (ctx, args) => {
    const docs = await Promise.all(
      args.emailIds.map((id) => ctx.db.get("emails", id))
    )
    const payload: OutboundEmail<Id<"emails">>[] = []
    for (const email of docs) {
      // Skip cancelled emails, emails already sent by an earlier attempt of
      // this batch, and emails cleaned up after their retention period.
      if (!email || email.status !== "queued") continue
      payload.push({
        id: email._id,
        from: email.from,
        to: email.to,
        cc: email.cc,
        bcc: email.bcc,
        subject: email.subject,
        replyTo: email.replyTo,
        html: await readContent(ctx, email.html),
        text: await readContent(ctx, email.text),
        template: email.template,
        headers: email.headers,
        tags: email.tags,
        configurationSetName: email.configurationSetName,
      })
    }
    return payload
  },
})

/** Reserve recipients at execution time, including workpool retries. */
export const reserveSend = internalMutation({
  args: { maxSendRate: v.number(), count: v.number() },
  returns: v.number(),
  handler: async (ctx, args) =>
    await reserveSendSlots(ctx, args.maxSendRate, args.count),
})

/** Atomic cancellation boundary immediately before handing a unit to SES. */
export const claimSend = internalMutation({
  args: { emailIds: v.array(v.id("emails")) },
  returns: v.array(v.id("emails")),
  handler: async (ctx, args) => {
    const claimed: Id<"emails">[] = []
    for (const id of args.emailIds) {
      const email = await ctx.db.get("emails", id)
      if (!email || email.status !== "queued") continue
      await ctx.db.patch("emails", id, { sendStarted: true })
      claimed.push(id)
    }
    return claimed
  },
})

const vSendOutcome = {
  sent: v.array(v.object({ emailId: v.id("emails"), messageId: v.string() })),
  failed: v.array(v.object({ emailId: v.id("emails"), error: v.string() })),
}

/**
 * Record the result of one SES API call. Called immediately after each call
 * so subsequent retries skip responses already recorded. SES acceptance and
 * this transaction are not atomic: lost responses can still cause duplicates.
 */
export const recordSendOutcome = internalMutation({
  args: vSendOutcome,
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const { emailId, messageId } of args.sent) {
      const email = await ctx.db.get("emails", emailId)
      if (!email || email.status !== "queued") continue
      await ctx.db.patch("emails", emailId, {
        status: "sent",
        sesMessageId: messageId,
        options: undefined,
      })
    }
    await markEmailsFailed(ctx, args.failed)
    return null
  },
})

/** Mark still-queued emails as failed; emails in any other state are left alone. */
async function markEmailsFailed(
  ctx: MutationCtx,
  failures: { emailId: Id<"emails">; error: string }[]
) {
  for (const { emailId, error } of failures) {
    const email = await ctx.db.get("emails", emailId)
    if (!email || email.status !== "queued") continue
    await ctx.db.patch("emails", emailId, {
      status: "failed",
      failed: true,
      errorMessage: error,
      options: undefined,
      finalizedAt: Date.now(),
    })
  }
}

/**
 * Call the Amazon SES API for a batch of emails, pacing calls to the account's
 * max send rate. Runs inside the email workpool with retries.
 *
 * SES has no idempotency key, so each accepted send is recorded before the
 * next call is made. A retry of this action only sees emails still `queued`.
 */
export const sendBatch = internalAction({
  args: {
    config: vOptions.pick("region", "credentials", "maxSendRate"),
    emailIds: v.array(v.id("emails")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const emails = await ctx.runQuery(internal.lib.getBatchPayload, {
      emailIds: args.emailIds,
    })
    if (emails.length === 0) {
      console.log(
        "No emails to send in batch. All were cancelled, sent, or failed."
      )
      return null
    }

    const client = createSesClient(args.config)
    const units = planSendUnits(
      emails,
      Math.min(50, Math.floor(args.config.maxSendRate))
    )
    const pendingRetry: Id<"emails">[] = []

    try {
      for (const planned of units) {
        const delay = await ctx.runMutation(internal.lib.reserveSend, {
          maxSendRate: args.config.maxSendRate,
          count: unitRecipientCount(planned),
        })
        if (delay > 0) await sleep(delay)
        const candidates =
          planned.kind === "single" ? [planned.email] : planned.emails
        const claimed = new Set(
          await ctx.runMutation(internal.lib.claimSend, {
            emailIds: candidates.map((e) => e.id),
          })
        )
        const ready = candidates.filter((e) => claimed.has(e.id))
        if (!ready.length) continue
        const unit =
          ready.length === 1
            ? { kind: "single" as const, email: ready[0]! }
            : { kind: "bulk" as const, emails: ready }
        const outcome = await sendUnit(client, unit)
        await ctx.runMutation(internal.lib.recordSendOutcome, {
          sent: outcome.sent,
          failed: outcome.failed,
        })
        pendingRetry.push(...outcome.retry)
      }
    } finally {
      client.destroy()
    }

    if (pendingRetry.length > 0) {
      throw new TransientSendError(
        `${pendingRetry.length} email(s) hit a transient SES failure and will be retried`
      )
    }
    return null
  },
})

/** Milliseconds to wait after sending `recipients` messages to stay under `maxSendRate` per second. */
export function paceDelayMs(recipients: number, maxSendRate: number): number {
  return Math.ceil(
    (recipients * SECOND_MS) / Math.max(maxSendRate, Number.EPSILON)
  )
}

export const onBatchComplete = emailPool.defineOnComplete({
  context: v.object({ emailIds: v.array(v.id("emails")) }),
  handler: async (ctx, args) => {
    const { result, context } = args
    if (result.kind === "success") return
    if (result.kind === "failed") {
      await markEmailsFailed(
        ctx,
        context.emailIds.map((emailId) => ({ emailId, error: result.error }))
      )
      return
    }
    if (result.kind === "canceled") {
      for (const emailId of context.emailIds) {
        const email = await ctx.db.get("emails", emailId)
        if (!email || email.status !== "queued") continue
        await ctx.db.patch("emails", emailId, {
          status: "cancelled",
          errorMessage: "SES batch job was cancelled",
          finalizedAt: Date.now(),
        })
      }
      return
    }
    assertExhaustive(result)
  },
})

/* ------------------------------------------------------------------------ */
/* Event handling                                                            */
/* ------------------------------------------------------------------------ */

const STATUS_RANK: Record<Status, number> = {
  waiting: 0,
  queued: 1,
  sent: 2,
  delivery_delayed: 3,
  delivered: 4,
  bounced: 5,
  failed: 5,
  cancelled: 100, // terminal
}

/**
 * SES feedback notifications configured directly on an identity use
 * `notificationType`; event publishing uses `eventType`. Normalize to the latter.
 */
export function normalizeSesEvent(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === "object" &&
    !("eventType" in raw) &&
    "notificationType" in raw
  ) {
    return { ...raw, eventType: raw.notificationType }
  }
  return raw
}

/** A human-readable summary of an event, stored alongside the delivery event. */
export function describeEvent(event: EmailEvent): string | undefined {
  switch (event.eventType) {
    case "Bounce": {
      const { bounce } = event
      const diagnostics = bounce.bouncedRecipients
        .map((r) => r.diagnosticCode ?? r.status)
        .filter((x): x is string => x !== undefined)
      return `${bounce.bounceType}/${bounce.bounceSubType}${
        diagnostics.length ? `: ${diagnostics.join("; ")}` : ""
      }`
    }
    case "Complaint":
      return event.complaint.complaintFeedbackType ?? undefined
    case "Reject":
      return event.reject.reason
    case "Rendering Failure":
      return event.failure.templateName
        ? `${event.failure.templateName}: ${event.failure.errorMessage}`
        : event.failure.errorMessage
    case "DeliveryDelay": {
      const { deliveryDelay } = event
      const diagnostics = (deliveryDelay.delayedRecipients ?? [])
        .map((r) => r.diagnosticCode)
        .filter((x): x is string => x !== undefined)
      return `${deliveryDelay.delayType}${
        diagnostics.length ? `: ${diagnostics.join("; ")}` : ""
      }`
    }
    case "Delivery":
      return event.delivery.smtpResponse
    case "Send":
    case "Open":
    case "Click":
    case "Subscription":
      return undefined
    default:
      return assertExhaustive(event)
  }
}

/**
 * Compute the updated email document for an event without writing it.
 * Returns null when the event causes no state change, to avoid write contention.
 */
export function computeEmailUpdateFromEvent(
  email: Doc<"emails">,
  event: EmailEvent
): Doc<"emails"> | null {
  const canUpgradeTo = (next: Status) =>
    email.status !== "cancelled" &&
    STATUS_RANK[next] > STATUS_RANK[email.status]
  const finalize = (doc: Doc<"emails">): Doc<"emails"> => ({
    ...doc,
    finalizedAt:
      doc.finalizedAt === FINALIZED_EPOCH ? Date.now() : doc.finalizedAt,
  })

  switch (event.eventType) {
    // We mark emails as sent when SES accepts the API call.
    case "Send":
    case "Subscription":
      return null

    case "Delivery":
      if (!canUpgradeTo("delivered")) return null
      return finalize({ ...email, status: "delivered" })

    case "Bounce": {
      const statusWillChange = canUpgradeTo("bounced")
      if (!statusWillChange && email.bounced) return null
      const updated: Doc<"emails"> = {
        ...email,
        bounced: true,
        errorMessage: describeEvent(event),
      }
      return statusWillChange
        ? finalize({ ...updated, status: "bounced" })
        : updated
    }

    case "Reject":
    case "Rendering Failure": {
      const statusWillChange = canUpgradeTo("failed")
      if (!statusWillChange && email.failed) return null
      const updated: Doc<"emails"> = {
        ...email,
        failed: true,
        errorMessage: describeEvent(event),
      }
      return statusWillChange
        ? finalize({ ...updated, status: "failed" })
        : updated
    }

    case "DeliveryDelay": {
      const statusWillChange = canUpgradeTo("delivery_delayed")
      if (!statusWillChange && email.deliveryDelayed) return null
      const updated: Doc<"emails"> = { ...email, deliveryDelayed: true }
      return statusWillChange
        ? { ...updated, status: "delivery_delayed" }
        : updated
    }

    case "Complaint":
      if (email.complained) return null
      return finalize({ ...email, complained: true })

    case "Open":
      if (email.opened) return null
      return { ...email, opened: true }

    case "Click":
      if (email.clicked) return null
      return { ...email, clicked: true }

    default:
      return assertExhaustive(event)
  }
}

/** Apply an SES event (delivered via SNS) to the matching email. */
export const handleEmailEvent = mutation({
  args: { event: v.any(), notificationId: v.optional(v.string()) },
  returns: v.union(v.null(), v.boolean()),
  handler: async (ctx, args) => {
    const result = attemptToParse(vEmailEvent, normalizeSesEvent(args.event))
    if (result.kind === "error") {
      console.warn(
        `Invalid SES event received; ignoring. Check the event types enabled on your ` +
          `SES configuration set event destination.`
      )
      return null
    }
    if (args.notificationId) {
      const existing = await ctx.db
        .query("deliveryEvents")
        .withIndex("by_notificationId", (q) =>
          q.eq("notificationId", args.notificationId)
        )
        .first()
      if (existing) return null
    }
    const event = result.data
    const sesMessageId = event.mail.messageId

    let email = await ctx.db
      .query("emails")
      .withIndex("by_sesMessageId", (q) => q.eq("sesMessageId", sesMessageId))
      .unique()
    // A signed event may arrive before SendEmail returns (or after a lost
    // response). Our reserved tag lets it establish the acceptance record.
    if (!email) {
      const taggedId = event.mail.tags?.[SES_EMAIL_ID_TAG]?.[0]
      const id = taggedId ? ctx.db.normalizeId("emails", taggedId) : null
      const candidate = id ? await ctx.db.get("emails", id) : null
      if (
        candidate?.status === "queued" &&
        candidate.sendStarted &&
        !candidate.sesMessageId
      ) {
        await ctx.db.patch("emails", candidate._id, {
          status: "sent",
          sesMessageId,
          options: undefined,
        })
        email = {
          ...candidate,
          status: "sent",
          sesMessageId,
          options: undefined,
        }
      }
    }
    if (!email) {
      console.info(
        `Email not found for SES messageId ${sesMessageId}; requesting SNS retry`
      )
      return false
    }

    if (ACCEPTED_EVENT_TYPES.includes(event.eventType)) {
      await ctx.db.insert("deliveryEvents", {
        emailId: email._id,
        notificationId: args.notificationId,
        sesMessageId,
        eventType: event.eventType,
        createdAt: eventTimestamp(event),
        message: describeEvent(event),
      })
    }

    const updated = computeEmailUpdateFromEvent(email, event)
    if (updated) await ctx.db.replace("emails", email._id, updated)

    await enqueueCallbackIfExists(ctx, email, event)
    return null
  },
})

function eventTimestamp(event: EmailEvent): string {
  switch (event.eventType) {
    case "Bounce":
      return event.bounce.timestamp
    case "Complaint":
      return event.complaint.timestamp
    case "Delivery":
      return event.delivery.timestamp
    case "Open":
      return event.open.timestamp
    case "Click":
      return event.click.timestamp
    case "DeliveryDelay":
      return event.deliveryDelay.timestamp
    case "Subscription":
      return event.subscription.timestamp
    case "Send":
    case "Reject":
    case "Rendering Failure":
      return event.mail.timestamp
    default:
      return assertExhaustive(event)
  }
}

type OnEmailEventHandle = FunctionHandle<
  "mutation",
  { id: Id<"emails">; event: EmailEvent },
  void
>

async function enqueueCallbackIfExists(
  ctx: MutationCtx,
  email: Doc<"emails">,
  event: EmailEvent
) {
  const fnHandle = email.onEmailEvent?.fnHandle
  if (!fnHandle) return
  await callbackPool.enqueueMutation(ctx, fnHandle as OnEmailEventHandle, {
    id: email._id,
    event,
  })
}

/* ------------------------------------------------------------------------ */
/* Retention                                                                 */
/* ------------------------------------------------------------------------ */

async function cleanupEmail(ctx: MutationCtx, email: Doc<"emails">) {
  const events = await ctx.db
    .query("deliveryEvents")
    .withIndex("by_emailId_eventType", (q) => q.eq("emailId", email._id))
    .take(100)
  for (const event of events) {
    await ctx.db.delete("deliveryEvents", event._id)
  }
  if (events.length === 100) return false
  await ctx.db.delete("emails", email._id)
  if (email.text) await ctx.db.delete("content", email.text)
  if (email.html) await ctx.db.delete("content", email.html)
  return true
}

function assertRetention(ms: number) {
  if (!Number.isFinite(ms) || ms < 0)
    throw new Error("olderThan must be a finite nonnegative duration")
}

/** Delete finalized (delivered, bounced, failed, cancelled) emails older than `olderThan` ms. */
export const cleanupOldEmails = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? FINALIZED_EMAIL_RETENTION_MS
    assertRetention(olderThan)
    const oldAndDone = await ctx.db
      .query("emails")
      .withIndex("by_finalizedAt", (q) =>
        q.lt("finalizedAt", Date.now() - olderThan)
      )
      .take(CLEANUP_BATCH_SIZE)
    let partial = false
    for (const email of oldAndDone)
      if (!(await cleanupEmail(ctx, email))) partial = true
    if (oldAndDone.length > 0) {
      console.log(`Cleaned up ${oldAndDone.length} finalized emails`)
    }
    if (partial || oldAndDone.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupOldEmails, { olderThan })
    }
    return null
  },
})

/**
 * Delete emails older than `olderThan` ms regardless of status. Emails that
 * never finalized usually indicate a bug or a missing event webhook.
 */
export const cleanupAbandonedEmails = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? ABANDONED_EMAIL_RETENTION_MS
    assertRetention(olderThan)
    const abandoned = await ctx.db
      .query("emails")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - olderThan)
      )
      .take(ABANDONED_CLEANUP_BATCH_SIZE)
    let partial = false
    for (const email of abandoned)
      if (!(await cleanupEmail(ctx, email))) partial = true
    if (abandoned.length > 0) {
      console.log(`Cleaned up ${abandoned.length} abandoned emails`)
    }
    if (partial || abandoned.length === ABANDONED_CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupAbandonedEmails, {
        olderThan,
      })
    }
    return null
  },
})
