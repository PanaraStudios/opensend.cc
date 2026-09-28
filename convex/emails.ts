import { countValue, counters, deleteRow } from "./counts"
import { matchesSearch, narrow, teamPage } from "./lists"
import { EMAIL_STATUSES } from "./tables/emails"
import { v, ConvexError, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server"
import { Workpool, vOnCompleteArgs } from "@convex-dev/workpool"
import { RateLimiter, SECOND } from "@convex-dev/rate-limiter"
import { toPlainText } from "@react-email/render"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import schema from "./schema"
import { findRegion, requireTeam } from "./access"
import { apiError } from "./api/caller"
import { emitEvent } from "./events"
import {
  deleteEmailContent,
  insertEmail,
  insertEmailEvent,
  patchEmail,
  recordEmailStatus,
} from "./emailRows"
import { suppressedAmong } from "./suppressions"
import { publishedTemplate, renderTemplate } from "./templates"
import {
  attachmentValue,
  emailSourceValue,
  emailStatusValue,
  headerValue,
  tagValue,
} from "./tables/emails"
import { regionValue } from "./ses/contracts"
import {
  TAG_PATTERN,
  addressKey,
  attachmentNameError,
  headerError,
  parseMailbox,
  searchWords,
  senderDomainOf,
  templateVariableError,
} from "../lib/dashboard/email-send"

/** The scope of account email (verification, resets, invitations): no team
    has this id, so no team's list, search or export ever reads it. */
export const SYSTEM_SCOPE = "installation"
/** Resend's limits: 50 recipients, and scheduling up to 30 days ahead. */
export const MAX_RECIPIENTS = 50
export const MAX_SCHEDULE = 30 * 86_400_000
/** Body and headers are stored in one document, under Convex's 1 MiB. */
const CONTENT_LIMIT = 900_000
const RETENTION = 30 * 86_400_000
const MAX_TAGS = 48
const MAX_HEADERS = 50
/** Waits before each retry of a send SES throttled or that failed in
    transit. Permanent rejections are never retried. */
const RETRY_DELAYS = [30, 120, 600, 1800, 7200].map((s) => s * 1000)
const OUR_TAGS = ["opensend_email", "opensend_team"]

const pool = new Workpool(components.sendPool, { maxParallelism: 10 })
const limiter = new RateLimiter(components.rateLimiter)

/* ---------------------------------------------------------------- input */

export const newEmailValue = v.object({
  from: v.optional(v.string()),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  bcc: v.array(v.string()),
  replyTo: v.array(v.string()),
  subject: v.optional(v.string()),
  html: v.optional(v.string()),
  text: v.optional(v.string()),
  headers: v.array(headerValue),
  attachments: v.array(attachmentValue),
  tags: v.array(tagValue),
  scheduledAt: v.optional(v.number()),
  template: v.optional(
    v.object({
      id: v.string(),
      variables: v.array(
        v.object({ key: v.string(), value: v.union(v.string(), v.number()) })
      ),
    })
  ),
})
export type NewEmail = Infer<typeof newEmailValue>

const invalid = (message: string) => apiError(422, "validation_error", message)
const missing = (field: string) =>
  apiError(422, "missing_required_field", `Missing \`${field}\` field.`)
const bytes = (value: string | undefined) =>
  value ? new TextEncoder().encode(value).length : 0
/** The message of a thrown error, plain or Resend-shaped. */
export function errorMessage(error: unknown) {
  if (!(error instanceof ConvexError)) return null
  const data: unknown = error.data
  if (typeof data === "string") return data
  return data &&
    typeof data === "object" &&
    "message" in data &&
    typeof data.message === "string"
    ? data.message
    : null
}

function mailboxes(field: string, values: string[]) {
  return values.map((value) => {
    const mailbox = parseMailbox(value)
    if (!mailbox)
      throw invalid(
        `Invalid \`${field}\` field. The email address needs to follow the \`email@example.com\` or \`Name <email@example.com>\` format.`
      )
    return { value: value.trim(), key: addressKey(mailbox), mailbox }
  })
}

/** The team's domain a sender address belongs to, ready to send if any. */
async function sendingDomain(
  ctx: MutationCtx,
  organizationId: string,
  name: string
) {
  const rows = await ctx.db
    .query("domains")
    .withIndex("by_organizationId_and_deleted_and_name", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("deleted", false)
        .eq("name", name)
    )
    .take(10)
  const domain =
    rows.find((row) => row.status === "verified" && row.sending) ?? rows[0]
  if (!domain)
    throw apiError(
      403,
      "validation_error",
      `The \`${name}\` domain is not verified. Please, add and verify your domain.`
    )
  return domain
}

/** The send binding, or its refusal (unverified domain, paused tenant,
    outdated IAM policy…) as a Resend 403. */
async function bindingFor(
  ctx: QueryCtx,
  domain: Doc<"domains">
): Promise<SendBinding> {
  try {
    return await ctx.runQuery(internal.ses.sendContext.get, {
      organizationId: domain.organizationId,
      domainId: domain._id,
    })
  } catch (e) {
    if (e instanceof ConvexError && typeof e.data === "string")
      throw apiError(403, "validation_error", e.data)
    throw e
  }
}

/**
 * Validates and records one email, then queues it (or schedules it).
 * Every send path comes through here. Errors are Resend's: a REST route
 * returns them as they are.
 */
export async function createEmail(
  ctx: MutationCtx,
  input: NewEmail,
  meta: {
    organizationId: string
    source: Infer<typeof emailSourceValue>
    apiKeyId?: Id<"apiKeys">
    /** A sending key limited to one domain. */
    onlyDomain?: Id<"domains">
    /** Account email: sent from this domain, whichever team owns it. */
    systemDomain?: Id<"domains">
  }
) {
  let { from, subject, html, text } = input
  let replyTo = input.replyTo
  let templateId: string | undefined
  if (input.template) {
    if (html !== undefined || text !== undefined)
      throw invalid("Send either a `template` or `html`/`text`, not both.")
    const template = await publishedTemplate(
      ctx,
      meta.organizationId,
      input.template.id
    )
    if (!template)
      throw apiError(404, "not_found", "Template not found or not published")
    const values: Record<string, string | number> = {}
    for (const { key, value } of input.template.variables) {
      const problem = templateVariableError(key, value)
      if (problem) throw invalid(problem)
      values[key] = value
    }
    let rendered
    try {
      rendered = renderTemplate(template, values)
    } catch (e) {
      const message = errorMessage(e)
      if (message) throw invalid(message)
      throw e
    }
    templateId = template.id
    html = rendered.html
    text = rendered.text
    from ??= template.from
    subject ??= rendered.subject
    if (!replyTo.length && template.replyTo) replyTo = [template.replyTo]
  }
  if (!from) throw missing("from")
  if (!subject?.trim()) throw missing("subject")
  if (!input.to.length) throw missing("to")
  if (!html && !text) throw invalid("Missing `html` or `text` field.")
  const [sender] = mailboxes("from", [from])
  const to = mailboxes("to", input.to)
  const cc = mailboxes("cc", input.cc)
  const bcc = mailboxes("bcc", input.bcc)
  const reply = mailboxes("reply_to", replyTo)
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS)
    throw invalid(
      `An email can have at most ${MAX_RECIPIENTS} recipients across \`to\`, \`cc\` and \`bcc\`.`
    )
  if (input.tags.length > MAX_TAGS)
    throw invalid(`An email can have at most ${MAX_TAGS} tags.`)
  for (const tag of input.tags) {
    if (!TAG_PATTERN.test(tag.name) || !TAG_PATTERN.test(tag.value))
      throw invalid(
        "Tags should only contain ASCII letters, numbers, underscores, or dashes, and be at most 256 characters."
      )
    if (OUR_TAGS.includes(tag.name))
      throw invalid(`The \`${tag.name}\` tag name is reserved.`)
  }
  if (input.headers.length > MAX_HEADERS)
    throw invalid(`An email can have at most ${MAX_HEADERS} headers.`)
  for (const header of input.headers) {
    const problem = headerError(header.name, header.value)
    if (problem) throw invalid(problem)
  }
  for (const attachment of input.attachments) {
    const problem = attachmentNameError(attachment.filename)
    if (problem) throw apiError(422, "invalid_attachment", problem)
  }
  // Without a plain-text part one is derived, unless it was sent empty.
  if (text === undefined && html) text = toPlainText(html)
  const headerBytes = input.headers.reduce(
    (total, h) => total + bytes(h.name) + bytes(h.value),
    0
  )
  if (bytes(html) + bytes(text) + headerBytes > CONTENT_LIMIT)
    throw invalid("The email body is too large.")

  const now = Date.now()
  let scheduledAt = input.scheduledAt
  if (scheduledAt !== undefined && scheduledAt > now + MAX_SCHEDULE)
    throw invalid("The `scheduled_at` must be within the next 30 days.")
  // A time that has already come sends now.
  if (scheduledAt !== undefined && scheduledAt <= now) scheduledAt = undefined

  const senderDomain = senderDomainOf(sender.mailbox)
  const domain = meta.systemDomain
    ? await ctx.db.get("domains", meta.systemDomain)
    : await sendingDomain(ctx, meta.organizationId, senderDomain)
  if (!domain || domain.deleted || domain.name !== senderDomain)
    throw invalid("The `from` address must be on the sending domain.")
  if (meta.onlyDomain && meta.onlyDomain !== domain._id)
    throw apiError(
      403,
      "validation_error",
      `This API key can only send from its own domain, not \`${domain.name}\`.`
    )
  await bindingFor(ctx, domain)

  const status = scheduledAt === undefined ? "queued" : "scheduled"
  const id = await insertEmail(
    ctx,
    {
      organizationId: meta.organizationId,
      domainId: domain._id,
      from: sender.value,
      to: to.map((m) => m.value),
      ...(cc.length ? { cc: cc.map((m) => m.value) } : {}),
      ...(bcc.length ? { bcc: bcc.map((m) => m.value) } : {}),
      ...(reply.length ? { replyTo: reply.map((m) => m.value) } : {}),
      subject,
      status,
      ...(scheduledAt === undefined ? {} : { scheduledAt }),
      ...(input.tags.length ? { tags: input.tags } : {}),
      ...(templateId ? { templateId } : {}),
      source: meta.source,
      ...(meta.apiKeyId ? { apiKeyId: meta.apiKeyId } : {}),
      generation: 0,
      attempts: 0,
      expiresAt: (scheduledAt ?? now) + RETENTION,
      search: searchWords(...to.map((m) => m.value), sender.value, subject),
    },
    {
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      ...(input.headers.length ? { headers: input.headers } : {}),
      ...(input.attachments.length ? { attachments: input.attachments } : {}),
    },
    [...to, ...cc, ...bcc].map((m) => m.key)
  )
  if (scheduledAt === undefined) await enqueue(ctx, id, 0, 0)
  else {
    await patchEmail(ctx, id, {
      scheduledJob: await ctx.scheduler.runAt(
        scheduledAt,
        internal.emails.release,
        { id, generation: 0 }
      ),
    })
    await emitEmail(ctx, id, "email.scheduled")
  }
  return id
}

