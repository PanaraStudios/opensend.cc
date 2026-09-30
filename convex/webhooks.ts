import { stream } from "convex-helpers/server/stream"
import { retirement } from "./teamLifecycle"
import { v, ConvexError } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { Workpool, vOnCompleteArgs } from "@convex-dev/workpool"
import { action, internalMutation, mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import schema from "./schema"
import { requireTeam } from "./access"
import { decryptSecret, encryptSecret } from "./secrets"
import {
  BOOLEANS,
  countValue,
  counters,
  deleteRow,
  insertRow,
  patchRow,
} from "./counts"
import { matchesSearch, teamPage, readTeamRow, hasTeamRows } from "./lists"
import { createWebhookSecret } from "../lib/dashboard/ids"
import {
  isDeliveryFailed,
  sortWebhookEvents,
  webhookFormError,
} from "../lib/dashboard/webhooks"
import { WEBHOOK_EVENTS, type WebhookEvent } from "../lib/dashboard/types"

const pool = new Workpool(components.webhookPool, { maxParallelism: 10 })

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Svix's retry schedule: the wait before each automatic attempt, the
    first included. https://docs.svix.com/retries */
const RETRY_DELAYS = [0, 5, 300, 1800, 7200, 18000, 36000, 36000].map(
  (seconds) => seconds * 1000
)
/** Svix disables an endpoint once its attempts have failed for five days. */
const DISABLE_AFTER = 5 * DAY
/** Svix's default payload retention; also applied to the event outbox. */
const RETENTION = 90 * DAY
/** Bounds every read of a team's webhooks. */
const WEBHOOK_LIMIT = 100
const BATCH = 200
const cleanupPage = {
  cursor: null,
  numItems: BATCH,
  maximumBytesRead: 2 * 1024 * 1024,
}

const deliveryId = v.id("webhookDeliveries")
const webhookValue = schema
  .doc("webhooks")
  .pick(
    "_id",
    "_creationTime",
    "organizationId",
    "endpoint",
    "events",
    "enabled"
  )
/** A webhook without its secrets, which only `signingSecret` reveals. */
const shown = ({
  _id,
  _creationTime,
  organizationId,
  endpoint,
  events,
  enabled,
}: Doc<"webhooks">) => ({
  _id,
  _creationTime,
  organizationId,
  endpoint,
  events,
  enabled,
})

function validated(endpoint: string, events: string[]) {
  const error = webhookFormError(endpoint, events as WebhookEvent[])
  if (error) throw new ConvexError(error.endpoint ?? error.events!)
  return {
    endpoint: endpoint.trim(),
    events: sortWebhookEvents(events as WebhookEvent[]),
  }
}

/** A webhook the caller's team may change, or throw. */
async function writableWebhook(ctx: MutationCtx, id: Id<"webhooks">) {
  const webhook = await ctx.db.get("webhooks", id)
  if (!webhook) throw new ConvexError("Webhook not found")
  await requireTeam(ctx, webhook.organizationId, "write")
  return webhook
}

/** A webhook named by a route parameter, or null if there is none. */
async function readWebhook(ctx: QueryCtx, id: string) {
  return readTeamRow(ctx, "webhooks", id)
}

/** Rewrites the webhook's subscription rows to match its events and state. */
async function subscribe(
  ctx: MutationCtx,
  webhook: Pick<Doc<"webhooks">, "_id" | "organizationId" | "enabled">,
  events: readonly string[]
) {
  const rows = await ctx.db
    .query("webhookSubscriptions")
    .withIndex("by_webhookId", (q) => q.eq("webhookId", webhook._id))
    .take(WEBHOOK_EVENTS.length)
  for (const row of rows) await ctx.db.delete("webhookSubscriptions", row._id)
  for (const event of events)
    await ctx.db.insert("webhookSubscriptions", {
      organizationId: webhook.organizationId,
      event,
      enabled: webhook.enabled,
      webhookId: webhook._id,
    })
}

async function enqueueAttempt(
  ctx: MutationCtx,
  id: Id<"webhookDeliveries">,
  attempt: number
) {
  await pool.enqueueAction(
    ctx,
    internal.webhookDelivery.attempt,
    { id, attempt },
    {
      runAfter: RETRY_DELAYS[attempt],
      onComplete: internal.webhooks.attemptDone,
      onCompleteExcludeKinds: ["success"],
      context: { id, attempt },
    }
  )
}

/** Records a message for one endpoint and queues its first attempt. */
async function send(
  ctx: MutationCtx,
  message: Pick<
    Doc<"webhookDeliveries">,
    | "organizationId"
    | "webhookId"
    | "messageId"
    | "event"
    | "payload"
    | "replay"
    | "originalDeliveryId"
  >
) {
  const id = await insertRow(ctx, "webhookDeliveries", {
    ...message,
    status: 0,
    failed: true,
    attempts: 0,
    durationMs: 0,
    response: "",
    nextAttemptAt: Date.now(),
  })
  await enqueueAttempt(ctx, id, 0)
  return id
}

const webhookFilters = {
  organizationId: v.string(),
  /** Part of the endpoint or of an event name, as typed. */
  search: v.optional(v.string()),
  enabled: v.optional(v.boolean()),
}

// 512 endpoint rows, no hydration; large event arrays count toward 4 MiB.
export const WEBHOOK_SEARCH_BUDGET = { rows: 512, bytes: 4 * 1024 * 1024 }

/** The team's webhooks, newest first, a page at a time. */
export const list = query({
  args: { ...webhookFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(webhookValue),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const matches = matchesSearch(args.search)
    const result = await teamPage(
      ctx,
      "webhooks",
      args.organizationId,
      args.paginationOpts,
      (webhook) =>
        (args.enabled === undefined || webhook.enabled === args.enabled) &&
        matches(webhook.endpoint, ...webhook.events),
      WEBHOOK_SEARCH_BUDGET,
      args.search
    )
    return { ...result, page: result.page.map(shown) }
  },
})

export const count = query({
  args: webhookFilters,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    if (args.search?.trim()) return { total: null }
    return {
      total: await counters.webhooks.total(ctx, args.organizationId, [
        { is: args.enabled, among: BOOLEANS },
      ]),
    }
  },
})

