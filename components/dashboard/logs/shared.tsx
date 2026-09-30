"use client"

import { ScrollTextIcon } from "lucide-react"

import { TableCell, TableRow } from "@/components/ui/table"
import {
  HttpStatusBadge,
  IconCell,
  MonoLink,
  RelativeTime,
  Th,
} from "@/components/dashboard/primitives"
import type { ApiLog } from "@/lib/dashboard/types"

export const LogIcon = ScrollTextIcon

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
        <IconCell icon={LogIcon}>
          <MonoLink href={`/logs/${log.id}`}>{log.path}</MonoLink>
        </IconCell>
      </TableCell>
      <TableCell>
        <HttpStatusBadge status={log.status} />
      </TableCell>
      <TableCell>{log.method}</TableCell>
      <TableCell className="text-right text-muted-foreground">
        <RelativeTime at={log.createdAt} />
      </TableCell>
    </TableRow>
  )
}