/* ------------------------------------------------------------- pipeline */

async function enqueue(
  ctx: MutationCtx,
  id: Id<"emails">,
  generation: number,
  runAfter: number
) {
  await pool.enqueueAction(
    ctx,
    internal.emailSend.deliver,
    { id, generation },
    {
      runAfter,
      onComplete: internal.emails.deliverDone,
      onCompleteExcludeKinds: ["success"],
      context: { id, generation },
    }
  )
}

const iso = (ms: number) => new Date(ms).toISOString()
/** Resend's webhook `data` for an email event. */
export function emailEventData(email: Doc<"emails">) {
  return {
    ...(email.broadcastId ? { broadcast_id: email.broadcastId } : {}),
    created_at: iso(email._creationTime),
    email_id: email._id,
    ...(email.messageId ? { message_id: email.messageId } : {}),
    from: email.from,
    to: email.to,
    subject: email.subject,
    ...(email.templateId ? { template_id: email.templateId } : {}),
    tags: Object.fromEntries(
      (email.tags ?? []).map((tag) => [tag.name, tag.value])
    ),
  }
}
/** Emits a team email's webhook event; account email has none. */
async function emitEmail(
  ctx: MutationCtx,
  id: Id<"emails">,
  type: "email.sent" | "email.scheduled" | "email.failed" | "email.suppressed",
  extra: Record<string, unknown> = {}
) {
  const email = (await ctx.db.get("emails", id))!
  if (email.organizationId === SYSTEM_SCOPE) return
  await emitEvent(ctx, email.organizationId, type, {
    ...emailEventData(email),
    ...extra,
  })
}
/** An email done with the sender. Account email then drops its body,
    which holds a one-time link. */
