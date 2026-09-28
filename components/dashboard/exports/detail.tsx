"use client"

import { useParams } from "next/navigation"
import { DownloadIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { useTeamRole } from "@/components/auth/workspace"
import {
  DetailHeader,
  ExportStatusBadge,
  MetaStrip,
  NotFoundState,
  RelativeTime,
} from "@/components/dashboard/primitives"
import { ExportFilterList } from "@/components/dashboard/export-dialog"
import { ExportDownload } from "./shared"
import { useExport } from "@/lib/exports/use-exports"
import { useClock } from "@/lib/time/use-clock"

export function ExportDetail() {
  const { id } = useParams<{ id: string }>()
  const found = useExport(id)
  const { isAdmin } = useTeamRole()
  const now = useClock()
  if (found === undefined) return <Skeleton className="h-64 w-full" />
  if (!found)
    return (
      <NotFoundState
        icon={DownloadIcon}
        noun="export"
        backHref="/settings/exports"
        backLabel="Back to exports"
      />
    )
  const job = {
    ...found,
    status:
      now !== null && found.expiresAt <= now
        ? ("expired" as const)
        : found.status,
  }
  return (
    <div className="flex flex-col gap-6">
      <DetailHeader
        backHref="/settings/exports"
        backLabel="Exports"
        title={job.fileName}
        icon={DownloadIcon}
        actions={<ExportDownload job={job} />}
      />
      {!isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only team admins can download exports.
        </p>
      )}
      <MetaStrip
        items={[
          { label: "Created", value: <RelativeTime at={job.createdAt} /> },
          { label: "Status", value: <ExportStatusBadge status={job.status} /> },
          { label: "Expires", value: <RelativeTime at={job.expiresAt} /> },
          { label: "Creator", value: job.creatorEmail || "—" },
        ]}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Filters</h2>
        <ExportFilterList lines={job.summary} />
      </section>
    </div>
  )
}
