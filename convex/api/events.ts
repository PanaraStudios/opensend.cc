import { teamRow } from "../lists"
import { stream } from "convex-helpers/server/stream"
import { idempotent } from "./idempotency"
import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import {
  teamEventCatalog,
  changeEvent,
  defineEvent,
  findEvent,
  payloadShapeError,
  receiveEvent,
} from "../automationEvents"
import { deleteAutomationEvent } from "../automationEventRows"
import schema from "../schema"
import { eventSchemaValue } from "../tables/automationEvents"
import { contactEmailError, normalizeEmail } from "../../lib/dashboard/contacts"
import {
  AUTOMATION_EVENT_FIELD_TYPES,
  type AutomationEvent,
  type AutomationEventFieldType,
} from "../../lib/dashboard/types"
import {
  callerValue,
  notFound,
  requireCaller,
  type Caller,
  invalid,
  missing,
} from "./caller"
import { cursorPage, listArgs } from "./paging"
import {
  listBody,
  apiRoute,
  apiTime,
  listParams,
  objectBody,
  stringField,
  objectField,
} from "./route"

/** An event of the caller's team by its id or its name, or null. */
function own(ctx: QueryCtx, caller: Caller, idOrName: string) {
  return teamRow(ctx, "automationEvents", caller.organizationId, idOrName, {
    fallback: () => findEvent(ctx, caller.organizationId, idOrName),
    fallbackOnMissing: true,
  })
}

export const catalog = internalQuery({
  args: { caller: callerValue },
  returns: v.array(v.any()),
  handler: async (ctx, { caller }) => {
    await requireCaller(ctx, caller, { resource: "events", access: "read" })
    return teamEventCatalog(ctx, caller.organizationId)
  },
})
export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("automationEvents")),
  }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    const org = caller.organizationId
    return cursorPage(
      page,
      async (id) => await own(ctx, caller, id),
      (order) =>
        stream(ctx.db, schema)
          .query("automationEvents")
          .withIndex("by_organizationId", (q) => {
            return q.eq("organizationId", org)
          })
          .order(order)
    )
  },
})
export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: v.union(v.null(), schema.doc("automationEvents")),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    return own(ctx, caller, id)
  },
})
export const create = internalMutation({
  args: { caller: callerValue, name: v.string(), schema: eventSchemaValue },
  returns: v.id("automationEvents"),
  handler: async (ctx, { caller, ...input }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        return defineEvent(ctx, caller.organizationId, input)
      },
      (id) => ({ status: 201, body: { object: "event", id } })
    )
  },
})
export const change = internalMutation({
  args: {
    caller: callerValue,
    id: v.string(),
    action: v.union(
      v.object({ kind: v.literal("update"), schema: eventSchemaValue }),
      v.object({ kind: v.literal("remove") })
    ),
  },
  returns: v.union(v.null(), v.id("automationEvents")),
  handler: async (ctx, { caller, id, action }) => {
    await requireCaller(ctx, caller)
    const event = await own(ctx, caller, id)
    if (!event) return null
    if (action.kind === "update")
      await changeEvent(ctx, event, { schema: action.schema })
    else await deleteAutomationEvent(ctx, event._id)
    return event._id
  },
})
export const send = internalMutation({
  args: {
    caller: callerValue,
    event: v.string(),
    contact: v.union(
      v.object({ id: v.string() }),
      v.object({ email: v.string() })
    ),
    payload: v.record(v.string(), v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { caller, event, contact, payload }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        const org = caller.organizationId
        if ("id" in contact) {
          const id = ctx.db.normalizeId("contacts", contact.id)
          const row = id ? await ctx.db.get("contacts", id) : null
          if (row?.organizationId !== org) throw notFound("Contact")
          await receiveEvent(ctx, org, { name: event, contact: row, payload })
          return null
        }
        const email = normalizeEmail(contact.email)
        const row = await ctx.db
          .query("contacts")
          .withIndex("by_organizationId_and_email", (q) =>
            q.eq("organizationId", org).eq("email", email)
          )
          .unique()
        await receiveEvent(ctx, org, {
          name: event,
          contact: row,
          email,
          payload,
        })
        return null
      },
      () => ({ status: 202, body: { object: "event", event: event.trim() } })
    )
  },
})

/* Resend's schema is an object of property names and types; ours is a list
   in the order the properties were added. */
const SCHEMA_SHAPE =
  "The `schema` field must be an object of property names and types (string, number, boolean or date), or null."