async function settle(
  ctx: MutationCtx,
  email: Doc<"emails">,
  status: "sent" | "failed" | "suppressed",
  patch: Partial<Doc<"emails">> = {}
) {
  await recordEmailStatus(ctx, email._id, status, {
    ...patch,
    claimed: false,
    expiresAt: Date.now() + RETENTION,
  })
  if (email.organizationId === SYSTEM_SCOPE)
    await deleteEmailContent(ctx, email._id)
}
async function fail(ctx: MutationCtx, email: Doc<"emails">, reason: string) {
  await settle(ctx, email, "failed", { error: reason })
  await emitEmail(ctx, email._id, "email.failed", { failed: { reason } })
}

/** A scheduled email's time has come: it joins the send queue. */
export const release = internalMutation({
  args: { id: v.id("emails"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, generation }) => {
    const email = await ctx.db.get("emails", id)
    if (email?.status !== "scheduled" || email.generation !== generation)
      return null
    await patchEmail(ctx, id, { status: "queued", scheduledJob: undefined })
    await enqueue(ctx, id, generation, 0)
    return null
  },
})

export const tagSafe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_")
type SendBinding = {
  TenantName: string
  ConfigurationSetName: string
  region: Infer<typeof regionValue>
  domain: string
}
const claimResult = v.union(
  v.null(),
  v.object({
    TenantName: v.string(),
    ConfigurationSetName: v.string(),
    region: regionValue,
    from: v.string(),
    to: v.array(v.string()),
    cc: v.array(v.string()),
    bcc: v.array(v.string()),
    replyTo: v.array(v.string()),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    headers: v.array(headerValue),
    attachments: v.array(attachmentValue),
    tags: v.array(tagValue),
  })
)

