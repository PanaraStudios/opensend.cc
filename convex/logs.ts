import { v, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server"
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import { requireTeam } from "./access"
import schema from "./schema"
import { logSourceValue, statusClassValue } from "./tables/api"
import { logStatusClass } from "../lib/dashboard/logs"

/** Resend states no retention for request logs; keep them 30 days. */
export const LOG_RETENTION = 30 * 86_400_000
/** Bodies are stored up to this many characters, then cut and marked. */
const BODY_LIMIT = 65_536

type LogEntry = Pick<
  Doc<"apiLogs">,
  | "method"
  | "path"
  | "status"
  | "durationMs"
  | "userAgent"
  | "source"
  | "apiKeyId"
  | "oauthGrantId"
  | "emailId"
> &
  Pick<Doc<"apiLogBodies">, "requestHeaders"> & {
    requestBody?: string
    responseBody?: string
  }

const cut = (body: string | undefined) =>
  body === undefined || body.length <= BODY_LIMIT
    ? { body, cut: false }
    : { body: body.slice(0, BODY_LIMIT), cut: true }

/** Records one request. The REST router calls this for every request it
    can attribute to a team; dashboard and SMTP sends use it with their own
    `source`. */
export async function writeLog(
  ctx: MutationCtx,
  organizationId: string,
  entry: LogEntry
) {
  const { requestHeaders, requestBody, responseBody, ...row } = entry
  const logId = await ctx.db.insert("apiLogs", {
    ...row,
    organizationId,
    statusClass: logStatusClass(row.status),
    summary: `${row.method} ${row.path} ${row.status}`,
  })
  const request = cut(requestBody)
  const response = cut(responseBody)
  await ctx.db.insert("apiLogBodies", {
    logId,
    requestHeaders,
    requestBody: request.body,
    responseBody: response.body,
    ...(request.cut || response.cut ? { truncated: true } : {}),
  })
  return logId
}

export const logFilters = v.object({
  statusClass: v.optional(statusClassValue),
  source: v.optional(logSourceValue),
  userAgent: v.optional(v.string()),
  emailId: v.optional(v.string()),
  apiKeyId: v.optional(v.id("apiKeys")),
  search: v.optional(v.string()),
  /** The date range, from the client's clock. */
  from: v.optional(v.number()),
  to: v.optional(v.number()),
})
export type LogFilters = Infer<typeof logFilters>

/** Newest first. An index or the search index narrows each page; what they
    cannot express is dropped from the page afterwards, so a page may come
    back short and the client loads on. */
export async function logPage(
  ctx: QueryCtx,
  args: LogFilters & {
    organizationId: string
    paginationOpts: PaginationOptions
  }
) {
  const org = args.organizationId
  const logs = ctx.db.query("apiLogs")
  const search = args.search?.trim().slice(0, 200)
  const from = args.from ?? 0
  const to = args.to ?? Number.MAX_SAFE_INTEGER
  const result = search
    ? await logs
        .withSearchIndex("search_summary", (q) => {
          let s = q.search("summary", search).eq("organizationId", org)
          if (args.statusClass) s = s.eq("statusClass", args.statusClass)
          if (args.source) s = s.eq("source", args.source)
          if (args.userAgent) s = s.eq("userAgent", args.userAgent)
          if (args.emailId) s = s.eq("emailId", args.emailId)
          if (args.apiKeyId) s = s.eq("apiKeyId", args.apiKeyId)
          return s
        })
        .paginate(args.paginationOpts)
    : await (
        args.emailId
          ? logs.withIndex("by_organizationId_and_emailId", (q) =>
              q
                .eq("organizationId", org)
                .eq("emailId", args.emailId)
                .gte("_creationTime", from)
                .lte("_creationTime", to)
            )
          : args.apiKeyId
            ? logs.withIndex("by_organizationId_and_apiKeyId", (q) =>
                q
                  .eq("organizationId", org)
                  .eq("apiKeyId", args.apiKeyId)
                  .gte("_creationTime", from)
                  .lte("_creationTime", to)
              )
            : args.statusClass && args.source
              ? logs.withIndex(
                  "by_organizationId_and_statusClass_and_source",
                  (q) =>
                    q
                      .eq("organizationId", org)
                      .eq("statusClass", args.statusClass!)
                      .eq("source", args.source!)
                      .gte("_creationTime", from)
                      .lte("_creationTime", to)
                )
              : args.statusClass
                ? logs.withIndex("by_organizationId_and_statusClass", (q) =>
                    q
                      .eq("organizationId", org)
                      .eq("statusClass", args.statusClass!)
                      .gte("_creationTime", from)
                      .lte("_creationTime", to)
                  )
                : args.source
                  ? logs.withIndex("by_organizationId_and_source", (q) =>
                      q
                        .eq("organizationId", org)
                        .eq("source", args.source!)
                        .gte("_creationTime", from)
                        .lte("_creationTime", to)
                    )
                  : logs.withIndex("by_organizationId", (q) =>
                      q
                        .eq("organizationId", org)
                        .gte("_creationTime", from)
                        .lte("_creationTime", to)
                    )
      )
        .order("desc")
        .paginate(args.paginationOpts)
  return {
    ...result,
    page: result.page.filter(
      (log) =>
        log._creationTime >= from &&
        log._creationTime <= to &&
        (!args.statusClass || log.statusClass === args.statusClass) &&
        (!args.source || log.source === args.source) &&
        (!args.userAgent || log.userAgent === args.userAgent)
    ),
  }
}
export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    ...logFilters.fields,
  },
  returns: paginationResultValidator(schema.doc("apiLogs")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return logPage(ctx, args)
  },
})

/** Whether the team has any request logged, whatever the list's filters:
    the list says "No logs yet" only when it has none. */
export const hasAny = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    const first = await ctx.db
      .query("apiLogs")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .first()
    return first !== null
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      log: schema.doc("apiLogs"),
      body: v.union(v.null(), schema.doc("apiLogBodies")),
      apiKey: v.union(
        v.null(),
        schema.doc("apiKeys").pick("_id", "name", "permission")
      ),
    })
  ),
  handler: async (ctx, { id }) => {
    const logId = ctx.db.normalizeId("apiLogs", id)
    const log = logId ? await ctx.db.get("apiLogs", logId) : null
    if (!log) return null
    await requireTeam(ctx, log.organizationId)
    const body = await ctx.db
      .query("apiLogBodies")
      .withIndex("by_logId", (q) => q.eq("logId", log._id))
      .unique()
    const key = log.apiKeyId ? await ctx.db.get("apiKeys", log.apiKeyId) : null
    return {
      log,
      body,
      apiKey: key
        ? { _id: key._id, name: key.name, permission: key.permission }
        : null,
    }
  },
})

/** Deletes logs past retention, a batch at a time. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query("apiLogs")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - LOG_RETENTION)
      )
      .take(200)
    for (const log of old) {
      const body = await ctx.db
        .query("apiLogBodies")
        .withIndex("by_logId", (q) => q.eq("logId", log._id))
        .unique()
      if (body) await ctx.db.delete("apiLogBodies", body._id)
      await ctx.db.delete("apiLogs", log._id)
    }
    if (old.length === 200)
      await ctx.scheduler.runAfter(0, internal.logs.prune, {})
    return null
  },
})