/** Whether the team has any webhook at all, whatever the list's filters:
    the list says "No webhooks yet" only when it has none. */
export const hasAny = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: (ctx, { organizationId }) =>
    hasTeamRows(ctx, "webhooks", organizationId),
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      webhook: webhookValue,
      deliveries: v.number(),
      failed: v.number(),
      lastDeliveryAt: v.union(v.null(), v.number()),
      /** The event types delivered so far, whatever it listens for now. */
      delivered: v.array(v.string()),
    })
  ),
  handler: async (ctx, { id }) => {
    const webhook = await readWebhook(ctx, id)
    if (!webhook) return null
    const [deliveries, failed] = await Promise.all([
      counters.webhookDeliveries.total(ctx, webhook._id),
      counters.webhookDeliveries.total(ctx, webhook._id, [
        { is: true, among: BOOLEANS },
      ]),
    ])
    const last = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_webhookId", (q) => q.eq("webhookId", webhook._id))
      .order("desc")
      .first()
    const delivered: string[] = []
    for (const event of WEBHOOK_EVENTS)
      if (
        await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_webhookId_and_event", (q) =>
            q.eq("webhookId", webhook._id).eq("event", event)
          )
          .first()
      )
        delivered.push(event)
    return {
      webhook: shown(webhook),
      deliveries: deliveries ?? 0,
      failed: failed ?? 0,
      lastDeliveryAt: last?._creationTime ?? null,
      delivered,
    }
  },
})

/** The secret itself, for the webhook page's reveal and copy. */
export const signingSecret = query({
  args: { id: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { id }) => {
    const webhook = await readWebhook(ctx, id)
    return webhook ? await decryptSecret(webhook.secret) : null
  },
})

const deliveryFilters = {
  webhookId: v.id("webhooks"),
  failed: v.optional(v.boolean()),
  event: v.optional(v.string()),
}

export const deliveryCount = query({
  args: deliveryFilters,
  returns: countValue,
  handler: async (ctx, { webhookId, failed, event }) => {
    const webhook = await ctx.db.get("webhooks", webhookId)
    if (!webhook) return { total: 0 }
    await requireTeam(ctx, webhook.organizationId)
    return {
      total: await counters.webhookDeliveries.total(ctx, webhookId, [
        { is: failed, among: BOOLEANS },
        { is: event, among: WEBHOOK_EVENTS },
      ]),
    }
  },
})

