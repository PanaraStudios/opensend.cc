import { v } from "convex/values"
import { stream } from "convex-helpers/server/stream"
import type { HttpRouter } from "convex/server"
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import schema from "../schema"
import {
  insertWebhook,
  updateWebhook,
  removeWebhook,
  rotateWebhookSecret,
  replayDelivery,
} from "../webhooks"
import { decryptSecret, encryptSecret } from "../secrets"
import { createWebhookSecret } from "../../lib/dashboard/ids"
import {
  callerValue,
  notFound,
  requireCaller,
  invalid,
  missing,
  requireTeamRow,
} from "./caller"
import { idempotent } from "./idempotency"
import { cursorPage, listArgs } from "./paging"
import {
  listBody,
  apiRoute,
  apiTime,
  enumField,
  listParams,
  objectBody,
  stringField,
  stringListField,
} from "./route"

function own(ctx: QueryCtx, organizationId: string, value: string) {
  return requireTeamRow(ctx, "webhooks", organizationId, value, "Webhook")
}
async function event(ctx: QueryCtx, webhookId: Id<"webhooks">, value: string) {
  const id = ctx.db.normalizeId("webhookDeliveries", value)
  const row = id ? await ctx.db.get("webhookDeliveries", id) : null
  if (!row || row.webhookId !== webhookId || row.replay)
    throw notFound("Webhook event")
  return row
}
function input(body: unknown, required = false) {
  const value = objectBody(body)
  if (required && value.events === undefined) throw missing("events")
  const events = stringListField(value, "events", {
    arrayOnly: true,
    rejectNull: true,
  })
  const status = required
    ? undefined
    : enumField(value, "status", ["enabled", "disabled"])
  return {
    endpoint: stringField(value, "endpoint", required),
    events: events as string[] | undefined,
    enabled: status === undefined ? undefined : status === "enabled",
  }
}
const ref = (id: string) => ({ object: "webhook" as const, id })
const refValue = v.object({
  object: v.literal("webhook"),
  id: v.string(),
  signing_secret: v.optional(v.string()),
  deleted: v.optional(v.boolean()),
})
export const create = internalMutation({
  args: {
    caller: callerValue,
    endpoint: v.string(),
    events: v.array(v.string()),
    secret: v.string(),
    signingSecret: v.string(),
  },
  returns: refValue,
  handler: async (ctx, { caller, endpoint, events, secret, signingSecret }) => {
    await requireCaller(ctx, caller)
    return idempotent(
      ctx,
      caller,
      async () => ({
        ...ref(
          await insertWebhook(ctx, {
            organizationId: caller.organizationId,
            endpoint,
            events,
            secret,
          })
        ),
        signing_secret: signingSecret,
      }),
      (body) => ({ body, status: 201 })
    )
  },
})
export const change = internalMutation({
  args: {
    caller: callerValue,
    id: v.string(),
    operation: v.union(
      v.literal("update"),
      v.literal("remove"),
      v.literal("rotate")
    ),
    endpoint: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    enabled: v.optional(v.boolean()),
    secret: v.optional(v.string()),
    signingSecret: v.optional(v.string()),
  },
  returns: refValue,
  handler: async (
    ctx,
    { caller, id, operation, secret, signingSecret, ...input }
  ) => {
    await requireCaller(ctx, caller)
    return idempotent(
      ctx,
      caller,
      async () => {
        const row = await own(ctx, caller.organizationId, id)
        if (operation === "remove") {
          await removeWebhook(ctx, row)
          return { ...ref(row._id), deleted: true }
        }
        if (operation === "rotate") {
          if (!secret || !signingSecret)
            throw invalid("Missing signing secret.")
          await rotateWebhookSecret(ctx, row, secret)
          return { ...ref(row._id), signing_secret: signingSecret }
        }
        await updateWebhook(ctx, row, input)
        return ref(row._id)
      },
      (body) => ({ body })
    )
  },
})
const webhookValue = schema
  .doc("webhooks")
  .pick("_id", "_creationTime", "endpoint", "events", "enabled")
const shown = ({
  _id,
  _creationTime,
  endpoint,
  events,
  enabled,
}: Doc<"webhooks">) => ({ _id, _creationTime, endpoint, events, enabled })
export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: webhookValue,
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    return shown(await own(ctx, caller.organizationId, id))
  },
})
/** Resend returns the signing secret with the webhook; the dashboard also
    reveals it to any member, so a full-access key sees no more than that. */
