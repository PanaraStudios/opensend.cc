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
import type { Doc } from "../_generated/dataModel"
import schema from "../schema"
import { effectiveTopicSubscription } from "../../lib/dashboard/contacts"
import {
  deleteContact,
  emitContact,
  findTopicChoice,
  listProperties,
  setMembership,
  setTopicChoices,
  updateContact,
  upsertContact,
} from "../audience"
import { createSegment, updateSegment, removeSegment } from "../segments"
import { createTopic, updateTopic, removeTopic } from "../topics"
import {
  createProperty,
  removeProperty,
  updateProperty,
} from "../contactProperties"
import { apiError, callerValue, notFound, requireCaller } from "./caller"
import { cursorPage, listArgs } from "./paging"
import {
  apiRoute,
  apiTime,
  booleanField,
  enumField,
  listParams,
  objectBody,
  stringField,
} from "./route"

const resourceValue = v.union(
  v.literal("contacts"),
  v.literal("segments"),
  v.literal("topics"),
  v.literal("contactProperties")
)
type Resource = "contacts" | "segments" | "topics" | "contactProperties"
const nouns = {
  contacts: "contact",
  segments: "segment",
  topics: "topic",
  contactProperties: "contact_property",
}
const rowValue = v.union(
  schema.doc("contacts"),
  schema.doc("segments"),
  schema.doc("topics"),
  schema.doc("contactProperties")
)
const invalid = (message: string) => apiError(422, "validation_error", message)

export async function own<T extends Resource>(
  ctx: QueryCtx,
  table: T,
  organizationId: string,
  value: string
): Promise<Doc<T>> {
  const id = ctx.db.normalizeId(table, value)
  const row = id
    ? await ctx.db.get(table, id)
    : table === "contacts"
      ? await ctx.db
          .query("contacts")
          .withIndex("by_organizationId_and_email", (q) =>
            q
              .eq("organizationId", organizationId)
              .eq("email", value.trim().toLowerCase())
          )
          .unique()
      : null
  if (
    !row ||
    row.organizationId !== organizationId ||
    ("deleting" in row && row.deleting)
  )
    throw notFound(nouns[table])
  return row as Doc<T>
}

export const list = internalQuery({
  args: { caller: callerValue, resource: resourceValue, ...listArgs },
  returns: v.object({ has_more: v.boolean(), data: v.array(rowValue) }),
  handler: async (ctx, { caller, resource, ...page }) => {
    await requireCaller(ctx, caller)
    return cursorPage<Doc<Resource>>(
      page,
      async (id) => {
        try {
          return await own(ctx, resource, caller.organizationId, id)
        } catch {
          return null
        }
      },
      async (order) => {
        if (resource === "contactProperties")
          return listProperties(ctx, caller.organizationId)
        const query = stream(ctx.db, schema)
          .query(resource)
          .withIndex("by_organizationId", (q) => {
            return q.eq("organizationId", caller.organizationId)
          })
          .order(order)
        return query
      }
    )
  },
})