export const deliveries = query({
  args: { ...deliveryFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("webhookDeliveries")),
  handler: async (ctx, args) => {
    const webhook = await ctx.db.get("webhooks", args.webhookId)
    // Deleted: its history goes with it, and the page is on its way out.
    if (!webhook) return { page: [], isDone: true, continueCursor: "" }
    await requireTeam(ctx, webhook.organizationId)
    const rows = ctx.db.query("webhookDeliveries")
    const { failed, event } = args
    const scoped =
      event !== undefined && failed !== undefined
        ? rows.withIndex("by_webhookId_and_event_and_failed", (q) =>
            q
              .eq("webhookId", webhook._id)
              .eq("event", event)
              .eq("failed", failed)
          )
        : event !== undefined
          ? rows.withIndex("by_webhookId_and_event", (q) =>
              q.eq("webhookId", webhook._id).eq("event", event)
            )
          : failed !== undefined
            ? rows.withIndex("by_webhookId_and_failed", (q) =>
                q.eq("webhookId", webhook._id).eq("failed", failed)
              )
            : rows.withIndex("by_webhookId", (q) =>
                q.eq("webhookId", webhook._id)
              )
    return scoped.order("desc").paginate(args.paginationOpts)
  },
})

export const delivery = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      delivery: schema.doc("webhookDeliveries"),
      webhook: webhookValue,
    })
  ),
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("webhookDeliveries", id)
    const delivery = normalized
      ? await ctx.db.get("webhookDeliveries", normalized)
      : null
    const webhook = delivery
      ? await ctx.db.get("webhooks", delivery.webhookId)
      : null
    if (!delivery || !webhook) return null
    await requireTeam(ctx, webhook.organizationId)
    return { delivery, webhook: shown(webhook) }
  },
})

/* Secrets are generated here rather than in a mutation, whose random
   source is seeded for determinism; a secret needs a CSPRNG. */
export const create = action({
  args: {
    organizationId: v.string(),
    endpoint: v.string(),
    events: v.array(v.string()),
  },
  returns: v.id("webhooks"),
  handler: async (ctx, args): Promise<Id<"webhooks">> =>
    ctx.runMutation(internal.webhooks.insert, {
      ...args,
      secret: await encryptSecret(createWebhookSecret()),
    }),
})

export async function insertWebhook(
  ctx: MutationCtx,
  args: {
    organizationId: string
    endpoint: string
    events: string[]
    secret: string
  }
) {
  const { endpoint, events } = validated(args.endpoint, args.events)
  const existing = await ctx.db
    .query("webhooks")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", args.organizationId)
    )
    .take(WEBHOOK_LIMIT)
  if (existing.length >= WEBHOOK_LIMIT)
    throw new ConvexError(`A team can have up to ${WEBHOOK_LIMIT} webhooks`)
  const webhook = {
    organizationId: args.organizationId,
    endpoint,
    events,
    enabled: true,
    secret: args.secret,
  }
  const id = await insertRow(ctx, "webhooks", webhook)
  await subscribe(ctx, { ...webhook, _id: id }, events)
  return id
}

export const insert = internalMutation({
  args: {
    organizationId: v.string(),
    endpoint: v.string(),
    events: v.array(v.string()),
    secret: v.string(),
  },
  returns: v.id("webhooks"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    return insertWebhook(ctx, args)
  },
})

export const rotateSecret = action({
  args: { id: v.id("webhooks") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> =>
    ctx.runMutation(internal.webhooks.saveSecret, {
      id,
      secret: await encryptSecret(createWebhookSecret()),
    }),
})

/** Keep the preceding key for Resend's 24-hour overlap window. */
export async function rotateWebhookSecret(
  ctx: MutationCtx,
  webhook: Doc<"webhooks">,
  secret: string
) {
  await patchRow(ctx, "webhooks", webhook._id, {
    secret,
    previousSecret: webhook.secret,
    previousSecretExpiresAt: Date.now() + DAY,
  })
  return null
}
export const saveSecret = internalMutation({
  args: { id: v.id("webhooks"), secret: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, secret }) => {
    return rotateWebhookSecret(ctx, await writableWebhook(ctx, id), secret)
  },
})

export async function updateWebhook(
  ctx: MutationCtx,
  webhook: Doc<"webhooks">,
  args: {
    endpoint?: string
    events?: string[]
    enabled?: boolean
  }
) {
  const { endpoint, events } = validated(
    args.endpoint ?? webhook.endpoint,
    args.events ?? webhook.events
  )
  const enabled = args.enabled ?? webhook.enabled
  await patchRow(ctx, "webhooks", webhook._id, {
    endpoint,
    events,
    enabled,
    // Re-enabling starts the failure clock over.
    ...(enabled && !webhook.enabled ? { failingSince: undefined } : {}),
  })
  await subscribe(ctx, { ...webhook, enabled }, events)
  return null
}

