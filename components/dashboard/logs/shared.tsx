"use client"

import { ScrollTextIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { DocsSheet } from "@/components/dashboard/primitives"
import { DEMO_NOW } from "@/lib/dashboard/data"
import { formatDateTime, formatRelative } from "@/lib/dashboard/format"
import { logStatusTone } from "@/lib/dashboard/logs"

export const LogIcon = ScrollTextIcon

export function LogStatusBadge({ status }: { status: number }) {
  return (
    <Badge variant={logStatusTone(status)} dot>
      {status}
    </Badge>
  )
}

/** Age against the demo clock, the same one the date range picker uses, so
    "Last 15 days" and "15d ago" agree. The exact time sits in the tooltip. */
export function LogAge({ at }: { at: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={formatDateTime(at)}>
      {formatRelative(at, DEMO_NOW)}
    </time>
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