/**
 * The sender's first step, in one transaction: re-check the email is still
 * queued for this run (a cancel or reschedule moved it on), re-check the
 * send binding, drop suppressed recipients, and take the region's send
 * rate. Only then is the email claimed and handed to SES.
 */
export const claim = internalMutation({
  args: { id: v.id("emails"), generation: v.number() },
  returns: claimResult,
  handler: async (
    ctx,
    { id, generation }
  ): Promise<Infer<typeof claimResult>> => {
    const email = await ctx.db.get("emails", id)
    if (
      email?.status !== "queued" ||
      email.generation !== generation ||
      email.claimed
    )
      return null
    const domain = await ctx.db.get("domains", email.domainId)
    const system = email.organizationId === SYSTEM_SCOPE
    if (
      !domain ||
      domain.deleted ||
      (!system && domain.organizationId !== email.organizationId)
    ) {
      await fail(ctx, email, "The sending domain was removed")
      return null
    }
    let binding
    try {
      binding = await bindingFor(ctx, domain)
    } catch (e) {
      await fail(ctx, email, errorMessage(e) ?? "The email could not be sent")
      return null
    }
    /* A team's suppressions guard its own sends; account email (a password
       reset) is not the team's mail to withhold. */
    const all = [...email.to, ...(email.cc ?? []), ...(email.bcc ?? [])]
    const key = (value: string) => addressKey(parseMailbox(value)!)
    const dropped = system
      ? new Set<string>()
      : await suppressedAmong(ctx, email.organizationId, all.map(key))
    const keep = (values: string[] = []) =>
      values.filter((value) => !dropped.has(key(value)))
    const to = keep(email.to)
    const cc = keep(email.cc)
    const bcc = keep(email.bcc)
    const count = to.length + cc.length + bcc.length
    if (!count) {
      await settle(ctx, email, "suppressed", { suppressed: [...dropped] })
      await emitEmail(ctx, id, "email.suppressed", {
        suppressed: {
          message:
            "Opensend has suppressed sending to this address because it is on the team's suppression list.",
          type: "OnTeamSuppressionList",
        },
      })
      return null
    }
    // Reserve the full recipient cost, even when it spans several seconds.
    // A queued generation keeps its reservation and never charges twice.
    let readyAt = email.rateReadyAt
    if (readyAt === undefined) {
      const region = await findRegion(ctx, binding.region)
      const rate = Math.max(1, region?.quota.rate ?? 1)
      const limit = await limiter.limit(ctx, "sesSend", {
        key: binding.region,
        count,
        reserve: true,
        config: { kind: "token bucket", rate, period: SECOND, capacity: rate },
      })
      readyAt = Date.now() + Math.ceil(limit.retryAfter ?? 0)
    }
    if (readyAt > Date.now()) {
      await patchEmail(ctx, id, {
        generation: generation + 1,
        rateReadyAt: readyAt,
      })
      await enqueue(ctx, id, generation + 1, readyAt - Date.now())
      return null
    }
    await patchEmail(ctx, id, {
      claimed: true,
      rateReadyAt: undefined,
      attempts: email.attempts + 1,
      ...(dropped.size ? { suppressed: [...dropped] } : {}),
    })
    const content = await ctx.db
      .query("emailContents")
      .withIndex("by_emailId", (q) => q.eq("emailId", id))
      .unique()
    return {
      TenantName: binding.TenantName,
      ConfigurationSetName: binding.ConfigurationSetName,
      region: binding.region,
      from: email.from,
      to,
      cc,
      bcc,
      replyTo: email.replyTo ?? [],
      subject: email.subject,
      html: content?.html,
      text: content?.text,
      headers: content?.headers ?? [],
      attachments: content?.attachments ?? [],
      // How SES events find their email and team, within SES's tag rules.
      tags: [
        ...(email.tags ?? []),
        { name: "opensend_email", value: tagSafe(id) },
        { name: "opensend_team", value: tagSafe(domain.organizationId) },
      ],
    }
  },
})

