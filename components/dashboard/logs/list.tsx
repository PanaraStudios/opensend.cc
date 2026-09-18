"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import type { DateRange } from "react-day-picker"

import { Badge } from "@/components/ui/badge"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  DocsButton,
  EmptyState,
  ListPagination,
  ListToolbar,
  PageHeader,
  ResourceTable,
  Th,
  usePagination,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  LogAge,
  LogIcon,
  LogStatusBadge,
  LogsDocsSheet,
} from "@/components/dashboard/logs/shared"
import { defaultEmailRange, inDateRange } from "@/lib/dashboard/email-range"
import {
  LOG_SOURCES,
  LOG_STATUS_CLASSES,
  logSourceLabel,
  logStatusClass,
} from "@/lib/dashboard/logs"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"

const STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  ...LOG_STATUS_CLASSES.map((value) => ({ value, label: value })),
]

const SOURCE_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All sources" },
  ...LOG_SOURCES.map((value) => ({ value, label: logSourceLabel(value) })),
]

export function LogsView() {
  const { state, addExport } = useDashboard()
  const emailFilter = useSearchParams().get("email")
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [userAgent, setUserAgent] = React.useState("all")
  const [source, setSource] = React.useState("all")
  /* Arriving from an email shows its whole history, however old. */
  const [range, setRange] = React.useState<DateRange | undefined>(() =>
    emailFilter ? undefined : defaultEmailRange()
  )
  const [docsOpen, setDocsOpen] = React.useState(false)

  const userAgentItems: SelectOption[] = [
    { value: "all", label: "All user agents" },
    ...[...new Set(state.logs.map((log) => log.userAgent))]
      .sort()
      .map((value) => ({ value, label: value })),
  ]

  const needle = searchNeedle(query)
  const rows = state.logs.filter((log) => {
    if (emailFilter && log.emailId !== emailFilter) return false
    if (status !== "all" && logStatusClass(log.status) !== status) return false
    if (userAgent !== "all" && log.userAgent !== userAgent) return false
    if (source !== "all" && log.source !== source) return false
    if (!matchesNeedle(needle, `${log.method} ${log.path} ${log.status}`)) {
      return false
    }
    return inDateRange(log.createdAt, range)
  })
  const { pageRows, pagination } = usePagination(rows)

  return (
    <>
      <PageHeader title="Logs">
        <DocsButton onClick={() => setDocsOpen(true)} />
      </PageHeader>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search logs…"
        range={range}
        onRangeChange={setRange}
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
        onExport={() => {
          addExport("Logs", rows.length)
          toast.add({ type: "success", title: "Export started" })
        }}
      >
        {emailFilter ? (
          <Badge variant="secondary">email {emailFilter}</Badge>
        ) : null}
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState
          icon={LogIcon}
          title={state.logs.length === 0 ? "No logs yet" : "No logs found"}
          description={
            state.logs.length === 0
              ? "Start sending emails to see every request land here."
              : "No requests match these filters."
          }
        />
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Endpoint</Th>
                <Th>Status</Th>
                <Th>Method</Th>
                <Th className="text-right">Created</Th>
              </>
            }
          >
            {pageRows.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="icon-tile size-8 rounded-lg [&_svg]:size-4">
                      <LogIcon />
                    </span>
                    <Link
                      href={`/logs/${log.id}`}
                      className="font-mono text-[13px] underline decoration-muted-foreground/50 decoration-dashed underline-offset-4 hover:decoration-foreground"
                    >
                      {log.path}
                    </Link>
                  </div>
                </TableCell>
                <TableCell>
                  <LogStatusBadge status={log.status} />
                </TableCell>
                <TableCell>{log.method}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  <LogAge at={log.createdAt} />
                </TableCell>
              </TableRow>
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
      <LogsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </>
  )
}
