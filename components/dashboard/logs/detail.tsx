"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useQuery } from "convex/react"
import { ChevronDownIcon, MailIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  DetailHeader,
  DocsButton,
  HttpStatusBadge,
  JsonSection,
  MetaStrip,
  MonoValue,
  NotFoundState,
  RelativeTime,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import { LogIcon, LogsDocsSheet } from "@/components/dashboard/logs/shared"
import { permissionLabel } from "@/lib/dashboard/format"
import { api } from "@/convex/_generated/api"
import { logSourceLabel, storedBody } from "@/lib/dashboard/logs"
import { useEmail } from "@/lib/emails/use-emails"
import { asLog } from "@/lib/logs/use-logs"

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
  const [docsOpen, setDocsOpen] = React.useState(false)
  const found = useQuery(api.logs.get, { id })
  const email = useEmail(found?.log.emailId)?.email

  if (found === undefined) return <Skeleton className="h-64 w-full" />
  if (!found) {
    return (
      <NotFoundState
        icon={LogIcon}
        noun="log"
        backHref="/logs"
        description="It may have aged out of this workspace."
      />
    )
  }

  const log = asLog(found.log)
  const { apiKey, body } = found
  const requestBody = storedBody(body?.requestBody)
  const responseBody = storedBody(body?.responseBody)

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/logs"
        backLabel="Logs"
        title={`${log.method} ${log.path}`}
        icon={LogIcon}
        badge={<HttpStatusBadge status={log.status} />}
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
                <Link href={`/api-keys/${apiKey._id}`} className="truncate">
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
            value: <MonoValue copyValue={log.id}>{log.id}</MonoValue>,
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
      {responseBody !== null ? (
        <JsonSection title="Response body" value={responseBody} />
      ) : null}
      {requestBody !== null ? (
        <JsonSection title="Request body" value={requestBody} />
      ) : null}
      <RequestHeaders
        headers={(body?.requestHeaders ?? []).map(({ name, value }) => [
          name,
          value,
        ])}
      />
      <LogsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
    </div>
  )
}
