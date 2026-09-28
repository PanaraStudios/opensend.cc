import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import { internalQuery } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import schema from "../schema"
import { callerValue, notFound, requireCaller } from "./caller"
import { cursorPage, listArgs } from "./paging"
import { apiRoute, apiTime, listParams } from "./route"
import { responseForLog } from "../logs"
import { storedBody } from "../../lib/dashboard/logs"

export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("apiLogs")),
  }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    const org = caller.organizationId
    return cursorPage(
      page,
      async (id) => {
        const logId = ctx.db.normalizeId("apiLogs", id)
        const log = logId ? await ctx.db.get("apiLogs", logId) : null
        return log?.organizationId === org ? log._creationTime : null
      },
      (bound, order, count) =>
        ctx.db
          .query("apiLogs")
          .withIndex("by_organizationId", (q) =>
            bound.lt !== undefined
              ? q.eq("organizationId", org).lt("_creationTime", bound.lt)
              : bound.gt !== undefined
                ? q.eq("organizationId", org).gt("_creationTime", bound.gt)
                : q.eq("organizationId", org)
          )
          .order(order)
          .take(count)
    )
  },
})
export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      log: schema.doc("apiLogs"),
      body: v.union(v.null(), schema.doc("apiLogBodies")),
    })
  ),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    const logId = ctx.db.normalizeId("apiLogs", id)
    const log = logId ? await ctx.db.get("apiLogs", logId) : null
    if (!log || log.organizationId !== caller.organizationId) return null
    const body = await ctx.db
      .query("apiLogBodies")
      .withIndex("by_logId", (q) => q.eq("logId", log._id))
      .unique()
    return {
      log,
      body: body
        ? {
            ...body,
            responseBody: responseForLog(
              log.path,
              log.method,
              body.responseBody
            ),
          }
        : null,
    }
  },
})

const summary = (log: Doc<"apiLogs">) => ({
  id: log._id,
  created_at: apiTime(log._creationTime),
  endpoint: log.path,
  method: log.method,
  response_status: log.status,
  user_agent: log.userAgent,
})
/** `/logs`, as Resend documents it. */
export function registerLogRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/logs",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const page = await ctx.runQuery(internal.api.logs.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: {
          object: "list",
          has_more: page.has_more,
          data: page.data.map(summary),
        },
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/logs/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params }) => {
      const found = await ctx.runQuery(internal.api.logs.get, {
        caller,
        id: params.id,
      })
      if (!found) throw notFound("Log")
      return {
        body: {
          object: "log",
          ...summary(found.log),
          request_body: storedBody(found.body?.requestBody),
          response_body: storedBody(found.body?.responseBody),
        },
      }
    },
  })
}
