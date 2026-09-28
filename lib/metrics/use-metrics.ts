"use client"
import * as React from "react"
import { useQueries } from "convex/react"
import { eachDayOfInterval, startOfDay, endOfDay, format } from "date-fns"
import type { DateRange } from "react-day-picker"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useWorkspace } from "@/components/auth/workspace"
import { useTeamList } from "@/components/dashboard/primitives"
import { emptyEmailCounts, eventCount } from "@/lib/dashboard/metrics"
import { rangeBounds } from "@/lib/dashboard/email-range"
import { rate } from "@/lib/dashboard/format"
import type { EmailStatus } from "@/lib/dashboard/types"

const asDomain = (
  row: FunctionReturnType<typeof api.metrics.domains>["page"][number]
) => row

export function useMetrics(
  range: DateRange,
  domain: string,
  status: EmailStatus | null
) {
  const { activeTeamId } = useWorkspace()
  const domainId = domain === "all" ? undefined : (domain as Id<"domains">)
  const spans = React.useMemo(
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
  const requests = React.useMemo(() => {
    const result: Record<
      string,
      {
        query: typeof api.metrics.summary
        args: {
          organizationId: string
          domainId?: Id<"domains">
          spans: typeof spans
        }
      }
    > = {}
    if (activeTeamId)
      for (let offset = 0; offset < spans.length; offset += 31)
        result[String(offset)] = {
          query: api.metrics.summary,
          args: {
            organizationId: activeTeamId,
            domainId,
            spans: spans.slice(offset, offset + 31),
          },
        }
    return result
  }, [activeTeamId, domainId, spans])
  const results = useQueries(requests) as Record<
    string,
    FunctionReturnType<typeof api.metrics.summary> | Error | undefined
  >
  const chunks = Object.keys(requests).map((key) => results[key])
  const failure = chunks.find((chunk) => chunk instanceof Error)
  const counts = chunks.every((chunk) => Array.isArray(chunk))
    ? (chunks as FunctionReturnType<typeof api.metrics.summary>[]).flat()
    : undefined
  const domains = useTeamList(
    api.metrics.domains,
    api.metrics.domainCount,
    { ...rangeBounds(range), domainId },
    asDomain
  )
  const picker = useTeamList(
    api.metrics.domains,
    api.metrics.domainCount,
    {},
    asDomain
  )
  if (failure instanceof Error) throw failure
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
  return { loading: counts === undefined, totals, days, domains, picker }
}