const outcomeValue = v.union(
  v.object({ kind: v.literal("sent"), messageId: v.string() }),
  v.object({
    kind: v.literal("failed"),
    error: v.string(),
    retryable: v.boolean(),
  })
)
/** SNS can arrive before the SendEmail response. Acceptance is recorded once,
    without overwriting a delivery/bounce already projected from that send. */
export async function acceptEmail(
  ctx: MutationCtx,
  email: Doc<"emails">,
  messageId: string,
  at: number
) {
  if (email.sentAt !== undefined) return
  await patchEmail(ctx, email._id, {
    messageId,
    sentAt: at,
    claimed: false,
    expiresAt: Date.now() + RETENTION,
    ...(["queued", "scheduled"].includes(email.status)
      ? { status: "sent" as const }
      : {}),
  })
  await insertEmailEvent(ctx, email._id, "sent", at)
  await emitEmail(ctx, email._id, "email.sent")
  if (email.organizationId === SYSTEM_SCOPE)
    await deleteEmailContent(ctx, email._id)
}

/** Settles one run: sent, retried later, or failed for good. */
async function recordOutcome(
  ctx: MutationCtx,
  args: {
    id: Id<"emails">
    generation: number
    outcome: Infer<typeof outcomeValue>
  }
) {
  const email = await ctx.db.get("emails", args.id)
  if (!email || email.generation !== args.generation) return
  if (email.status !== "queued" && email.sentAt === undefined) return
  const { outcome } = args
  if (outcome.kind === "sent") {
    await acceptEmail(ctx, email, outcome.messageId, Date.now())
  } else if (email.sentAt !== undefined) return
  else if (outcome.retryable && email.attempts <= RETRY_DELAYS.length) {
    const next = args.generation + 1
    await patchEmail(ctx, email._id, { generation: next, claimed: false })
    await enqueue(ctx, email._id, next, RETRY_DELAYS[email.attempts - 1] ?? 0)
  } else await fail(ctx, email, outcome.error)
}

