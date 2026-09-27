import { v, ConvexError } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { Workpool, vOnCompleteArgs } from "@convex-dev/workpool"
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto"
import {
  action,
  env,
  internalMutation,
  mutation,
  query,
} from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import schema from "./schema"
import { requireTeam } from "./access"
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

const encrypt = (data: string) =>
  symmetricEncrypt({ key: env.SSO_ENCRYPTION_KEY, data })
const decryptSecret = (data: string) =>
  symmetricDecrypt({ key: env.SSO_ENCRYPTION_KEY, data })

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
  const normalized = ctx.db.normalizeId("webhooks", id)
  const webhook = normalized ? await ctx.db.get("webhooks", normalized) : null
  if (webhook) await requireTeam(ctx, webhook.organizationId)
  return webhook
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

const findStats = (ctx: QueryCtx | MutationCtx, webhookId: Id<"webhooks">) =>
  ctx.db
    .query("webhookStats")
    .withIndex("by_webhookId", (q) => q.eq("webhookId", webhookId))
    .unique()

async function count(
  ctx: MutationCtx,
  webhookId: Id<"webhooks">,
  change: { deliveries: number; failed: number }
) {
  if (!change.deliveries && !change.failed) return
  const stats = await findStats(ctx, webhookId)
  if (stats)
    await ctx.db.patch("webhookStats", stats._id, {
      deliveries: stats.deliveries + change.deliveries,
      failed: stats.failed + change.failed,
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
  >
) {
  const id = await ctx.db.insert("webhookDeliveries", {
    ...message,
    status: 0,
    failed: true,
    attempts: 0,
    durationMs: 0,
    response: "",
    nextAttemptAt: Date.now(),
  })
  await count(ctx, message.webhookId, { deliveries: 1, failed: 1 })
  await enqueueAttempt(ctx, id, 0)
  return id
}

export const list = query({
  args: { organizationId: v.string() },
  returns: v.array(webhookValue),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    const rows = await ctx.db
      .query("webhooks")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .order("desc")
      .take(WEBHOOK_LIMIT)
    return rows.map(shown)
  },
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
    const stats = await findStats(ctx, webhook._id)
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
      deliveries: stats?.deliveries ?? 0,
      failed: stats?.failed ?? 0,
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

export const deliveries = query({
  args: {
    webhookId: v.id("webhooks"),
    paginationOpts: paginationOptsValidator,
    failed: v.optional(v.boolean()),
    event: v.optional(v.string()),
  },
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
      secret: await encrypt(createWebhookSecret()),
    }),
})

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
    const id = await ctx.db.insert("webhooks", webhook)
    await ctx.db.insert("webhookStats", {
      webhookId: id,
      deliveries: 0,
      failed: 0,
    })
    await subscribe(ctx, { ...webhook, _id: id }, events)
    return id
  },
})

export const rotateSecret = action({
  args: { id: v.id("webhooks") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> =>
    ctx.runMutation(internal.webhooks.saveSecret, {
      id,
      secret: await encrypt(createWebhookSecret()),
    }),
})

/** The new secret replaces the old one at once: every attempt from now on,
    retries included, is signed with it alone. */
export const saveSecret = internalMutation({
  args: { id: v.id("webhooks"), secret: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, secret }) => {
    await writableWebhook(ctx, id)
    await ctx.db.patch("webhooks", id, { secret })
    return null
  },
})

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
    const { endpoint, events } = validated(
      args.endpoint ?? webhook.endpoint,
      args.events ?? webhook.events
    )
    const enabled = args.enabled ?? webhook.enabled
    await ctx.db.patch("webhooks", webhook._id, {
      endpoint,
      events,
      enabled,
      // Re-enabling starts the failure clock over.
      ...(enabled && !webhook.enabled ? { failingSince: undefined } : {}),
    })
    await subscribe(ctx, { ...webhook, enabled }, events)
    return null
  },
})