const contactFields = (body: Record<string, unknown>) => ({
  firstName: body.first_name === null ? "" : stringField(body, "first_name"),
  lastName: body.last_name === null ? "" : stringField(body, "last_name"),
  unsubscribed: booleanField(body, "unsubscribed"),
})
async function properties(
  ctx: QueryCtx,
  organizationId: string,
  value: unknown
) {
  if (value === undefined) return undefined
  const input = objectBody(value)
  const definitions = await listProperties(ctx, organizationId)
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    const definition = definitions.find((property) => property.key === key)
    if (
      !definition ||
      (value !== null &&
        (typeof value !== definition.type ||
          (typeof value === "number" && !Number.isFinite(value))))
    )
      throw invalid(`Invalid contact property: ${key}`)
    result[key] = value === null ? "" : String(value)
  }
  return result
}
function array(value: unknown, name: string, max: number) {
  if (!Array.isArray(value) || value.length > max)
    throw invalid(
      `The \`${name}\` field must be an array of at most ${max} items.`
    )
  return value.map(objectBody)
}
function fallback(body: Record<string, unknown>, type: string) {
  const value = body.fallback_value
  if (value === undefined) return undefined
  if (
    typeof value !== type ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw invalid("The fallback value must match the property type.")
  return String(value)
}
function topicInput(body: Record<string, unknown>, required = false) {
  const name = stringField(body, "name", required)
  const description = stringField(body, "description")
  if ((name?.length ?? 0) > 50 || (description?.length ?? 0) > 200)
    throw invalid("Topic name or description is too long.")
  return {
    name,
    description,
    visibility: enumField(body, "visibility", ["public", "private"]),
  }
}

export const create = internalMutation({
  args: {
    caller: callerValue,
    resource: resourceValue,
    body: v.string(),
    audienceAlias: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, { caller, resource, body, audienceAlias }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        const input = objectBody(JSON.parse(body))
        const organizationId = caller.organizationId
        if (resource === "segments")
          return createSegment(ctx, {
            organizationId,
            name: stringField(input, "name", true)!,
          })
        if (resource === "topics") {
          const topic = topicInput(input, true)
          const defaultSubscription = enumField(input, "default_subscription", [
            "opt_in",
            "opt_out",
          ])
          if (!defaultSubscription)
            throw invalid("Missing `default_subscription` field.")
          return createTopic(ctx, {
            organizationId,
            name: topic.name!,
            description: topic.description ?? "",
            visibility: topic.visibility ?? "private",
            defaultSubscription:
              defaultSubscription === "opt_in" ? "opt_out" : "opt_in",
          })
        }
        if (resource === "contactProperties") {
          const key = stringField(input, "key", true)!
          const type = enumField(input, "type", ["string", "number"])
          if (!type) throw invalid("Missing `type` field.")
          if (!/^[a-zA-Z0-9_]{1,50}$/.test(key))
            throw invalid("Invalid property key.")
          return createProperty(
            ctx,
            {
              organizationId,
              key,
              name: key,
              type,
              fallbackValue: fallback(input, type),
            },
            "api"
          )
        }
        const segments = await Promise.all(
          array(
            input.segments ??
              (input.audience_id ? [{ id: input.audience_id }] : []),
            "segments",
            500
          ).map((segment) =>
            own(
              ctx,
              "segments",
              organizationId,
              stringField(segment, "id", true)!
            )
          )
        )
        const topics = await Promise.all(
          array(input.topics ?? [], "topics", 100).map(async (topic) => {
            const subscription = enumField(topic, "subscription", [
              "opt_in",
              "opt_out",
            ])
            if (!subscription) throw invalid("Missing topic subscription.")
            return {
              topic: await own(
                ctx,
                "topics",
                organizationId,
                stringField(topic, "id", true)!
              ),
              subscription,
            }
          })
        )
        const result = await upsertContact(
          ctx,
          organizationId,
          {
            email: stringField(input, "email", true)!,
            ...contactFields(input),
            properties: await properties(ctx, organizationId, input.properties),
          },
          {
            properties: await listProperties(ctx, organizationId),
            segmentIds: segments.map((segment) => segment._id),
          }
        )
        const contact = (await ctx.db.get("contacts", result.id))!
        await setTopicChoices(
          ctx,
          contact,
          topics.map(({ topic, subscription }) => ({
            topicId: topic._id,
            subscription:
              subscription === "opt_in" ? "subscribed" : "unsubscribed",
          }))
        )
        return result.id
      },
      (id) => ({
        status: 201,
        body: { object: audienceAlias ? "audience" : nouns[resource], id },
      })
    )
  },
})

