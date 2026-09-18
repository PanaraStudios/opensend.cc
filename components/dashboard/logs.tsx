"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ScrollTextIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  EmptyState,
  ListToolbar,
  PageHeader,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import { formatDateTime } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import { TableCell, TableRow } from "@/components/ui/table"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"

const HTTP_STATUS_ITEMS = [
  { value: "all", label: "All statuses" },
  { value: "2xx", label: "2xx" },
  { value: "4xx", label: "4xx" },
  { value: "5xx", label: "5xx" },
]

export function LogsView() {
  const { state } = useDashboard()
  const searchParams = useSearchParams()
  const emailFilter = searchParams.get("email")
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")

  const needle = searchNeedle(query)
  const rows = state.logs.filter((log) => {
    if (emailFilter && log.emailId !== emailFilter) return false
    if (!matchesNeedle(needle, `${log.method} ${log.path} ${log.status}`)) {
      return false
    }
    if (status === "2xx" && (log.status < 200 || log.status >= 300))
      return false
    if (status === "4xx" && (log.status < 400 || log.status >= 500))
      return false
    if (status === "5xx" && log.status < 500) return false
    return true
  })

  return (
    <>
      <PageHeader
        title="Logs"
        description="Request-level API and SMTP logs. Filter by path, status, or jump here from an email."
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search logs…"
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: HTTP_STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
        ]}
      >
        {emailFilter ? (
          <Badge variant="secondary">email {emailFilter}</Badge>
        ) : null}
      </ListToolbar>
      {rows.length === 0 ? (
        <EmptyState
          icon={ScrollTextIcon}
          title="No logs"
          description="API calls appear here as they hit this workspace."
        />
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Time</Th>
              <Th>Method</Th>
              <Th>Path</Th>
              <Th>Status</Th>
              <Th>Duration</Th>
              <Th>Email</Th>
            </>
          }
        >
          {rows.map((log) => (
            <TableRow key={log.id}>
              <TableCell className="text-muted-foreground">
                {formatDateTime(log.createdAt)}
              </TableCell>
              <TableCell>
                <code className="font-mono text-[13px]">{log.method}</code>
              </TableCell>
              <TableCell>
                <code className="font-mono text-[13px]">{log.path}</code>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    log.status >= 400
                      ? "destructive"
                      : log.status >= 300
                        ? "warning"
                        : "success"
                  }
                  dot
                >
                  {log.status}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {log.durationMs} ms
              </TableCell>
              <TableCell>
                {log.emailId ? (
                  <Link
                    href={`/emails/${log.emailId}`}
                    className="font-mono text-[13px] hover:underline"
                  >
                    {log.emailId}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
    </>
  )
}
