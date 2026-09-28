"use client"

import * as React from "react"
import { DownloadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTeamRole } from "@/components/auth/workspace"
import { useDownloadExport } from "@/lib/exports/use-exports"
import type { ExportJob } from "@/lib/dashboard/types"

export function ExportDownload({
  job,
  iconOnly = false,
  demo = false,
}: {
  job: ExportJob
  iconOnly?: boolean
  demo?: boolean
}) {
  const { isAdmin } = useTeamRole()
  const download = useDownloadExport()
  const [pending, setPending] = React.useState(false)
  return (
    <Button
      variant={iconOnly ? "ghost" : "default"}
      size={iconOnly ? "icon" : "default"}
      aria-label="Download CSV"
      disabled={!isAdmin || demo || job.status !== "ready" || pending}
      title={
        !isAdmin
          ? "Only team admins can download exports."
          : demo
            ? "This export has no downloadable file yet."
            : undefined
      }
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
  )
}