export const change = internalMutation({
  args: {
    caller: callerValue,
    resource: resourceValue,
    id: v.string(),
    remove: v.boolean(),
    body: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, { caller, resource, id, remove, body }) => {
    await requireCaller(ctx, caller)
    const input = objectBody(JSON.parse(body))
    const org = caller.organizationId
    if (resource === "contacts") {
      const row = await own(ctx, resource, org, id)
      if (remove) await deleteContact(ctx, row)
      else
        await updateContact(ctx, row, {
          ...contactFields(input),
          properties: await properties(ctx, org, input.properties),
        })
      return row._id
    }
    if (resource === "segments") {
      const row = await own(ctx, resource, org, id)
      if (remove) await removeSegment(ctx, row._id)
      else
        await updateSegment(ctx, {
          id: row._id,
          name: stringField(input, "name", true)!,
        })
      return row._id
    }
    if (resource === "topics") {
      const row = await own(ctx, resource, org, id)
      if (remove) await removeTopic(ctx, row._id)
      else {
        if (input.default_subscription !== undefined)
          throw invalid("The default subscription cannot be changed.")
        await updateTopic(ctx, { id: row._id, ...topicInput(input) })
      }
      return row._id
    }
    const row = await own(ctx, resource, org, id)
    if (remove) await removeProperty(ctx, row)
    else {
      if (input.key !== undefined || input.type !== undefined)
        throw invalid("The property key and type cannot be changed.")
      await updateProperty(ctx, row, fallback(input, row.type))
    }
    return row._id
  },
})

export const get = internalQuery({
  args: { caller: callerValue, resource: resourceValue, id: v.string() },
  returns: v.object({
    row: rowValue,
    properties: v.optional(
      v.record(
        v.string(),
        v.object({
          value: v.union(v.string(), v.number(), v.null()),
          type: v.union(v.literal("string"), v.literal("number")),
        })
      )
    ),
  }),
  handler: async (ctx, { caller, resource, id }) => {
    await requireCaller(ctx, caller)
    const row = await own(ctx, resource, caller.organizationId, id)
    if (resource !== "contacts" || !("email" in row)) return { row }
    return {
      row,
      properties: Object.fromEntries(
        (await listProperties(ctx, caller.organizationId)).map((property) => {
          const value = row.properties[property.key] ?? property.fallbackValue
          return [
            property.key,
            {
              value:
                value === undefined
                  ? null
                  : property.type === "number"
                    ? Number(value)
                    : value,
              type: property.type,
            },
          ]
        })
      ),
    }
  },
})

export function summary(row: Doc<Resource>) {
  const base = { id: row._id, created_at: apiTime(row._creationTime) }
  if ("email" in row)
    return {
      ...base,
      email: row.email,
      // Resend sends null for a missing name, here as in contact webhooks.
      first_name: row.firstName || null,
      last_name: row.lastName || null,
      unsubscribed: row.unsubscribed,
    }
  if ("key" in row)
    return {
      ...base,
      key: row.key,
      type: row.type,
      fallback_value:
        row.fallbackValue === undefined
          ? null
          : row.type === "number"
            ? Number(row.fallbackValue)
            : row.fallbackValue,
    }
  if ("defaultSubscription" in row)
    return {
      ...base,
      name: row.name,
      description: row.description,
      default_subscription:
        row.defaultSubscription === "opt_out" ? "opt_in" : "opt_out",
      visibility: row.visibility,
    }
  return { ...base, name: row.name }
}

