"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ChevronDownIcon, MailIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  CodeWell,
  CopyButton,
  DetailHeader,
  DocsButton,
  MetaStrip,
  NotFoundState,
  RelativeTime,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import {
  LogIcon,
  LogStatusBadge,
  LogsDocsSheet,
} from "@/components/dashboard/logs/shared"
import { permissionLabel } from "@/lib/dashboard/format"
import {
  logRequestBody,
  logRequestHeaders,
  logResponseBody,
  logSourceLabel,
  tokenizeJson,
  type JsonTokenKind,
} from "@/lib/dashboard/logs"
import { useDashboard } from "@/lib/dashboard/store"

const JSON_TOKEN_CLASS: Record<JsonTokenKind, string> = {
  key: "text-foreground",
  string: "text-success",
  literal: "text-info",
  punct: "text-muted-foreground",
}

function JsonSection({ title, value }: { title: string; value: object }) {
  const source = React.useMemo(() => JSON.stringify(value, null, 2), [value])
  const tokens = React.useMemo(() => tokenizeJson(source), [source])

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <CodeWell copyValue={source}>
        {tokens.map((token, index) => (
          <span key={index} className={JSON_TOKEN_CLASS[token.kind]}>
            {token.value}
          </span>
        ))}
      </CodeWell>
    </section>
  )
}

function RequestHeaders({
  headers,
}: {
  headers: readonly [name: string, value: string][]
}) {
  return (
    <Collapsible defaultOpen className="flex flex-col gap-3">
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="group -ml-2 w-fit text-foreground"
          />
        }
      >
        <ChevronDownIcon
          data-icon="inline-start"
          className="-rotate-90 transition-transform group-data-[panel-open]:rotate-0"
        />
        Request headers
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ResourceTable
          headers={
            <>
              <Th className="w-1/3">Header</Th>
              <Th>Value</Th>
            </>
          }
        >
          {headers.map(([name, value]) => (
            <TableRow key={name}>
              <TableCell className="font-mono text-[13px] text-muted-foreground">
                {name}
              </TableCell>
              <TableCell className="font-mono text-[13px]">{value}</TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function LogDetail() {
  const { id } = useParams<{ id: string }>()
  const { state } = useDashboard()
  const [docsOpen, setDocsOpen] = React.useState(false)
  const log = state.logs.find((item) => item.id === id)

  if (!log) {
    return (
      <NotFoundState
        icon={LogIcon}
        noun="log"
        backHref="/logs"
        description="It may have aged out of this workspace."
      />
    )
  }

  const email = state.emails.find((item) => item.id === log.emailId)
  const apiKey = state.apiKeys.find((item) => item.id === log.apiKeyId)
  const requestBody = logRequestBody(log, email)
  const responseBody = logResponseBody(log)

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/logs"
        backLabel="Logs"
        title={`${log.method} ${log.path}`}
        icon={LogIcon}
        badge={<LogStatusBadge status={log.status} />}
        actions={<DocsButton onClick={() => setDocsOpen(true)} />}
      />
      <MetaStrip
        items={[
          {
            label: "Endpoint",
            value: <span className="truncate font-mono">{log.path}</span>,
          },
          {
            label: "Date",
            value: <RelativeTime at={log.createdAt} />,
          },
          { label: "Method", value: log.method },
          { label: "Duration", value: `${log.durationMs} ms` },
          { label: "User agent", value: log.userAgent },
          { label: "Source", value: logSourceLabel(log.source) },
          {
            label: "API key",
            value: apiKey ? (
              <>
                <Link href={`/api-keys/${apiKey.id}`} className="truncate">
                  {apiKey.name}
                </Link>
                <Badge variant="secondary">
                  {permissionLabel(apiKey.permission)}
                </Badge>
              </>
            ) : (
              "—"
            ),
          },
          {
            label: "Id",
            value: (
              <>
                <span className="truncate font-mono">{log.id}</span>
                <CopyButton value={log.id} label="Id" />
              </>
            ),
          },
          ...(email
            ? [
                {
                  label: "Email",
                  value: (
                    <>
                      <MailIcon className="size-3.5 shrink-0" />
                      <Link href={`/emails/${email.id}`} className="truncate">
                        {email.subject}
                      </Link>
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      {responseBody ? (
        <JsonSection title="Response body" value={responseBody} />
      ) : null}
      {requestBody ? (
        <JsonSection title="Request body" value={requestBody} />
      ) : null}
      <RequestHeaders headers={logRequestHeaders(log, requestBody)} />
      <LogsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </div>
  )
}