export const record = internalMutation({
  args: {
    id: v.id("emails"),
    generation: v.number(),
    outcome: outcomeValue,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordOutcome(ctx, args)
    return null
  },
})

/** A crashed run may already have reached SES. Do not resend an ambiguous
    delivery: SES SendEmail has no idempotency token. */
export const deliverDone = internalMutation({
  args: vOnCompleteArgs(
    v.object({ id: v.id("emails"), generation: v.number() })
  ),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") return null
    const email = await ctx.db.get("emails", context.id)
    // A run that failed before its claim still uses up an attempt.
    if (
      email?.status === "queued" &&
      email.generation === context.generation &&
      !email.claimed
    )
      await patchEmail(ctx, email._id, { attempts: email.attempts + 1 })
    await recordOutcome(ctx, {
      ...context,
      outcome: {
        kind: "failed",
        error:
          result.kind === "failed"
            ? "The send was interrupted"
            : "The send was canceled",
        retryable: false,
      },
    })
    return null
  },
})

/* ------------------------------------------------ cancel and reschedule */

/** Only a scheduled email can change: once released, it is being sent. */
function requireScheduled(email: Doc<"emails">, action: string) {
  if (email.status !== "scheduled")
    throw invalid(`Only scheduled emails can be ${action}.`)
}
async function dropJob(ctx: MutationCtx, email: Doc<"emails">) {
  if (email.scheduledJob) await ctx.scheduler.cancel(email.scheduledJob)
}

export async function cancelEmail(ctx: MutationCtx, email: Doc<"emails">) {
  requireScheduled(email, "canceled")
  await dropJob(ctx, email)
  await recordEmailStatus(ctx, email._id, "canceled", {
    generation: email.generation + 1,
    expiresAt: Date.now() + RETENTION,
    scheduledJob: undefined,
  })
}

export async function rescheduleEmail(
  ctx: MutationCtx,
  email: Doc<"emails">,
  at: number
) {
  requireScheduled(email, "updated")
  const now = Date.now()
  if (at <= now || at > now + MAX_SCHEDULE)
    throw invalid("The `scheduled_at` must be within the next 30 days.")
  await dropJob(ctx, email)
  const generation = email.generation + 1
  await recordEmailStatus(ctx, email._id, "scheduled", {
    generation,
    scheduledAt: at,
    expiresAt: at + RETENTION,
    scheduledJob: await ctx.scheduler.runAt(at, internal.emails.release, {
      id: email._id,
      generation,
    }),
  })
}

/* ------------------------------------------------------------ dashboard */

export const emailFilters = v.object({
  status: v.optional(emailStatusValue),
  search: v.optional(v.string()),
  from: v.optional(v.number()),
  to: v.optional(v.number()),
})