export function registerAudienceRoutes(http: HttpRouter) {
  for (const endpoint of [
    "audiences",
    "contacts",
    "segments",
    "topics",
    "contactProperties",
  ] as const) {
    const resource = endpoint === "audiences" ? "segments" : endpoint
    const noun = endpoint === "audiences" ? "audience" : nouns[resource]
    const path =
      resource === "contactProperties" ? "/contact-properties" : `/${endpoint}`
    apiRoute(http, {
      method: "GET",
      path,
      permission: "full_access",
      handler: async (ctx, { caller, query }) => {
        const segment = resource === "contacts" ? query.get("segment_id") : null
        const page = segment
          ? await ctx.runQuery(internal.api.audience.relations, {
              caller,
              id: segment,
              kind: "segmentContacts",
              ...listParams(query),
            })
          : await ctx.runQuery(internal.api.audience.list, {
              caller,
              resource,
              ...listParams(query),
            })
        return {
          body: { object: "list", ...page, data: page.data.map(summary) },
        }
      },
    })
    apiRoute(http, {
      method: "POST",
      path,
      permission: "full_access",
      handler: async (ctx, { caller, body }) => ({
        status: 201,
        body: {
          object: noun,
          id: await ctx.runMutation(internal.api.audience.create, {
            caller,
            audienceAlias: endpoint === "audiences",
            resource,
            body: JSON.stringify(body ?? {}),
          }),
        },
      }),
    })
    apiRoute(http, {
      method: "GET",
      path: `${path}/{id}`,
      permission: "full_access",
      handler: async (ctx, { caller, params }) => {
        const result = await ctx.runQuery(internal.api.audience.get, {
          caller,
          resource,
          id: params.id,
        })
        return {
          body: {
            object: noun,
            ...summary(result.row),
            ...(result.properties ? { properties: result.properties } : {}),
          },
        }
      },
    })
    for (const method of endpoint === "audiences"
      ? (["DELETE"] as const)
      : (["PATCH", "DELETE"] as const))
      apiRoute(http, {
        method,
        path: `${path}/{id}`,
        permission: "full_access",
        handler: async (ctx, { caller, params, body }) => {
          const id = await ctx.runMutation(internal.api.audience.change, {
            caller,
            resource,
            id: params.id,
            remove: method === "DELETE",
            body: JSON.stringify(body ?? {}),
          })
          return {
            body: {
              object: noun,
              ...(method === "DELETE" && resource === "contacts"
                ? { contact: id }
                : { id }),
              ...(method === "DELETE" ? { deleted: true } : {}),
            },
          }
        },
      })
  }
  registerRelations(http)
}

export const membership = internalMutation({
  args: {
    caller: callerValue,
    id: v.string(),
    segment: v.string(),
    member: v.boolean(),
  },
  returns: v.object({ contact: v.string(), segment: v.string() }),
  handler: async (ctx, { caller, id, segment, member }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        const contact = await own(ctx, "contacts", caller.organizationId, id)
        const group = await own(ctx, "segments", caller.organizationId, segment)
        if (await setMembership(ctx, contact, group._id, member))
          await emitContact(ctx, "contact.updated", contact)
        return { contact: contact._id, segment: group._id }
      },
      (result) => ({ body: { id: result.segment } })
    )
  },
})
export const subscriptions = internalMutation({
  args: { caller: callerValue, id: v.string(), body: v.string() },
  returns: v.string(),
  handler: async (ctx, { caller, id, body }) => {
    await requireCaller(ctx, caller)
    const contact = await own(ctx, "contacts", caller.organizationId, id)
    const choices = []
    for (const input of array(
      objectBody(JSON.parse(body)).topics,
      "topics",
      100
    )) {
      const topic = await own(
        ctx,
        "topics",
        caller.organizationId,
        stringField(input, "id", true)!
      )
      const subscription = enumField(input, "subscription", [
        "opt_in",
        "opt_out",
      ])
      if (!subscription) throw invalid("Missing topic subscription.")
      choices.push({
        topicId: topic._id,
        subscription:
          subscription === "opt_in"
            ? ("subscribed" as const)
            : ("unsubscribed" as const),
      })
    }
    await setTopicChoices(ctx, contact, choices)
    return contact._id
  },
})