export const signingSecret = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: v.string(),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    return decryptSecret((await own(ctx, caller.organizationId, id)).secret)
  },
})
export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({ has_more: v.boolean(), data: v.array(webhookValue) }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    const result = await cursorPage(
      page,
      async (id) => {
        try {
          return await own(ctx, caller.organizationId, id)
        } catch {
          return null
        }
      },
      (order) =>
        stream(ctx.db, schema)
          .query("webhooks")
          .withIndex("by_organizationId", (q) =>
            q.eq("organizationId", caller.organizationId)
          )
          .order(order)
    )
    return { ...result, data: result.data.map(shown) }
  },
})
export const getEvent = internalQuery({
  args: { caller: callerValue, id: v.string(), eventId: v.string() },
  returns: schema.doc("webhookDeliveries"),
  handler: async (ctx, { caller, id, eventId }) => {
    await requireCaller(ctx, caller)
    const row = await own(ctx, caller.organizationId, id)
    return event(ctx, row._id, eventId)
  },
})
export const listEvents = internalQuery({
  args: { caller: callerValue, id: v.string(), ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("webhookDeliveries")),
  }),
  handler: async (ctx, { caller, id, ...page }) => {
    await requireCaller(ctx, caller)
    const row = await own(ctx, caller.organizationId, id)
    return cursorPage(
      page,
      async (id) => {
        try {
          return await event(ctx, row._id, id)
        } catch {
          return null
        }
      },
      (order) =>
        stream(ctx.db, schema)
          .query("webhookDeliveries")
          .withIndex("by_webhookId_and_replay", (q) =>
            q.eq("webhookId", row._id).eq("replay", false)
          )
          .order(order)
    )
  },
})
export const listAttempts = internalQuery({
  args: {
    caller: callerValue,
    id: v.string(),
    eventId: v.string(),
    ...listArgs,
  },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("webhookAttempts")),
  }),
  handler: async (ctx, { caller, id, eventId, ...page }) => {
    await requireCaller(ctx, caller)
    const webhook = await own(ctx, caller.organizationId, id)
    const row = await event(ctx, webhook._id, eventId)
    return cursorPage(
      page,
      async (value) => {
        const id = ctx.db.normalizeId("webhookAttempts", value)
        const attempt = id ? await ctx.db.get("webhookAttempts", id) : null
        return attempt?.eventId === row._id && attempt.webhookId === webhook._id
          ? attempt
          : null
      },
      (order) =>
        stream(ctx.db, schema)
          .query("webhookAttempts")
          .withIndex("by_eventId", (q) => q.eq("eventId", row._id))
          .order(order)
    )
  },
})
export const replay = internalMutation({
  args: { caller: callerValue, id: v.string(), eventId: v.string() },
  returns: v.object({ object: v.literal("webhook_event"), id: v.string() }),
  handler: async (ctx, { caller, id, eventId }) => {
    await requireCaller(ctx, caller)
    return idempotent(
      ctx,
      caller,
      async () => {
        const webhook = await own(ctx, caller.organizationId, id)
        const row = await event(ctx, webhook._id, eventId)
        await replayDelivery(ctx, webhook, row)
        return { object: "webhook_event" as const, id: row._id }
      },
      (body) => ({ body })
    )
  },
})
const project = (row: ReturnType<typeof shown>) => ({
  id: row._id,
  endpoint: row.endpoint,
  events: row.events,
  status: row.enabled ? "enabled" : "disabled",
  created_at: apiTime(row._creationTime),
})
const projectEvent = (row: Doc<"webhookDeliveries">) => ({
  id: row._id,
  type: row.event,
  created_at: new Date(row._creationTime).toISOString(),
  status:
    (row.lastAttemptStatus ?? row.status) >= 200 &&
    (row.lastAttemptStatus ?? row.status) < 300
      ? "success"
      : row.attemptStartedAt !== undefined ||
          (row.attempts > 0 && row.nextAttemptAt !== undefined)
        ? "attempting"
        : row.nextAttemptAt !== undefined
          ? "pending"
          : "failed",
})
function forwardPage(query: URLSearchParams) {
  if (query.has("before"))
    throw invalid("The `before` parameter is not supported for this endpoint.")
  return listParams(query)
}
async function secret() {
  const signingSecret = createWebhookSecret()
  return {
    signingSecret,
    secret: await encryptSecret(signingSecret),
  }
}
export function registerWebhookRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/webhooks",
    scope: { resource: "webhooks", access: "write" },
    handler: async (ctx, { caller, body }) => {
      const fields = input(body, true)
      return {
        status: 201,
        body: await ctx.runMutation(internal.api.webhooks.create, {
          caller,
          endpoint: fields.endpoint!,
          events: fields.events!,
          ...(await secret()),
        }),
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/webhooks",
    scope: { resource: "webhooks", access: "read" },
    handler: async (ctx, { caller, query }) => {
      const page = await ctx.runQuery(internal.api.webhooks.list, {
        caller,
        ...listParams(query),
      })
      return { body: listBody(page, project) }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/webhooks/{webhook_id}",
    scope: { resource: "webhooks", access: "read" },
    handler: async (ctx, { caller, params }) => {
      const args = { caller, id: params.webhook_id }
      return {
        body: {
          object: "webhook",
          ...project(await ctx.runQuery(internal.api.webhooks.get, args)),
          signing_secret: await ctx.runQuery(
            internal.api.webhooks.signingSecret,
            args
          ),
        },
      }
    },
  })
  apiRoute(http, {
    method: "PATCH",
    path: "/webhooks/{webhook_id}",
    scope: { resource: "webhooks", access: "write" },
    handler: async (ctx, { caller, params, body }) => ({
      body: await ctx.runMutation(internal.api.webhooks.change, {
        caller,
        id: params.webhook_id,
        operation: "update",
        ...input(body),
      }),
    }),
  })
  apiRoute(http, {
    method: "DELETE",
    path: "/webhooks/{webhook_id}",
    scope: { resource: "webhooks", access: "write" },
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runMutation(internal.api.webhooks.change, {
        caller,
        id: params.webhook_id,
        operation: "remove",
      }),
    }),
  })
  apiRoute(http, {
    method: "POST",
    path: "/webhooks/{webhook_id}/signing-secret/rotate",
    scope: { resource: "webhooks", access: "write" },
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runMutation(internal.api.webhooks.change, {
        caller,
        id: params.webhook_id,
        operation: "rotate",
        ...(await secret()),
      }),
    }),
  })
  apiRoute(http, {
    method: "GET",
    path: "/webhooks/{webhook_id}/events",
    scope: { resource: "webhooks", access: "read" },
    handler: async (ctx, { caller, params, query }) => {
      const page = await ctx.runQuery(internal.api.webhooks.listEvents, {
        caller,
        id: params.webhook_id,
        ...forwardPage(query),
      })
      return {
        body: listBody(page, projectEvent),
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/webhooks/{webhook_id}/events/{event_id}",
    scope: { resource: "webhooks", access: "read" },
    handler: async (ctx, { caller, params }) => {
      const row = await ctx.runQuery(internal.api.webhooks.getEvent, {
        caller,
        id: params.webhook_id,
        eventId: params.event_id,
      })
      return {
        body: {
          object: "webhook_event",
          ...projectEvent(row),
          next_attempt_at:
            row.nextAttemptAt === undefined ||
            projectEvent(row).status === "success"
              ? null
              : new Date(row.nextAttemptAt).toISOString(),
          payload: row.payload,
        },
      }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/webhooks/{webhook_id}/events/{event_id}/replay",
    scope: { resource: "webhooks", access: "write" },
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runMutation(internal.api.webhooks.replay, {
        caller,
        id: params.webhook_id,
        eventId: params.event_id,
      }),
    }),
  })
  apiRoute(http, {
    method: "GET",
    path: "/webhooks/{webhook_id}/events/{event_id}/attempts",
    scope: { resource: "webhooks", access: "read" },
    handler: async (ctx, { caller, params, query }) => {
      const page = await ctx.runQuery(internal.api.webhooks.listAttempts, {
        caller,
        id: params.webhook_id,
        eventId: params.event_id,
        ...forwardPage(query),
      })
      return {
        body: listBody(page, (row) => ({
          id: row._id,
          http_status_code: row.httpStatusCode,
          response: row.response,
          sent_at: new Date(row.sentAt).toISOString(),
        })),
      }
    },
  })
}
