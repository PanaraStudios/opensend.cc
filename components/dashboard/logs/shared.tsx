"use client"

import Link from "next/link"
import { ScrollTextIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { TableCell, TableRow } from "@/components/ui/table"
import { DocsSheet, RelativeTime, Th } from "@/components/dashboard/primitives"
import { logStatusTone } from "@/lib/dashboard/logs"
import type { ApiLog } from "@/lib/dashboard/types"

export const LogIcon = ScrollTextIcon

export function LogStatusBadge({ status }: { status: number }) {
  return (
    <Badge variant={logStatusTone(status)} dot>
      {status}
    </Badge>
  )
}

/** Age against the demo clock, the same one the date range picker uses, so
    "Last 15 days" and "15d ago" agree. */
export function LogAge({ at }: { at: number }) {
  return <RelativeTime at={at} />
}

/** Header cells for a log table. Paired with `LogRow`, so the logs list and
    every page that embeds recent requests keep the same columns. */
export const LOG_TABLE_HEADERS = (
  <>
    <Th>Endpoint</Th>
    <Th>Status</Th>
    <Th>Method</Th>
    <Th className="text-right">Created</Th>
  </>
)

export function LogRow({ log }: { log: ApiLog }) {
  return (
    <TableRow>
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
  )
}

const LOG_DOCS = [
  {
    title: "What is logged",
    body: "Every API, SMTP, and dashboard request against this workspace, with its status, caller, and payloads.",
  },
  {
    title: "Filtering",
    body: "Narrow by date, status class, user agent, or source. Search matches the method, endpoint, and status code.",
  },
  {
    title: "Redaction",
    body: "Authorization and network headers are redacted before a request is stored.",
  },
]

export function LogsDocsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DocsSheet
      {...props}
      title="Logs"
      description="Request-level history for debugging integrations."
      sections={LOG_DOCS}
    />
  )
}