export const relations = internalQuery({
  args: {
    caller: callerValue,
    id: v.string(),
    kind: v.union(
      v.literal("segments"),
      v.literal("topics"),
      v.literal("segmentContacts")
    ),
    ...listArgs,
  },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(rowValue),
    subscriptions: v.optional(
      v.array(v.union(v.literal("opt_in"), v.literal("opt_out")))
    ),
  }),
  handler: async (ctx, { caller, id, kind, ...page }) => {
    await requireCaller(ctx, caller)
    const org = caller.organizationId
    if (kind === "segmentContacts") {
      const segment = await own(ctx, "segments", org, id)
      const anchor = async (value: string) => {
        const contact = await own(ctx, "contacts", org, value)
        return ctx.db
          .query("segmentMembers")
          .withIndex("by_contactId_and_segmentId", (q) =>
            q.eq("contactId", contact._id).eq("segmentId", segment._id)
          )
          .unique()
      }
      const result = await cursorPage(
        page,
        async (value) => await anchor(value),
        (order) =>
          stream(ctx.db, schema)
            .query("segmentMembers")
            .withIndex("by_segmentId", (q) => {
              return q.eq("segmentId", segment._id)
            })
            .order(order)
      )
      const rows = await Promise.all(
        result.data.map((member) => ctx.db.get("contacts", member.contactId))
      )
      return {
        ...result,
        data: rows.filter((row): row is Doc<"contacts"> => row !== null),
      }
    }
    const contact = await own(ctx, "contacts", org, id)
    const result = await cursorPage<Doc<"segments"> | Doc<"topics">>(
      page,
      async (value) => {
        const row = await own(ctx, kind, org, value)
        if (kind === "segments") {
          const membership = await ctx.db
            .query("segmentMembers")
            .withIndex("by_contactId_and_segmentId", (q) =>
              q
                .eq("contactId", contact._id)
                .eq("segmentId", row._id as Doc<"segments">["_id"])
            )
            .unique()
          if (!membership) return null
        }
        return row
      },
      async (order) => {
        if (kind === "topics")
          return stream(ctx.db, schema)
            .query("topics")
            .withIndex("by_organizationId", (q) => {
              return q.eq("organizationId", org)
            })
            .order(order)
        // At most 500 segments exist per team, so hydration is bounded.
        const members = await ctx.db
          .query("segmentMembers")
          .withIndex("by_contactId_and_segmentId", (q) =>
            q.eq("contactId", contact._id)
          )
          .take(500)
        return (
          await Promise.all(
            members.map((member) => ctx.db.get("segments", member.segmentId))
          )
        ).filter((row): row is Doc<"segments"> => row !== null)
      }
    )
    if (kind !== "topics") return result
    const subscriptions = await Promise.all(
      result.data.map(async (row) => {
        const topic = row as Doc<"topics">
        const choice = await findTopicChoice(ctx, contact._id, topic._id)
        return effectiveTopicSubscription(choice?.subscription, topic) ===
          "subscribed"
          ? ("opt_in" as const)
          : ("opt_out" as const)
      })
    )
    return { ...result, subscriptions }
  },
})
function registerRelations(http: HttpRouter) {
  for (const kind of ["segments", "topics", "segmentContacts"] as const)
    apiRoute(http, {
      method: "GET",
      path:
        kind === "segmentContacts"
          ? "/segments/{id}/contacts"
          : `/contacts/{id}/${kind}`,
      permission: "full_access",
      handler: async (ctx, { caller, params, query }) => {
        const result = await ctx.runQuery(internal.api.audience.relations, {
          caller,
          id: params.id,
          kind,
          ...listParams(query),
        })
        return {
          body: {
            object: "list",
            has_more: result.has_more,
            data: result.data.map((row, index) =>
              kind === "topics" && "description" in row
                ? {
                    id: row._id,
                    name: row.name,
                    description: row.description,
                    subscription:
                      "subscriptions" in result
                        ? result.subscriptions[index]
                        : undefined,
                  }
                : summary(row)
            ),
          },
        }
      },
    })
  for (const method of ["POST", "DELETE"] as const)
    apiRoute(http, {
      method,
      path: "/contacts/{id}/segments/{segment}",
      permission: "full_access",
      handler: async (ctx, { caller, params }) => {
        const result = await ctx.runMutation(internal.api.audience.membership, {
          caller,
          id: params.id,
          segment: params.segment,
          member: method === "POST",
        })
        return {
          body:
            method === "POST"
              ? { id: result.segment }
              : {
                  object: "contact_segment",
                  id: result.contact,
                  audienceId: result.segment,
                  deleted: true,
                },
        }
      },
    })
  apiRoute(http, {
    method: "PATCH",
    path: "/contacts/{id}/topics",
    permission: "full_access",
    handler: async (ctx, { caller, params, body }) => ({
      body: {
        object: "contact_topics",
        id: await ctx.runMutation(internal.api.audience.subscriptions, {
          caller,
          id: params.id,
          body: JSON.stringify(body ?? {}),
        }),
      },
    }),
  })
}