export const update = mutation({
  args: {
    id: v.id("webhooks"),
    endpoint: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    enabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const webhook = await writableWebhook(ctx, args.id)
    return updateWebhook(ctx, webhook, args)
  },
})

export async function removeWebhook(
  ctx: MutationCtx,
  webhook: Doc<"webhooks">
) {
  await subscribe(ctx, webhook, [])
  await deleteRow(ctx, "webhooks", webhook._id)
  await ctx.scheduler.runAfter(0, internal.webhooks.purgeDeliveries, {
    webhookId: webhook._id,
  })
  return null
}

/** Stops deliveries at once; the history is removed in batches after. */
export const remove = mutation({
  args: { id: v.id("webhooks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const webhook = await writableWebhook(ctx, id)
    return removeWebhook(ctx, webhook)
  },
})

export const purgeDeliveries = internalMutation({
  args: { webhookId: v.id("webhooks") },
  returns: v.null(),
  handler: async (ctx, { webhookId }) => {
    const attempts = await ctx.db
      .query("webhookAttempts")
      .withIndex("by_webhookId", (q) => q.eq("webhookId", webhookId))
      .take(BATCH)
    for (const row of attempts) await deleteRow(ctx, "webhookAttempts", row._id)
    const rows = await stream(ctx.db, schema)
      .query("webhookDeliveries")
      .withIndex("by_webhookId", (q) => q.eq("webhookId", webhookId))
      .paginate(cleanupPage)
    for (const row of rows.page)
      await deleteRow(ctx, "webhookDeliveries", row._id)
    if (!rows.isDone || attempts.length === BATCH)
      await ctx.scheduler.runAfter(0, internal.webhooks.purgeDeliveries, {
        webhookId,
      })
    return null
  },
})

export async function replayDelivery(
  ctx: MutationCtx,
  webhook: Doc<"webhooks">,
  source: Doc<"webhookDeliveries">
) {
  if (!webhook.enabled)
    throw new ConvexError("Enable the webhook to replay its deliveries")
  return send(ctx, {
    organizationId: webhook.organizationId,
    webhookId: webhook._id,
    messageId: source.messageId,
    event: source.event,
    payload: source.payload,
    replay: true,
    originalDeliveryId: source.originalDeliveryId ?? source._id,
  })
}

/** Sends the message again as one new attempt under the same `svix-id`, as
    Svix's resend does, so a receiver that already took it can skip it. */
export const replay = mutation({
  args: { id: deliveryId },
  returns: deliveryId,
  handler: async (ctx, { id }) => {
    const source = await ctx.db.get("webhookDeliveries", id)
    if (!source) throw new ConvexError("Delivery not found")
    const webhook = await writableWebhook(ctx, source.webhookId)
    return replayDelivery(ctx, webhook, source)
  },
})

/** The outbox consumer: one delivery per enabled webhook of the event's team
    that listens for its type. Every endpoint gets the same message id. */
export const deliverEvent = internalMutation({
  args: { id: v.id("events") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const event = await ctx.db.get("events", id)
    if (!event || (await retirement(ctx, event.organizationId))) return null
    const listeners = await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_organizationId_and_event_and_enabled", (q) =>
        q
          .eq("organizationId", event.organizationId)
          .eq("event", event.type)
          .eq("enabled", true)
      )
      .take(WEBHOOK_LIMIT)
    const payload = {
      type: event.type,
      created_at: new Date(event._creationTime).toISOString(),
      data: event.data,
    }
    for (const { webhookId } of listeners)
      await send(ctx, {
        organizationId: event.organizationId,
        webhookId,
        messageId: `msg_${event._id}`,
        event: event.type,
        payload,
        replay: false,
      })
    return null
  },
})

/** What an attempt sends, or null when it must not run: the attempt was
    already made, or the webhook is gone or disabled, which also ends the
    delivery's retries. */
export const claimAttempt = internalMutation({
  args: { id: deliveryId, attempt: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      endpoint: v.string(),
      messageId: v.string(),
      payload: v.record(v.string(), v.any()),
      /** For signing. */
      secret: v.string(),
      previousSecret: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get("webhookDeliveries", args.id)
    if (
      !delivery ||
      delivery.attempts !== args.attempt ||
      (await retirement(ctx, delivery.organizationId))
    )
      return null
    const webhook = await ctx.db.get("webhooks", delivery.webhookId)
    if (!webhook?.enabled) {
      await patchRow(ctx, "webhookDeliveries", delivery._id, {
        nextAttemptAt: undefined,
      })
      return null
    }
    await patchRow(ctx, "webhookDeliveries", delivery._id, {
      attemptStartedAt: Date.now(),
    })
    return {
      endpoint: webhook.endpoint,
      messageId: delivery.messageId,
      payload: delivery.payload,
      secret: await decryptSecret(webhook.secret),
      ...(webhook.previousSecret &&
      (webhook.previousSecretExpiresAt ?? 0) > Date.now()
        ? { previousSecret: await decryptSecret(webhook.previousSecret) }
        : {}),
    }
  },
})

