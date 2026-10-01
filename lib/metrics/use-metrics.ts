"use client"
import * as React from "react"
import { useQueries } from "convex/react"
import { eachDayOfInterval, startOfDay, endOfDay, format } from "date-fns"
import type { DateRange } from "react-day-picker"
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useWorkspace, useTeamQuery } from "@/components/auth/workspace"
import { emptyEmailCounts, eventCount } from "@/lib/dashboard/metrics"
import { rangeBounds } from "@/lib/dashboard/email-range"
import { rate } from "@/lib/dashboard/format"
import type { EmailStatus } from "@/lib/dashboard/types"

export function useMetricsSpans(range: DateRange) {
  return React.useMemo(
    () =>
      range.from
        ? eachDayOfInterval({
            start: range.from,
            end: range.to ?? range.from,
          }).map((day) => ({
            from: startOfDay(day).getTime(),
            to: endOfDay(day).getTime(),
          }))
        : [],
    [range]
  )
}

/** Every metrics series shares the email query's 31-span batching. */
export function useMetricsChunks<Q extends FunctionReference<"query">>(
  query: Q,
  args: FunctionArgs<Q> | null,
  spans: { from: number; to: number }[]
): FunctionReturnType<Q> | undefined {
  const requests = React.useMemo(() => {
    const result: Record<string, { query: Q; args: FunctionArgs<Q> }> = {}
    if (args)
      for (let offset = 0; offset < spans.length; offset += 31)
        result[String(offset)] = {
          query,
          args: { ...args, spans: spans.slice(offset, offset + 31) },
        }
    return result
  }, [query, args, spans])
  const results = useQueries(requests) as Record<
    string,
    FunctionReturnType<Q> | Error | undefined
  >
  const chunks = Object.keys(requests).map((key) => results[key])
  const failure = chunks.find((chunk) => chunk instanceof Error)
  if (failure instanceof Error) throw failure
  if (!args || !chunks.length || !chunks.every((chunk) => Array.isArray(chunk)))
    return undefined
  return chunks.flat() as FunctionReturnType<Q>
}

export function useMetrics(
  range: DateRange,
  domain: string,
  status: EmailStatus | null
) {
  const { activeTeamId } = useWorkspace()
  const domainId = domain === "all" ? undefined : (domain as Id<"domains">)
  const spans = useMetricsSpans(range)
  const args = React.useMemo(
    () =>
      activeTeamId
        ? {
            organizationId: activeTeamId,
            domainId,
            spans,
          }
        : null,
    [activeTeamId, domainId, spans]
  )
  const counts = useMetricsChunks(api.metrics.summary, args, spans)
  const domains = useTeamQuery(api.metrics.breakdown, {
    ...rangeBounds(range),
    domainId,
  })
  const totals = {
    ...emptyEmailCounts(),
    Permanent: 0,
    Transient: 0,
    Undetermined: 0,
  }
  for (const row of counts ?? [])
    for (const key of [
      "sent",
      "delivered",
      "opened",
      "clicked",
      "bounced",
      "complained",
      "Permanent",
      "Transient",
      "Undetermined",
    ] as const)
      totals[key] += row[key]
  const days = (counts ?? []).map((row, i) => ({
    ...row,
    label: format(spans[i].from, "MMM d"),
    events: eventCount(row, status),
    bounceRate: rate(row.bounced, row.sent, 2),
    complainRate: rate(row.complained, row.sent, 2),
  }))
  return {
    loading: counts === undefined || domains === undefined,
    totals,
    days,
    domains: domains ?? [],
  }
}
