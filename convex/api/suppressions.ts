import { v } from "convex/values"
import { stream } from "convex-helpers/server/stream"
import type { HttpRouter } from "convex/server"
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import schema from "../schema"
import {
  findSuppression,
  removeSuppression,
  suppressionData,
  upsertSuppression,
} from "../suppressions"
import { suppressionReasonValue } from "../tables/emails"
import { isEmail } from "../../lib/dashboard/format"
import {
  callerValue,
  requireCaller,
  invalid,
  missing,
  requireTeamRow,
} from "./caller"
import { cursorPage, listArgs } from "./paging"
import { idempotent } from "./idempotency"
import {
  listBody,
  apiRoute,
  apiTime,
  enumField,
  listParams,
  objectBody,
  stringField,
} from "./route"

function own(ctx: QueryCtx, organizationId: string, value: string) {
  return requireTeamRow(
    ctx,
    "suppressions",
    organizationId,
    value,
    "Suppression",
    {
      fallback: () =>
        findSuppression(ctx, organizationId, value.trim().toLowerCase()),
    }
  )
}
function email(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!isEmail(normalized)) throw invalid("Invalid email address.")
  return normalized
}
function batch(body: unknown, remove = false) {
  const input = objectBody(body)
  if (remove && (input.emails === undefined) === (input.ids === undefined))
    throw invalid("Provide either `emails` or `ids`, but not both.")
  const field = remove && input.ids !== undefined ? "ids" : "emails"
  const values = input[field]
  if (values === undefined) throw missing(field)
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > 100 ||
    !values.every((x): x is string => typeof x === "string" && x.length > 0)
  )
    throw invalid(
      `The \`${field}\` field must contain between 1 and 100 strings.`
    )
  return field === "emails" ? values.map(email) : values
}
const reference = (id: string) => ({ object: "suppression" as const, id })
const resultValue = v.object({
  object: v.literal("suppression"),
  id: v.string(),
  deleted: v.optional(v.boolean()),
})
export const write = internalMutation({
  args: {
    caller: callerValue,
    values: v.array(v.string()),
    remove: v.boolean(),
    batch: v.boolean(),
  },
  returns: v.array(resultValue),
  handler: async (ctx, { caller, values, remove, batch }) => {
    await requireCaller(ctx, caller)
    if (!values.length || values.length > 100)
      throw invalid("Expected 1–100 suppressions.")
    return idempotent(
      ctx,
      caller,
      async () => {
        // Resolve the whole removal set first: a foreign or missing id rolls back everything.
        const rows = remove
          ? await Promise.all(
              values.map((value) => own(ctx, caller.organizationId, value))
            )
          : []
        const data = []
        const removed = new Set<string>()
        for (let i = 0; i < values.length; i++) {
          if (remove) {
            const row = rows[i]
            if (!removed.has(row._id)) await removeSuppression(ctx, row)
            removed.add(row._id)
            data.push({ ...reference(row._id), deleted: true })
          } else {
            const id = await upsertSuppression(
              ctx,
              caller.organizationId,
              email(values[i]),
              "manual"
            )
            data.push(reference(id))
          }
        }
        return data
      },
      (data) => ({
        body: batch ? { data } : data[0],
        status: remove ? 200 : 201,
      })
    )
  },
})
export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: schema.doc("suppressions"),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    return own(ctx, caller.organizationId, id)
  },
})
export const list = internalQuery({
  args: {
    caller: callerValue,
    ...listArgs,
    reason: v.optional(suppressionReasonValue),
  },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("suppressions")),
  }),
  handler: async (ctx, { caller, reason, ...page }) => {
    await requireCaller(ctx, caller)
    return cursorPage(
      page,
      async (id) => {
        try {
          const row = await own(ctx, caller.organizationId, id)
          return reason && row.reason !== reason ? null : row
        } catch {
          return null
        }
      },
      (order) => {
        const rows = stream(ctx.db, schema).query("suppressions")
        return (
          reason
            ? rows.withIndex("by_organizationId_and_reason", (q) =>
                q
                  .eq("organizationId", caller.organizationId)
                  .eq("reason", reason)
              )
            : rows.withIndex("by_organizationId", (q) =>
                q.eq("organizationId", caller.organizationId)
              )
        ).order(order)
      }
    )
  },
})
const project = (row: Parameters<typeof suppressionData>[0]) => ({
  ...suppressionData(row),
  created_at: apiTime(row._creationTime),
})
export function registerSuppressionRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/suppressions",
    permission: "full_access",
    handler: async (ctx, { caller, body }) => ({
      status: 201,
      body: (
        await ctx.runMutation(internal.api.suppressions.write, {
          caller,
          values: [email(stringField(objectBody(body), "email", true)!)],
          remove: false,
          batch: false,
        })
      )[0],
    }),
  })
  for (const remove of [false, true])
    apiRoute(http, {
      method: "POST",
      path: `/suppressions/batch/${remove ? "remove" : "add"}`,
      permission: "full_access",
      handler: async (ctx, { caller, body }) => ({
        status: remove ? 200 : 201,
        body: {
          data: await ctx.runMutation(internal.api.suppressions.write, {
            caller,
            values: batch(body, remove),
            remove,
            batch: true,
          }),
        },
      }),
    })
  apiRoute(http, {
    method: "GET",
    path: "/suppressions",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const origin = enumField(
        { origin: query.get("origin") ?? undefined },
        "origin",
        ["bounce", "complaint", "manual"]
      )
      const page = await ctx.runQuery(internal.api.suppressions.list, {
        caller,
        ...listParams(query),
        reason:
          origin === "bounce"
            ? "bounced"
            : origin === "complaint"
              ? "complained"
              : origin,
      })
      return { body: listBody(page, project) }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/suppressions/{suppression}",
    permission: "full_access",
    handler: async (ctx, { caller, params }) => ({
      body: {
        object: "suppression",
        ...project(
          await ctx.runQuery(internal.api.suppressions.get, {
            caller,
            id: params.suppression,
          })
        ),
      },
    }),
  })
  apiRoute(http, {
    method: "DELETE",
    path: "/suppressions/{suppression}",
    permission: "full_access",
    handler: async (ctx, { caller, params }) => ({
      body: (
        await ctx.runMutation(internal.api.suppressions.write, {
          caller,
          values: [params.suppression],
          remove: true,
          batch: false,
        })
      )[0],
    }),
  })
}