const attemptResult = {
  id: deliveryId,
  attempt: v.number(),
  status: v.number(),
  durationMs: v.number(),
  response: v.string(),
}

async function record(
  ctx: MutationCtx,
  args: {
    id: Id<"webhookDeliveries">
    attempt: number
    status: number
    durationMs: number
    response: string
  }
) {
  const delivery = await ctx.db.get("webhookDeliveries", args.id)
  // Another run already recorded this attempt.
  if (
    !delivery ||
    delivery.attempts !== args.attempt ||
    (await retirement(ctx, delivery.organizationId))
  )
    return
  const webhook = await ctx.db.get("webhooks", delivery.webhookId)
  const now = Date.now()
  const failed = isDeliveryFailed(args)
  const attempts = args.attempt + 1
  const disable =
    failed &&
    !!webhook?.enabled &&
    webhook.failingSince !== undefined &&
    now - webhook.failingSince >= DISABLE_AFTER
  const retry =
    failed &&
    !delivery.replay &&
    !!webhook?.enabled &&
    !disable &&
    attempts < RETRY_DELAYS.length
  await insertRow(ctx, "webhookAttempts", {
    organizationId: delivery.organizationId,
    webhookId: delivery.webhookId,
    eventId: delivery.originalDeliveryId ?? delivery._id,
    httpStatusCode: args.status,
    response: args.response,
    sentAt: delivery.attemptStartedAt ?? now,
  })
  if (delivery.originalDeliveryId) {
    const original = await ctx.db.get(
      "webhookDeliveries",
      delivery.originalDeliveryId
    )
    if (original)
      await patchRow(ctx, "webhookDeliveries", original._id, {
        lastAttemptStatus: args.status,
      })
  }
  await patchRow(ctx, "webhookDeliveries", delivery._id, {
    attemptStartedAt: undefined,
    lastAttemptStatus: args.status,
    status: args.status,
    failed,
    attempts,
    durationMs: args.durationMs,
    response: args.response,
    nextAttemptAt: retry ? now + RETRY_DELAYS[attempts] : undefined,
  })
  if (!webhook) return
  if (retry) await enqueueAttempt(ctx, delivery._id, attempts)
  // Only a change of health touches the webhook itself.
  const failingSince = failed ? (webhook.failingSince ?? now) : undefined
  if (disable) {
    await patchRow(ctx, "webhooks", webhook._id, {
      enabled: false,
      failingSince: undefined,
    })
    await subscribe(ctx, { ...webhook, enabled: false }, webhook.events)
  } else if (failingSince !== webhook.failingSince)
    await patchRow(ctx, "webhooks", webhook._id, { failingSince })
}

export const recordAttempt = internalMutation({
  args: attemptResult,
  returns: v.null(),
  handler: async (ctx, args) => {
    await record(ctx, args)
    return null
  },
})

/** An attempt whose action threw or was canceled still counts, so the
    delivery moves on to its next retry instead of stalling. */
export const attemptDone = internalMutation({
  args: vOnCompleteArgs(v.object({ id: deliveryId, attempt: v.number() })),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    if (result.kind === "success") return null
    await record(ctx, {
      ...context,
      status: 0,
      durationMs: 0,
      response:
        result.kind === "failed" ? result.error : "The attempt was canceled",
    })
    return null
  },
})

/** Deletes deliveries and outbox events past retention, a batch at a time. */
export const cleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION
    const deliveries = await stream(ctx.db, schema)
      .query("webhookDeliveries")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .paginate(cleanupPage)
    for (const row of deliveries.page)
      await deleteRow(ctx, "webhookDeliveries", row._id)
    const attempts = await ctx.db
      .query("webhookAttempts")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(BATCH)
    for (const row of attempts) await deleteRow(ctx, "webhookAttempts", row._id)
    const events = await stream(ctx.db, schema)
      .query("events")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .paginate(cleanupPage)
    for (const row of events.page) await ctx.db.delete("events", row._id)
    if (!deliveries.isDone || !events.isDone || attempts.length === BATCH)
      await ctx.scheduler.runAfter(0, internal.webhooks.cleanup, {})
    return null
  },
})