function readSchema(value: unknown): AutomationEvent["schema"] {
  if (value === undefined || value === null) return []
  if (typeof value !== "object" || Array.isArray(value))
    throw invalid(SCHEMA_SHAPE)
  return Object.entries(value).map(([key, type]) => {
    if (!(AUTOMATION_EVENT_FIELD_TYPES as readonly unknown[]).includes(type))
      throw invalid(SCHEMA_SHAPE)
    return { key, type: type as AutomationEventFieldType }
  })
}
const shownSchema = (fields: AutomationEvent["schema"]) =>
  fields.length === 0
    ? null
    : Object.fromEntries(fields.map((field) => [field.key, field.type]))
function summary(event: Doc<"automationEvents">) {
  return {
    id: event._id,
    name: event.name,
    schema: shownSchema(event.schema),
    created_at: apiTime(event._creationTime),
    updated_at: apiTime(event.updatedAt),
  }
}
/** The contact a send names: by id or by address, exactly one of them. */
function sendContact(input: Record<string, unknown>) {
  const id = stringField(input, "contact_id")
  const email = stringField(input, "email")
  if ((id === undefined) === (email === undefined))
    throw invalid(
      "Either `contact_id` or `email` must be provided, but not both."
    )
  if (id !== undefined) return { id }
  const problem = contactEmailError(email!.trim())
  if (problem) throw invalid(problem)
  return { email: email! }
}
function sendPayload(input: Record<string, unknown>) {
  const payload = objectField(input, "payload") ?? {}
  const problem = payloadShapeError(payload)
  if (problem) throw invalid(problem)
  return payload
}

/** `/events`, as Resend documents it: definitions, and `POST /events/send`
    to send one for a contact. Ids are Convex ids; `{id}` also takes the
    event's name. */
export function registerEventRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/events/catalog",
    scope: { resource: "events", access: "read" },
    handler: async (ctx, { caller }) => ({
      body: {
        object: "event_catalog",
        data: await ctx.runQuery(internal.api.events.catalog, { caller }),
      },
    }),
  })
  const changed = (id: Id<"automationEvents"> | null) => {
    if (!id) throw notFound("Event")
    return { object: "event", id }
  }
  apiRoute(http, {
    method: "GET",
    path: "/events",
    scope: { resource: "events", access: "read" },
    handler: async (ctx, { caller, query }) => {
      const page = await ctx.runQuery(internal.api.events.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: listBody(page, summary),
      }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/events",
    scope: { resource: "events", access: "write" },
    handler: async (ctx, { caller, body }) => {
      const input = objectBody(body)
      const id = await ctx.runMutation(internal.api.events.create, {
        caller,
        name: stringField(input, "name", true)!,
        schema: readSchema(input.schema),
      })
      return { status: 201, body: { object: "event", id } }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/events/send",
    scope: { resource: "events", access: "write" },
    handler: async (ctx, { caller, body }) => {
      const input = objectBody(body)
      const event = stringField(input, "event", true)!
      await ctx.runMutation(internal.api.events.send, {
        caller,
        event,
        contact: sendContact(input),
        payload: sendPayload(input),
      })
      return { status: 202, body: { object: "event", event: event.trim() } }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/events/{id}",
    scope: { resource: "events", access: "read" },
    handler: async (ctx, { caller, params }) => {
      const event = await ctx.runQuery(internal.api.events.get, {
        caller,
        id: params.id,
      })
      if (!event) throw notFound("Event")
      return { body: { object: "event", ...summary(event) } }
    },
  })
  apiRoute(http, {
    method: "PATCH",
    path: "/events/{id}",
    scope: { resource: "events", access: "write" },
    handler: async (ctx, { caller, params, body }) => {
      const input = objectBody(body)
      if (!("schema" in input)) throw missing("schema")
      return {
        body: changed(
          await ctx.runMutation(internal.api.events.change, {
            caller,
            id: params.id,
            action: { kind: "update", schema: readSchema(input.schema) },
          })
        ),
      }
    },
  })
  apiRoute(http, {
    method: "DELETE",
    path: "/events/{id}",
    scope: { resource: "events", access: "write" },
    handler: async (ctx, { caller, params }) => ({
      body: {
        ...changed(
          await ctx.runMutation(internal.api.events.change, {
            caller,
            id: params.id,
            action: { kind: "remove" },
          })
        ),
        deleted: true,
      },
    }),
  })
}
