"use client"

import * as React from "react"
import Link from "next/link"
import { DownloadIcon } from "lucide-react"
import { useTeamRole } from "@/components/auth/workspace"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  EmptyState,
  ExportStatusBadge,
  ListPagination,
  PageHeader,
  RelativeTime,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import { ExportDownload } from "./shared"
import { useExportList } from "@/lib/exports/use-exports"
import { useDashboard } from "@/lib/dashboard/store"
import { exportFileName } from "@/lib/dashboard/exports"
import { slugify } from "@/lib/dashboard/slug"
import { useClock } from "@/lib/time/use-clock"

const DEMO_RESOURCES = new Set(["Emails", "Suppressions", "Broadcasts"])

export function SettingsExports() {
  const { state } = useDashboard()
  const { isAdmin } = useTeamRole()
  const now = useClock()
  const demo = React.useMemo(
    () => state.exports.filter((row) => DEMO_RESOURCES.has(row.resource)),
    [state.exports]
  )
  const exports = useExportList(demo)
  const { rows, pageRows, pagination } = exports
  return (
    <>
      <PageHeader
        title="Exports"
        description="Exports from Emails, Broadcasts, Contacts, Segments, Domains, Logs, and API keys. Completed files stay available for 7 days."
      />
      {!isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only team admins can download exports.
        </p>
      )}
      {exports.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={DownloadIcon}
          title="You haven't performed any exports yet"
          description="Once you execute an export, you'll be able to see them here."
        />
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Expires</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((row) => {
              const local = demo.some((item) => item.id === row.id)
              const item = {
                ...row,
                fileName:
                  row.fileName ??
                  exportFileName(slugify(row.resource), row.createdAt),
                status:
                  now !== null && row.expiresAt <= now
                    ? ("expired" as const)
                    : row.status,
              }
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {local ? (
                      item.fileName
                    ) : (
                      <Link
                        href={`/settings/exports/${item.id}`}
                        className="hover:underline"
                      >
                        {item.fileName}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>
                    <ExportStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <RelativeTime at={item.expiresAt} />
                  </TableCell>
                  <TableCell>
                    <ExportDownload job={item} iconOnly demo={local} />
                  </TableCell>
                </TableRow>
              )
            })}
          </ResourceTable>
          <ListPagination {...pagination} noun="export" />
        </>
      )}
    </>
  )
}
