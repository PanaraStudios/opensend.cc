import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import { internalQuery } from "../_generated/server"
import { internal } from "../_generated/api"
import { checkSpans, countsFor, type Counts } from "../metrics"
import type { Id } from "../_generated/dataModel"
import { callerValue, notFound, requireCaller, invalid } from "./caller"
import { apiRoute, queryValues } from "./route"

// Historical aggregates retain unique milestones, not repeated engagements or unsubscriptions.
export const supportedMetrics = [
  "delivery_delayed",
  "received",
  "sent",
  "delivered",
  "complained",
  "suppressed",
  "bounced",
  "bounced_transient",
  "bounced_permanent",
  "bounced_undetermined",
  "failed",
  "unique_opened",
  "unique_clicked",
  "delivery_rate",
  "open_rate",
  "click_rate",
  "bounce_rate",
  "complaint_rate",
] as const
const zero = (): Counts => ({
  sent: 0,
  delivered: 0,
  complained: 0,
  bounced: 0,
  opened: 0,
  clicked: 0,
  Permanent: 0,
  Transient: 0,
  Undetermined: 0,
  status: {},
  delivery_delayed: 0,
  failed: 0,
  suppressed: 0,
})
function sum(target: Counts, source: Counts) {
  for (const key of ["delivery_delayed", "failed", "suppressed"] as const)
    target[key] = (target[key] ?? 0) + (source[key] ?? 0)
  for (const key of [
    "sent",
    "delivered",
    "complained",
    "bounced",
    "opened",
    "clicked",
    "Permanent",
    "Transient",
    "Undetermined",
  ] as const)
    target[key] += source[key]
  for (const [key, value] of Object.entries(source.status))
    target.status[key] = (target.status[key] ?? 0) + value
}
function project(c: Counts, metrics: string[]) {
  const rate = (n: number, d: number) =>
    d ? Math.round((n / d) * 10000) / 100 : 0
  const all: Record<string, number> = {
    received: Object.values(c.status).reduce((a, b) => a + b, 0),
    sent: c.sent,
    delivered: c.delivered,
    complained: c.complained,
    suppressed: c.suppressed ?? 0,
    delivery_delayed: c.delivery_delayed ?? 0,
    failed: c.failed ?? 0,
    bounced: c.bounced,
    bounced_transient: c.Transient,
    bounced_permanent: c.Permanent,
    bounced_undetermined: c.Undetermined,
    unique_opened: c.opened,
    unique_clicked: c.clicked,
    delivery_rate: rate(c.delivered, c.sent),
    open_rate: rate(c.opened, c.delivered),
    click_rate: rate(c.clicked, c.delivered),
    bounce_rate: rate(c.bounced, c.sent),
    complaint_rate: rate(c.complained, c.delivered),
  }
  return Object.fromEntries(metrics.map((m) => [m, all[m]]))
}
const BUCKET = 900_000
function date(value: string | null, fallback: number) {
  if (value === null) return fallback
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value
    )
  )
    throw invalid("Dates must use ISO 8601 format.")
  const result = Date.parse(value)
  if (
    !Number.isFinite(result) ||
    new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !==
      value.slice(0, 10)
  )
    throw invalid("Invalid metrics date range.")
  return result
}
/** Work in 15-minute aggregate buckets, labeling each in the requested IANA zone.
 * This handles non-hour offsets and both sides of DST without fixed-length local days. */