/** Newest first. A search ranks by relevance and drops rows outside the
    date range from each page, so a page may come back short. */
export async function emailPage(
  ctx: QueryCtx,
  args: Infer<typeof emailFilters> & {
    organizationId: string
    paginationOpts: PaginationOptions
  }
) {
  const org = args.organizationId
  const from = args.from ?? 0
  const to = args.to ?? Number.MAX_SAFE_INTEGER
  const search = args.search?.trim().slice(0, 200)
  if (
    !search &&
    args.status === undefined &&
    args.from === undefined &&
    args.to === undefined
  )
    return teamPage(ctx, "emails", org, args.paginationOpts, () => true)
  const rows = ctx.db.query("emails")
  const result = search
    ? await rows
        .withSearchIndex("search_search", (q) => {
          const scoped = q.search("search", search).eq("organizationId", org)
          return args.status ? scoped.eq("status", args.status) : scoped
        })
        .paginate(args.paginationOpts)
    : await (
        args.status
          ? rows.withIndex("by_organizationId_and_status", (q) =>
              q
                .eq("organizationId", org)
                .eq("status", args.status!)
                .gte("_creationTime", from)
                .lte("_creationTime", to)
            )
          : rows.withIndex("by_organizationId", (q) =>
              q
                .eq("organizationId", org)
                .gte("_creationTime", from)
                .lte("_creationTime", to)
            )
      )
        .order("desc")
        .paginate(args.paginationOpts)
  return narrow(
    result,
    (row) =>
      row._creationTime >= from &&
      row._creationTime <= to &&
      matchesSearch(search)(row.from, ...row.to, row.subject)
  )
}

export const count = query({
  args: { organizationId: v.string(), ...emailFilters.fields },
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return {
      total: args.search?.trim()
        ? null
        : await counters.emails.total(
            ctx,
            args.organizationId,
            [{ is: args.status, among: EMAIL_STATUSES }],
            args
          ),
    }
  },
})

export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    ...emailFilters.fields,
  },
  returns: paginationResultValidator(schema.doc("emails")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return emailPage(ctx, args)
  },
})

/** A contact's sends: every email that had the address as a recipient. */
export const byRecipient = query({
  args: {
    organizationId: v.string(),
    address: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("emails")),
  handler: async (ctx, { organizationId, address, paginationOpts }) => {
    await requireTeam(ctx, organizationId)
    const result = await ctx.db
      .query("emailRecipients")
      .withIndex("by_organizationId_and_address", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("address", address.trim().toLowerCase())
      )
      .order("desc")
      .paginate(paginationOpts)
    const page = []
    for (const row of result.page) {
      const email = await ctx.db.get("emails", row.emailId)
      if (email) page.push(email)
    }
    return { ...result, page }
  },
})

export const byRecipientCount = query({
  args: { organizationId: v.string(), address: v.string() },
  returns: countValue,
  handler: async (ctx, { organizationId, address }) => {
    await requireTeam(ctx, organizationId)
    return {
      total: await counters.emailRecipients.total(
        ctx,
        JSON.stringify([organizationId, address.trim().toLowerCase()])
      ),
    }
  },
})

async function readableEmail(ctx: QueryCtx, id: Id<"emails">) {
  const email = await ctx.db.get("emails", id)
  if (!email || email.source === "system")
    throw new ConvexError("Email not found")
  await requireTeam(ctx, email.organizationId)
  return email
}

export const timeline = query({
  args: {
    id: v.id("emails"),
    insights: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("emailEvents")),
  handler: async (ctx, { id, insights, paginationOpts }) => {
    await readableEmail(ctx, id)
    const page = await ctx.db
      .query("emailEvents")
      .withIndex("by_emailId_and_at", (q) => q.eq("emailId", id))
      .paginate(paginationOpts)
    return narrow(
      page,
      (event) =>
        !insights || event.type === "opened" || event.type === "clicked"
    )
  },
})

