"use client"

import { ScrollTextIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { DocsSheet, RelativeTime } from "@/components/dashboard/primitives"
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
    "Last 15 days" and "15d ago" agree. */
export function LogAge({ at }: { at: number }) {
  return <RelativeTime at={at} />
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
