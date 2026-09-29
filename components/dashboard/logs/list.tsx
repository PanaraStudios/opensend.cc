"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import { endOfDay, startOfDay } from "date-fns"
import type { DateRange } from "react-day-picker"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DocsButton,
  EmptyState,
  ListPagination,
  ListToolbar,
  PageHeader,
  ResourceTable,
  useDebouncedValue,
  useTeamList,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  LOG_TABLE_HEADERS,
  LogIcon,
  LogRow,
} from "@/components/dashboard/logs/shared"
import { useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { defaultEmailRange } from "@/lib/dashboard/email-range"
import {
  LOG_SOURCES,
  LOG_STATUS_CLASSES,
  logSourceLabel,
  type LogStatusClass,
} from "@/lib/dashboard/logs"
import type { LogSource } from "@/lib/dashboard/types"
import { useExportDialog } from "@/components/dashboard/export-dialog"
import { asLog } from "@/lib/logs/use-logs"

const STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  ...LOG_STATUS_CLASSES.map((value) => ({ value, label: value })),
]

const SOURCE_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All sources" },
  ...LOG_SOURCES.map((value) => ({ value, label: logSourceLabel(value) })),
]

export function LogsView() {
  const { activeTeamId } = useWorkspace()
  const emailFilter = useSearchParams().get("email")
  /* The real clock, read once: the presets and the default range use it. */
  const [now] = React.useState(() => Date.now())
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [userAgent, setUserAgent] = React.useState("all")
  const [source, setSource] = React.useState("all")
  /* Arriving from an email shows its whole history, however old. */
  const [range, setRange] = React.useState<DateRange | undefined>(() =>
    emailFilter ? undefined : defaultEmailRange(now)
  )
  const search = useDebouncedValue(query)

  const filters = {
    statusClass: status === "all" ? undefined : (status as LogStatusClass),
    source: source === "all" ? undefined : (source as LogSource),
    userAgent: userAgent === "all" ? undefined : userAgent,
    emailId: emailFilter ?? undefined,
    search: search.trim() || undefined,
    from: range?.from ? startOfDay(range.from).getTime() : undefined,
    to: range?.from ? endOfDay(range.to ?? range.from).getTime() : undefined,
  }
  const exporting = useExportDialog({
    resource: "logs",
    noun: "logs",
    filters: { ...filters, search: query.trim() || undefined },
    extra: emailFilter ? [{ label: "Email", value: emailFilter }] : [],
  })
  const {
    rows,
    status: loading,
    pageRows,
    pagination,
  } = useTeamList(api.logs.list, api.logs.count, filters, asLog)
  const hasLogs = useQuery(
    api.logs.hasAny,
    activeTeamId ? { organizationId: activeTeamId } : "skip"
  )

  const agents = useQuery(
    api.logs.userAgents,
    activeTeamId ? { organizationId: activeTeamId } : "skip"
  )

  const userAgentItems: SelectOption[] = [
    { value: "all", label: "All user agents" },
    ...[
      ...new Set([
        ...(agents ?? []),
        ...(userAgent === "all" ? [] : [userAgent]),
      ]),
    ]
      .sort()
      .map((value) => ({ value, label: value })),
  ]

  return (
    <>
      <PageHeader title="Logs">
        <DocsButton />
      </PageHeader>
      {exporting.dialog}
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search logs…"
        range={range}
        onRangeChange={setRange}
        now={now}
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
          {
            value: userAgent,
            onChange: setUserAgent,
            items: userAgentItems,
            "aria-label": "Filter by user agent",
          },
          {
            value: source,
            onChange: setSource,
            items: SOURCE_ITEMS,
            "aria-label": "Filter by source",
          },
        ]}
        onExport={exporting.open}
      >
        {emailFilter ? (
          <Badge variant="secondary">email {emailFilter}</Badge>
        ) : null}
      </ListToolbar>
      {loading === "LoadingFirstPage" || hasLogs === undefined ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={LogIcon}
          title={hasLogs ? "No logs found" : "No logs yet"}
          description={
            hasLogs
              ? "No requests match these filters."
              : "Start sending emails to see every request land here."
          }
        />
      ) : (
        <>
          <ResourceTable headers={LOG_TABLE_HEADERS}>
            {pageRows.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </ResourceTable>
          <ListPagination
            {...pagination}
            noun="log"
            previousLabel="Newer"
            nextLabel="Older"
          />
        </>
      )}
    </>
  )
}
