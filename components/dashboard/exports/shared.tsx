"use client"

import * as React from "react"
import Link from "next/link"
import { DownloadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DisabledTooltip } from "@/components/ui/tooltip"
import { useTeamRole } from "@/components/auth/workspace"
import { useDownloadExport } from "@/lib/exports/use-exports"
import type { ExportJob } from "@/lib/dashboard/types"

/** Downloads a completed export. A CSV too large for one download comes as
    several files: the detail page shows a button per file, and the list's
    icon opens that page, as a browser blocks or asks about several
    downloads from one click. */
export function ExportDownload({
  job,
  iconOnly = false,
}: {
  job: ExportJob & { volumes?: number }
  iconOnly?: boolean
}) {
  const volumes = job.volumes ?? 1
  if (iconOnly && volumes > 1)
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Download CSV (${volumes} files)`}
        nativeButton={false}
        render={<Link href={`/settings/exports/${job.id}`} />}
      >
        <DownloadIcon />
      </Button>
    )
  if (volumes <= 1)
    return <DownloadButton job={job} iconOnly={iconOnly} volumes={volumes} />
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: volumes }, (_, volume) => (
        <DownloadButton
          key={volume}
          job={job}
          volumes={volumes}
          volume={volume}
        />
      ))}
    </div>
  )
}

function DownloadButton({
  job,
  iconOnly = false,
  volumes,
  volume,
}: {
  job: ExportJob
  iconOnly?: boolean
  volumes: number
  /** One file of a multi-file export. */
  volume?: number
}) {
  const { isAdmin } = useTeamRole()
  const download = useDownloadExport()
  const [pending, setPending] = React.useState(false)
  // A disabled button gets no pointer or focus events, so a title never shows.
  return (
    <DisabledTooltip
      reason={!isAdmin ? "Only team admins can download exports." : null}
    >
      <Button
        variant={iconOnly ? "ghost" : "default"}
        size={iconOnly ? "icon" : "default"}
        aria-label={
          volume === undefined
            ? "Download CSV"
            : `Download part ${volume + 1} of ${volumes}`
        }
        disabled={!isAdmin || job.status !== "ready" || pending}
        onClick={async () => {
          setPending(true)
          try {
            await download(job, volume)
          } finally {
            setPending(false)
          }
        }}
      >
        <DownloadIcon data-icon={iconOnly ? undefined : "inline-start"} />
        {!iconOnly &&
          (volume === undefined
            ? "Download CSV"
            : `Part ${volume + 1} of ${volumes}`)}
      </Button>
    </DisabledTooltip>
  )
}