export function metricsRequest(query: URLSearchParams) {
  const timezone = query.get("timezone") ?? "UTC"
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
  } catch {
    throw invalid("Invalid timezone.")
  }
  const granularity = query.get("granularity") ?? "daily"
  if (!["hourly", "daily", "weekly", "monthly"].includes(granularity))
    throw invalid("Invalid granularity.")
  const dimensions = queryValues(query, "dimensions")
  for (const d of dimensions)
    if (!["period", "domain"].includes(d))
      throw invalid(
        `Unsupported metrics dimension: ${d}. Available dimensions are period and domain.`
      )
  for (const key of ["email_id", "broadcast_id"])
    if (queryValues(query, key).length)
      throw invalid(
        `Unsupported metrics filter: ${key}; historical aggregates are scoped by team and domain.`
      )
  const requested = queryValues(query, "metrics")
  const metrics = requested.length ? requested : [...supportedMetrics]
  for (const metric of metrics)
    if (!(supportedMetrics as readonly string[]).includes(metric))
      throw invalid(
        `Unsupported metric: ${metric}. Historical aggregates retain unique opens/clicks; repeated events and unsubscriptions are unavailable.`
      )
  const domains = queryValues(query, "domain_id")
  if (domains.length > 100) throw invalid("At most 100 domain IDs are allowed.")
  const now = Date.now()
  const end = Math.min(date(query.get("end_date"), now), now)
  const start = date(
    query.get("start_date"),
    Math.floor(end / 86400000) * 86400000 - 6 * 86400000
  )
  if (start > end || end - start > 366 * 86400000)
    throw invalid(
      "Metrics support a date range of at most one year, with start_date on or before end_date."
    )
  // Date-only ranges include the entire end date. Datetimes use 15-minute precision.
  const upper = Math.min(
    query.get("end_date")?.length === 10 ? end + 86400000 : end + 1,
    now + 1
  )
  const from = Math.floor(start / BUCKET) * BUCKET
  const to = Math.ceil(upper / BUCKET) * BUCKET - 1
  const spans: { from: number; to: number; period: string }[] = []
  if (!dimensions.includes("period"))
    spans.push({ from, to: Math.max(from + BUCKET - 1, to), period: "" })
  else
    for (let at = from; at <= to; at += BUCKET) {
      const parts = Object.fromEntries(
        format.formatToParts(at).map((p) => [p.type, p.value])
      )
      let period = `${parts.year}-${parts.month}-${parts.day}`
      if (granularity === "hourly")
        period += `T${parts.hour}:00:00${parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.replace("GMT", "")}`
      if (granularity === "monthly") period = `${parts.year}-${parts.month}-01`
      if (granularity === "weekly") {
        const day = new Date(`${period}T00:00:00Z`)
        day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
        period = day.toISOString().slice(0, 10)
      }
      const previous = spans[spans.length - 1]
      if (previous?.period === period) previous.to = at + BUCKET - 1
      else spans.push({ from: at, to: at + BUCKET - 1, period })
      if (spans.length > 31)
        throw invalid(
          "Metrics support at most 31 periods per query. Choose a coarser granularity or shorter date range."
        )
    }
  checkSpans(spans)
  return {
    start_date: new Date(start).toISOString(),
    end_date: new Date(end).toISOString(),
    metrics,
    dimensions,
    granularity,
    domains,
    spans,
  }
}
export const get = internalQuery({
  args: { caller: callerValue, query: v.string() },
  returns: v.string(),
  handler: async (ctx, { caller, query }) => {
    await requireCaller(ctx, caller)
    const request = metricsRequest(new URLSearchParams(query))
    const { spans, metrics, dimensions } = request
    const domains: { id?: Id<"domains">; name?: string }[] = []
    for (const value of request.domains) {
      const id = ctx.db.normalizeId("domains", value)
      const row = id ? await ctx.db.get("domains", id) : null
      if (!row || row.organizationId !== caller.organizationId)
        throw notFound("Domain")
      domains.push({ id: row._id, name: row.name })
    }
    if (!domains.length && dimensions.includes("domain")) {
      const rows = await ctx.db
        .query("domains")
        .withIndex("by_organizationId_and_name", (q) =>
          q.eq("organizationId", caller.organizationId)
        )
        .take(101)
      if (rows.length > 100)
        throw invalid(
          "Specify domain_id to query installations with more than 100 sending domains."
        )
      domains.push(...rows.map((row) => ({ id: row._id, name: row.name })))
    } else if (!domains.length) domains.push({})
    // Bound total aggregate fan-out, including multi-domain requests.
    if (domains.length * spans.length > 31)
      throw invalid("Metrics support at most 31 domain-period spans per query.")
    const total = zero()
    const data: Record<string, string | number>[] = []
    const combined = spans.map(() => zero())
    for (const domain of domains) {
      const counts = await countsFor(
        ctx,
        { organizationId: caller.organizationId, domainId: domain.id },
        spans,
        true
      )
      counts.forEach((count, i) => {
        sum(total, count)
        sum(combined[i], count)
        if (dimensions.includes("domain"))
          data.push({
            ...(dimensions.includes("period")
              ? { period: spans[i].period }
              : {}),
            domain_id: domain.id!,
            domain_name: domain.name!,
            ...project(count, metrics),
          })
      })
    }
    if (dimensions.includes("period") && !dimensions.includes("domain"))
      combined.forEach((c, i) =>
        data.push({ period: spans[i].period, ...project(c, metrics) })
      )
    data.sort((a, b) =>
      String(a.period ?? "").localeCompare(String(b.period ?? ""))
    )
    return JSON.stringify({
      object: "metrics",
      start_date: request.start_date,
      end_date: request.end_date,
      metrics,
      dimensions,
      granularity: request.granularity,
      totals: project(total, metrics),
      ...(dimensions.length ? { data } : {}),
    })
  },
})
export function registerMetricsRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/emails/metrics",
    scope: { resource: "emails", access: "read" },
    handler: async (ctx, { caller, query }) => ({
      body: JSON.parse(
        await ctx.runQuery(internal.api.metrics.get, {
          caller,
          query: query.toString(),
        })
      ),
    }),
  })
}
