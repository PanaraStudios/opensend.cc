import { stream } from "convex-helpers/server/stream"
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
import { countValue, counters, deleteRow, insertRow, literals } from "./counts"
import { filteredPage, matchesSearch, readTeamRow, hasTeamRows } from "./lists"

/** Resend states no retention for request logs; keep them 30 days. */
export const LOG_RETENTION = 30 * 86_400_000
/** Bodies are stored up to this many characters, then cut and marked. */
const BODY_LIMIT = 65_536
const PRUNE_BATCH = 8

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

export function responseForLog(path: string, method: string, body?: string) {
  // Include legacy IVR read/update responses as well as creation and rotation.
  if (body && /^\/ivrs(?:\/|$)/.test(path)) {
    try {
      const mask = (input: unknown): unknown => {
        if (!input || typeof input !== "object" || Array.isArray(input))
          return input
        const value = input as Record<string, unknown>
        return {
          ...value,
          ...("webhook_signing_secret" in value
            ? { webhook_signing_secret: "[redacted]" }
            : {}),
          ...(Array.isArray(value.data) ? { data: value.data.map(mask) } : {}),
        }
      }
      return JSON.stringify(mask(JSON.parse(body)))
    } catch {
      return "[redacted]"
    }
  }
  if (method === "POST" && /^\/emails\/[^/]+\/share$/.test(path))
    return "[redacted]"
  // Responses that carry a secret: key and webhook creation, secret
  // rotation, and webhook retrieval.
  const field =
    method === "POST" && path === "/api-keys"
      ? "token"
      : (method === "POST" &&
            (path === "/webhooks" ||
              /^\/webhooks\/[^/]+\/signing-secret\/rotate$/.test(path))) ||
          (method === "GET" && /^\/webhooks\/[^/]+$/.test(path))
        ? "signing_secret"
        : null
  if (!field || !body) return body
  try {
    const value: unknown = JSON.parse(body)
    if (value && typeof value === "object" && !Array.isArray(value))
      return JSON.stringify({
        ...value,
        ...(field in value ? { [field]: "[redacted]" } : {}),
      })
  } catch {
    // Legacy bodies may have been truncated in the middle of a secret.
  }
  return "[redacted]"
}

/** Records one request. The REST router calls this for every request it
    can attribute to a team; dashboard and SMTP sends use it with their own
    `source`. */
export async function writeLog(
  ctx: MutationCtx,
  organizationId: string,
  entry: LogEntry
) {
  const { requestHeaders, requestBody, responseBody, ...row } = entry
  const logId = await insertRow(ctx, "apiLogs", {
    ...row,
    organizationId,
    statusClass: logStatusClass(row.status),
    summary: `${row.method} ${row.path} ${row.status}`,
  })
  const request = cut(requestBody)
  const response = cut(responseForLog(row.path, row.method, responseBody))
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

// 1024 small summaries, no hydration; 4 MiB leaves 12 MiB for overhead.
export const LOG_SEARCH_BUDGET = { rows: 1024, bytes: 4 * 1024 * 1024 }

/** Newest first; remaining filters narrow each bounded index page. */
export async function logPage(
  ctx: QueryCtx,
  args: LogFilters & {
    organizationId: string
    paginationOpts: PaginationOptions
  }
) {
  const org = args.organizationId
  const logs = stream(ctx.db, schema).query("apiLogs")
  const search = args.search
  const from = args.from ?? 0
  const to = args.to ?? Number.MAX_SAFE_INTEGER
  const rows = (
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
  ).order("desc")

  const matches = matchesSearch(search)
  return filteredPage(
    rows,
    args.paginationOpts,
    (log) =>
      log._creationTime >= from &&
      log._creationTime <= to &&
      (!args.statusClass || log.statusClass === args.statusClass) &&
      (!args.source || log.source === args.source) &&
      (!args.userAgent || log.userAgent === args.userAgent) &&
      (!args.emailId || log.emailId === args.emailId) &&
      (!args.apiKeyId || log.apiKeyId === args.apiKeyId) &&
      matches(log.summary),
    LOG_SEARCH_BUDGET,
    search
  )
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

/** How many requests the filters match: by status and source over whole
    days, for the team or one key. A search, user agent or email is not
    counted. */
export async function logCount(
  ctx: QueryCtx,
  args: LogFilters & { organizationId: string }
) {
  if (args.search?.trim() || args.userAgent || args.emailId) return null
  const parts = [
    { is: args.statusClass, among: literals(statusClassValue) },
    { is: args.source, among: literals(logSourceValue) },
  ]
  const range = { from: args.from, to: args.to }
  if (!args.apiKeyId)
    return counters.apiLogs.total(ctx, args.organizationId, parts, range)
  const key = await ctx.db.get("apiKeys", args.apiKeyId)
  if (key?.organizationId !== args.organizationId) return 0
  return counters.apiKeyLogs.total(ctx, key._id, parts, range)
}
export const count = query({
  args: { organizationId: v.string(), ...logFilters.fields },
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return { total: await logCount(ctx, args) }
  },
})

/** Whether the team has any request logged, whatever the list's filters:
    the list says "No logs yet" only when it has none. */
export const hasAny = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: (ctx, { organizationId }) =>
    hasTeamRows(ctx, "apiLogs", organizationId),
})

/** Seek past each distinct agent, so duplicate requests and the loaded page
    cannot crowd other agents out. At most 100 index reads per team. */
export const userAgents = query({
  args: { organizationId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    const agents: string[] = []
    let after: string | undefined
    while (agents.length < 100) {
      const next = await ctx.db
        .query("apiLogs")
        .withIndex("by_organizationId_and_userAgent", (q) =>
          after === undefined
            ? q.eq("organizationId", organizationId)
            : q.eq("organizationId", organizationId).gt("userAgent", after)
        )
        .first()
      if (!next) break
      agents.push(next.userAgent)
      after = next.userAgent
    }
    return agents
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
    const log = await readTeamRow(ctx, "apiLogs", id)
    if (!log) return null
    const body = await ctx.db
      .query("apiLogBodies")
      .withIndex("by_logId", (q) => q.eq("logId", log._id))
      .unique()
    const key = log.apiKeyId ? await ctx.db.get("apiKeys", log.apiKeyId) : null
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
      .take(PRUNE_BATCH)
    for (const log of old) {
      const body = await ctx.db
        .query("apiLogBodies")
        .withIndex("by_logId", (q) => q.eq("logId", log._id))
        .unique()
      if (body) await ctx.db.delete("apiLogBodies", body._id)
      await deleteRow(ctx, "apiLogs", log._id)
    }
    if (old.length === PRUNE_BATCH)
      await ctx.scheduler.runAfter(0, internal.logs.prune, {})
    return null
  },
})