/** Stops deliveries at once; the history is removed in batches after. */
export const remove = mutation({
  args: { id: v.id("webhooks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const webhook = await writableWebhook(ctx, id)
    await subscribe(ctx, webhook, [])
    const stats = await findStats(ctx, id)
    if (stats) await ctx.db.delete("webhookStats", stats._id)
    await ctx.db.delete("webhooks", id)
    await ctx.scheduler.runAfter(0, internal.webhooks.purgeDeliveries, {
      webhookId: id,
    })
    return null
  },
})

export const purgeDeliveries = internalMutation({
  args: { webhookId: v.id("webhooks") },
  returns: v.null(),
  handler: async (ctx, { webhookId }) => {
    const rows = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_webhookId", (q) => q.eq("webhookId", webhookId))
      .take(BATCH)
    for (const row of rows) await ctx.db.delete("webhookDeliveries", row._id)
    if (rows.length === BATCH)
      await ctx.scheduler.runAfter(0, internal.webhooks.purgeDeliveries, {
        webhookId,
      })
    return null
  },
})

/** Sends the message again as one new attempt under the same `svix-id`, as
    Svix's resend does, so a receiver that already took it can skip it. */
export const replay = mutation({
  args: { id: deliveryId },
  returns: deliveryId,
  handler: async (ctx, { id }) => {
    const source = await ctx.db.get("webhookDeliveries", id)
    if (!source) throw new ConvexError("Delivery not found")
    const webhook = await writableWebhook(ctx, source.webhookId)
    if (!webhook.enabled)
      throw new ConvexError("Enable the webhook to replay its deliveries")
    return send(ctx, {
      organizationId: webhook.organizationId,
      webhookId: webhook._id,
      messageId: source.messageId,
      event: source.event,
      payload: source.payload,
      replay: true,
    })
  },
})

/** The outbox consumer: one delivery per enabled webhook of the event's team
    that listens for its type. Every endpoint gets the same message id. */
export const deliverEvent = internalMutation({
  args: { id: v.id("events") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const event = await ctx.db.get("events", id)
    if (!event) return null
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
    })
  ),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get("webhookDeliveries", args.id)
    if (!delivery || delivery.attempts !== args.attempt) return null
    const webhook = await ctx.db.get("webhooks", delivery.webhookId)
    if (!webhook?.enabled) {
      await ctx.db.patch("webhookDeliveries", delivery._id, {
        nextAttemptAt: undefined,
      })
      return null
    }
    return {
      endpoint: webhook.endpoint,
      messageId: delivery.messageId,
      payload: delivery.payload,
      secret: await decryptSecret(webhook.secret),
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
  if (!delivery || delivery.attempts !== args.attempt) return
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
  await ctx.db.patch("webhookDeliveries", delivery._id, {
    status: args.status,
    failed,
    attempts,
    durationMs: args.durationMs,
    response: args.response,
    nextAttemptAt: retry ? now + RETRY_DELAYS[attempts] : undefined,
  })
  if (!webhook) return
  await count(ctx, webhook._id, {
    deliveries: 0,
    failed: Number(failed) - Number(delivery.failed),
  })
  if (retry) await enqueueAttempt(ctx, delivery._id, attempts)
  // Only a change of health touches the webhook itself.
  const failingSince = failed ? (webhook.failingSince ?? now) : undefined
  if (disable) {
    await ctx.db.patch("webhooks", webhook._id, {
      enabled: false,
      failingSince: undefined,
    })
    await subscribe(ctx, { ...webhook, enabled: false }, webhook.events)
  } else if (failingSince !== webhook.failingSince)
    await ctx.db.patch("webhooks", webhook._id, { failingSince })
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
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(BATCH)
    const removed = new Map<
      Id<"webhooks">,
      { deliveries: number; failed: number }
    >()
    for (const row of deliveries) {
      await ctx.db.delete("webhookDeliveries", row._id)
      const total = removed.get(row.webhookId) ?? { deliveries: 0, failed: 0 }
      removed.set(row.webhookId, {
        deliveries: total.deliveries - 1,
        failed: total.failed - Number(row.failed),
      })
    }
    for (const [webhookId, change] of removed)
      await count(ctx, webhookId, change)
    const events = await ctx.db
      .query("events")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(BATCH)
    for (const row of events) await ctx.db.delete("events", row._id)
    if (deliveries.length === BATCH || events.length === BATCH)
      await ctx.scheduler.runAfter(0, internal.webhooks.cleanup, {})
    return null
  },
})
