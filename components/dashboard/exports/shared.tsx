"use client"

import * as React from "react"
import { DownloadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DisabledTooltip } from "@/components/ui/tooltip"
import { useTeamRole } from "@/components/auth/workspace"
import { useDownloadExport } from "@/lib/exports/use-exports"
import type { ExportJob } from "@/lib/dashboard/types"

export function ExportDownload({
  job,
  iconOnly = false,
}: {
  job: ExportJob
  iconOnly?: boolean
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
        aria-label="Download CSV"
        disabled={!isAdmin || job.status !== "ready" || pending}
        onClick={async () => {
          setPending(true)
          try {
            await download(job)
          } finally {
            setPending(false)
          }
        }}
      >
        <DownloadIcon data-icon={iconOnly ? undefined : "inline-start"} />
        {!iconOnly && "Download CSV"}
      </Button>
    </DisabledTooltip>
  )
}