export const timelineCount = query({
  args: { id: v.id("emails"), insights: v.optional(v.boolean()) },
  returns: countValue,
  handler: async (ctx, { id, insights }) => {
    await readableEmail(ctx, id)
    const total = insights
      ? (await counters.emailEvents.total(ctx, id, [
          { is: "opened", among: EMAIL_STATUSES },
        ]))! +
        (await counters.emailEvents.total(ctx, id, [
          { is: "clicked", among: EMAIL_STATUSES },
        ]))!
      : await counters.emailEvents.total(ctx, id)
    return { total }
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      email: schema.doc("emails"),
      html: v.string(),
      text: v.string(),
      /** The REST request that sent it. */
      log: v.union(
        v.null(),
        schema.doc("apiLogs").pick("_id", "_creationTime")
      ),
    })
  ),
  handler: async (ctx, { id }) => {
    const emailId = ctx.db.normalizeId("emails", id)
    const email = emailId ? await ctx.db.get("emails", emailId) : null
    if (!email || email.organizationId === SYSTEM_SCOPE) return null
    await requireTeam(ctx, email.organizationId)
    const content = await ctx.db
      .query("emailContents")
      .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
      .unique()
    const log = email.apiLogId
      ? await ctx.db.get("apiLogs", email.apiLogId)
      : null
    return {
      email,
      html: content?.html ?? "",
      text: content?.text ?? "",
      log: log ? { _id: log._id, _creationTime: log._creationTime } : null,
    }
  },
})

export const cancel = mutation({
  args: { id: v.id("emails") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const email = await ctx.db.get("emails", id)
    if (!email || email.organizationId === SYSTEM_SCOPE)
      throw new ConvexError("Email not found")
    await requireTeam(ctx, email.organizationId, "write")
    try {
      await cancelEmail(ctx, email)
    } catch (e) {
      // The dashboard shows a plain message, not the REST error object.
      const message = errorMessage(e)
      if (message) throw new ConvexError(message)
      throw e
    }
    return null
  },
})

/** One expired email at a time, with bounded child cleanup. Pending sends
    have their deadline extended so retention never removes active work. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const email = await ctx.db
      .query("emails")
      .withIndex("by_expiresAt", (q) =>
        q.gt("expiresAt", 0).lte("expiresAt", Date.now())
      )
      .first()
    if (!email) return null
    if (email.status === "scheduled" || email.status === "queued") {
      await patchEmail(ctx, email._id, { expiresAt: Date.now() + RETENTION })
    } else {
      const events = await ctx.db
        .query("emailEvents")
        .withIndex("by_emailId_and_at", (q) => q.eq("emailId", email._id))
        .take(50)
      for (const event of events) await deleteRow(ctx, "emailEvents", event._id)
      if (events.length < 50) {
        const recipients = await ctx.db
          .query("emailRecipients")
          .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
          .take(MAX_RECIPIENTS)
        for (const recipient of recipients)
          await deleteRow(ctx, "emailRecipients", recipient._id)
        const metrics = await ctx.db
          .query("emailMetrics")
          .withIndex("by_emailId_and_type", (q) => q.eq("emailId", email._id))
          .take(20)
        for (const metric of metrics)
          await deleteRow(ctx, "emailMetrics", metric._id)
        const recipientMetrics = await ctx.db
          .query("recipientMetrics")
          .withIndex("by_emailId_and_type_and_address", (q) =>
            q.eq("emailId", email._id)
          )
          .take(MAX_RECIPIENTS * 3)
        for (const metric of recipientMetrics)
          await deleteRow(ctx, "recipientMetrics", metric._id)
        await deleteEmailContent(ctx, email._id)
        await deleteRow(ctx, "emails", email._id)
      }
    }
    await ctx.scheduler.runAfter(0, internal.emails.prune, {})
    return null
  },
})
