import { normalizePropertyKey } from "../../lib/dashboard/contacts"
import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import schema from "../schema"
import type { Doc } from "../_generated/dataModel"
import { enqueueImport } from "../contactImports"
import { createProperty } from "../contactProperties"
import { listProperties } from "../audience"
import { parseCsv, parseUnsubscribed } from "../../lib/dashboard/csv"
import { own } from "./audience"
import { apiError, callerValue, notFound, requireCaller } from "./caller"
import {
  apiRoute,
  apiTime,
  enumField,
  listParams,
  objectBody,
  stringField,
} from "./route"
import { cursorPage, listArgs } from "./paging"
import { idempotent } from "./idempotency"

const invalid = (message: string) => apiError(422, "validation_error", message)
const statuses = ["queued", "in_progress", "completed", "failed"] as const
const statusValue = v.union(...statuses.map((s) => v.literal(s)))
function jsonField(
  input: Record<string, unknown>,
  name: string,
  fallback: unknown
): unknown {
  const text = stringField(input, name)
  if (text === undefined) return fallback
  try {
    return JSON.parse(text)
  } catch {
    throw invalid(`The ${name} field must contain valid JSON.`)
  }
}
async function owned(ctx: QueryCtx, organizationId: string, value: string) {
  const id = ctx.db.normalizeId("contactImports", value)
  const row = id ? await ctx.db.get("contactImports", id) : null
  if (!row || row.organizationId !== organizationId)
    throw notFound("Contact import")
  return row
}
export const create = internalMutation({
  args: { caller: callerValue, body: v.string() },
  returns: v.id("contactImports"),
  handler: async (ctx, { caller, body }) => {
    await requireCaller(ctx, caller)
    return idempotent(
      ctx,
      caller,
      async () => {
        const input = objectBody(JSON.parse(body))
        const csv = stringField(input, "file", true)!
        let table: ReturnType<typeof parseCsv>
        try {
          table = parseCsv(csv)
        } catch {
          throw invalid("Invalid CSV file.")
        }
        if (!table.rows.length || table.rows.length > 500)
          throw invalid("Imports support 1–500 CSV rows per request.")
        if (new Set(table.headers).size !== table.headers.length)
          throw invalid("CSV column names must be unique.")
        const map = objectBody(jsonField(input, "column_map", {}))
        const column = (field: string, mapping: unknown, required = false) => {
          if (mapping !== undefined && typeof mapping !== "string")
            throw invalid(`Invalid column mapping for ${field}.`)
          const index =
            mapping === undefined
              ? table.headers.findIndex((h) => h.toLowerCase() === field)
              : table.headers.indexOf(mapping as string)
          if (index < 0 && (required || mapping !== undefined))
            throw invalid(`CSV column for ${field} was not found.`)
          return index
        }
        const email = column("email", map.email, true)
        const first = column("first_name", map.first_name)
        const last = column("last_name", map.last_name)
        const unsubscribed = column("unsubscribed", map.unsubscribed)
        const propertyMap = objectBody(map.properties)
        const existing = await listProperties(ctx, caller.organizationId)
        if (Object.keys(propertyMap).length > 100)
          throw invalid("Imports support at most 100 properties.")
        const properties: { key: string; index: number }[] = []
        for (const [rawKey, value] of Object.entries(propertyMap)) {
          const key = normalizePropertyKey(rawKey)
          if (properties.some((p) => p.key === key))
            throw invalid(`Duplicate property mapping: ${key}.`)
          const mapping = objectBody(value)
          const type =
            enumField(mapping, "type", ["string", "number"]) ?? "string"
          const index = column(key, stringField(mapping, "column", true), true)
          const property = existing.find((p) => p.key === key)
          if (property && property.type !== type)
            throw invalid(`Property ${key} has a different type.`)
          if (!property)
            await createProperty(ctx, {
              organizationId: caller.organizationId,
              key,
              name: key,
              type,
            })
          properties.push({ key, index })
        }
        const segments = jsonField(input, "segments", [])
        const topics = jsonField(input, "topics", [])
        if (
          !Array.isArray(segments) ||
          segments.length > 100 ||
          !Array.isArray(topics) ||
          topics.length > 100
        )
          throw invalid("Imports support at most 100 segments and 100 topics.")
        const segmentIds = []
        for (const value of segments)
          segmentIds.push(
            (
              await own(
                ctx,
                "segments",
                caller.organizationId,
                stringField(objectBody(value), "id", true)!
              )
            )._id
          )
        const choices = []
        for (const value of topics) {
          const choice = objectBody(value)
          const topic = await own(
            ctx,
            "topics",
            caller.organizationId,
            stringField(choice, "id", true)!
          )
          const subscription = enumField(choice, "subscription", [
            "opt_in",
            "opt_out",
          ])
          if (!subscription) throw invalid("A topic subscription is required.")
          choices.push({
            topicId: topic._id,
            subscription:
              subscription === "opt_in"
                ? ("subscribed" as const)
                : ("unsubscribed" as const),
          })
        }
        if (
          unsubscribed >= 0 &&
          table.rows.some(
            (row) =>
              row[unsubscribed] &&
              parseUnsubscribed(row[unsubscribed]) === undefined
          )
        )
          throw invalid("Invalid unsubscribed value in CSV; use true or false.")
        const contacts = table.rows.map((row) => ({
          email: row[email],
          ...(first < 0 ? {} : { firstName: row[first] }),
          ...(last < 0 ? {} : { lastName: row[last] }),
          ...(unsubscribed < 0
            ? {}
            : { unsubscribed: parseUnsubscribed(row[unsubscribed]) }),
          properties: Object.fromEntries(
            properties.map((p) => [p.key, row[p.index]])
          ),
        }))
        const result = await enqueueImport(ctx, {
          organizationId: caller.organizationId,
          contacts,
          segmentIds: [...new Set(segmentIds)],
          topics: choices,
          skipExisting:
            enumField(input, "on_conflict", ["upsert", "skip"]) === "skip",
        })
        return result.jobId
      },
      (id) => ({ status: 201, body: { object: "contact_import", id } })
    )
  },
})
export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: schema.doc("contactImports"),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    return owned(ctx, caller.organizationId, id)
  },
})
export const list = internalQuery({
  args: { caller: callerValue, ...listArgs, status: v.optional(statusValue) },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("contactImports").omit("contacts")),
  }),
  handler: async (ctx, { caller, status, ...page }) => {
    await requireCaller(ctx, caller)
    if (status === "queued") return { has_more: false, data: [] }
    const storedStatus = status === "in_progress" ? "processing" : status
    let scanHasMore = false
    const result = await cursorPage(
      page,
      async (value) => {
        const id = ctx.db.normalizeId("contactImports", value)
        const row = id ? await ctx.db.get("contactImports", id) : null
        return row?.organizationId === caller.organizationId &&
          (!storedStatus || row.status === storedStatus)
          ? row._creationTime
          : null
      },
      async (bound, order, count) => {
        const query = storedStatus
          ? ctx.db
              .query("contactImports")
              .withIndex("by_organizationId_and_status", (q) => {
                const base = q
                  .eq("organizationId", caller.organizationId)
                  .eq("status", storedStatus)
                return bound.lt !== undefined
                  ? base.lt("_creationTime", bound.lt)
                  : bound.gt !== undefined
                    ? base.gt("_creationTime", bound.gt)
                    : base
              })
          : ctx.db
              .query("contactImports")
              .withIndex("by_organizationId", (q) => {
                const base = q.eq("organizationId", caller.organizationId)
                return bound.lt !== undefined
                  ? base.lt("_creationTime", bound.lt)
                  : bound.gt !== undefined
                    ? base.gt("_creationTime", bound.gt)
                    : base
              })
        const scanned = await query.order(order).paginate({
          numItems: count,
          cursor: null,
          maximumBytesRead: 4 * 1024 * 1024,
        })
        scanHasMore = !scanned.isDone
        return scanned.page
      }
    )
    return {
      ...result,
      has_more: result.has_more || scanHasMore,
      data: result.data.map(({ contacts, ...row }) => {
        void contacts
        return row
      }),
    }
  },
})
function view(row: Omit<Doc<"contactImports">, "contacts">) {
  const failed = row.failedCount ?? 0
  return {
    object: "contact_import",
    id: row._id,
    status: row.status === "processing" ? "in_progress" : row.status,
    created_at: apiTime(row._creationTime),
    completed_at:
      row.completedAt === undefined ? null : apiTime(row.completedAt),
    counts: {
      total: row.offset,
      created: row.result.created,
      updated: row.result.updated,
      skipped: row.result.skipped - failed,
      failed,
    },
  }
}
export function registerImportRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/contacts/imports",
    permission: "full_access",
    bodyFormat: "multipart",
    handler: async (ctx, { caller, body }) => ({
      status: 201,
      body: {
        object: "contact_import",
        id: await ctx.runMutation(internal.api.imports.create, {
          caller,
          body: JSON.stringify(body ?? {}),
        }),
      },
    }),
  })
  apiRoute(http, {
    method: "GET",
    path: "/contacts/imports",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const result = await ctx.runQuery(internal.api.imports.list, {
        caller,
        ...listParams(query),
        status: enumField({ status: query.get("status") }, "status", statuses),
      })
      return {
        body: {
          object: "list",
          has_more: result.has_more,
          data: result.data.map(view),
        },
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/contacts/imports/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params }) => ({
      body: view(
        await ctx.runQuery(internal.api.imports.get, { caller, id: params.id })
      ),
    }),
  })
}
