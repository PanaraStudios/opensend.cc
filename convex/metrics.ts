import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { v, ConvexError, type Infer } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { query, type QueryCtx } from "./_generated/server"
import { requireTeam } from "./access"
import { countValue, counters } from "./counts"
import { EMAIL_STATUSES } from "./tables/emails"

const span = v.object({ from: v.number(), to: v.number() })
const filters = {
  organizationId: v.string(),
  domainId: v.optional(v.id("domains")),
}
const milestoneTypes = [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "Permanent",
  "Transient",
  "Undetermined",
] as const
export const metricsCountValue = v.object({
  sent: v.number(),
  delivered: v.number(),
  opened: v.number(),
  clicked: v.number(),
  bounced: v.number(),
  complained: v.number(),
  status: v.record(v.string(), v.number()),
  Permanent: v.number(),
  Transient: v.number(),
  Undetermined: v.number(),
})
type Counts = Infer<typeof metricsCountValue>

/** Each span costs one aggregate read per counter whatever its length, so
    the span count is what bounds a query (the client asks for 31 days at a
    time); the overall range is kept to a year. */
function checkSpans(spans: Infer<typeof span>[]) {
  if (!spans.length || spans.length > 31)
    throw new ConvexError(
      "Metrics support up to 31 days per query. Choose a shorter date range."
    )
  if (spans[spans.length - 1].to - spans[0].from > 366 * 86_400_000 + 3_600_000)
    throw new ConvexError(
      "Metrics support up to a year. Choose a shorter date range."
    )
  for (let i = 0; i < spans.length; i++) {
    const { from, to } = spans[i]
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from % 900000 !== 0 ||
      (to + 1) % 900000 !== 0 ||
      to < from ||
      (i > 0 && from <= spans[i - 1].to)
    )
      throw new ConvexError("Invalid metrics date range")
  }
}

async function countsFor(
  ctx: QueryCtx,
  args: { organizationId: string; domainId?: Id<"domains"> },
  spans: Infer<typeof span>[]
): Promise<Counts[]> {
  const namespace = args.domainId
    ? JSON.stringify([args.organizationId, args.domainId])
    : args.organizationId
  const emailCounter = args.domainId ? counters.emailDomains : counters.emails
  const metricCounter = args.domainId
    ? counters.domainMetrics
    : counters.emailMetrics
  const bounds = (type: string, range: Infer<typeof span>) => ({
    namespace,
    bounds: {
      lower: { key: [type, range.from / 900000], inclusive: true },
      upper: { key: [type, (range.to + 1) / 900000], inclusive: false },
    },
  })
  const [statuses, milestones] = await Promise.all([
    emailCounter.aggregate.countBatch(
      ctx,
      spans.flatMap((range) =>
        EMAIL_STATUSES.map((type) => bounds(type, range))
      )
    ),
    metricCounter.aggregate.countBatch(
      ctx,
      spans.flatMap((range) =>
        milestoneTypes.map((type) => bounds(type, range))
      )
    ),
  ])
  return spans.map((_, i) => {
    const status = Object.fromEntries(
      EMAIL_STATUSES.map((type, j) => [
        type,
        statuses[i * EMAIL_STATUSES.length + j],
      ])
    )
    const reached = Object.fromEntries(
      milestoneTypes.map((type, j) => [
        type,
        milestones[i * milestoneTypes.length + j],
      ])
    ) as Omit<Counts, "status">
    // Like Resend, rates are out of emails actually sent: a suppressed,
    // failed, canceled or still-queued email never reached SES.
    return { ...reached, status }
  })
}

export const summary = query({
  args: { ...filters, spans: v.array(span) },
  returns: v.array(metricsCountValue),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    checkSpans(args.spans)
    return countsFor(ctx, args, args.spans)
  },
})

const domainFilters = {
  ...filters,
  from: v.optional(v.number()),
  to: v.optional(v.number()),
}
const domainSummary = v.object({
  id: v.id("domains"),
  name: v.string(),
  counts: metricsCountValue,
})

async function summarizeDomains(
  ctx: QueryCtx,
  domains: Doc<"domains">[],
  range: Infer<typeof span>
) {
  const rows = await Promise.all(
    domains.map(async (domain) => ({
      id: domain._id,
      name: domain.name,
      counts: (
        await countsFor(
          ctx,
          { organizationId: domain.organizationId, domainId: domain._id },
          [range]
        )
      )[0],
    }))
  )
  return rows.filter(
    (row) => row.counts.sent > 0 || (row.counts.status.scheduled ?? 0) > 0
  )
}

export const domains = query({
  args: { ...domainFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(domainSummary),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const range = {
      from:
        args.from ?? Math.floor(Date.now() / 900000) * 900000 - 30 * 86_400_000,
      to: args.to ?? (Math.floor(Date.now() / 900000) + 1) * 900000 - 1,
    }
    checkSpans([range])
    const page = await ctx.db
      .query("domains")
      .withIndex("by_organizationId_and_deleted_and_name", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .paginate(args.paginationOpts)
    const rows = await summarizeDomains(ctx, page.page, range)
    return {
      ...page,
      page: rows.filter((row) => !args.domainId || args.domainId === row.id),
    }
  },
})

export const domainCount = query({
  args: domainFilters,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return { total: null }
  },
})

/** Bounded name suggestions, including removed domains with historical mail. */
export const domainOptions = query({
  args: { organizationId: v.string(), search: v.optional(v.string()) },
  returns: v.array(v.object({ value: v.id("domains"), label: v.string() })),
  handler: async (ctx, { organizationId, search }) => {
    await requireTeam(ctx, organizationId)
    const prefix = search?.trim().toLowerCase() ?? ""
    return (
      await ctx.db
        .query("domains")
        .withIndex("by_organizationId_and_name", (q) =>
          q
            .eq("organizationId", organizationId)
            .gte("name", prefix)
            .lt("name", prefix + "\uffff")
        )
        .take(100)
    ).map((row) => ({ value: row._id, label: row.name }))
  },
})

/** The chart's compact breakdown; the selected domain is read directly so
    it remains available beyond the initial 100 domain summaries. */
export const breakdown = query({
  args: domainFilters,
  returns: v.array(domainSummary),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const range = {
      from:
        args.from ?? Math.floor(Date.now() / 900000) * 900000 - 30 * 86_400_000,
      to: args.to ?? (Math.floor(Date.now() / 900000) + 1) * 900000 - 1,
    }
    checkSpans([range])
    const selected = args.domainId
      ? await ctx.db.get("domains", args.domainId)
      : null
    if (selected && selected.organizationId !== args.organizationId)
      throw new ConvexError("Domain not found")
    const domains = args.domainId
      ? selected
        ? [selected]
        : []
      : await ctx.db
          .query("domains")
          .withIndex("by_organizationId_and_name", (q) =>
            q.eq("organizationId", args.organizationId)
          )
          .take(100)
    return summarizeDomains(ctx, domains, range)
  },
})
