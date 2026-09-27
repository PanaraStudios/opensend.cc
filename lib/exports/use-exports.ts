"use client"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useWorkspace } from "@/components/auth/workspace"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
import type { ExportJob } from "@/lib/dashboard/types"

/** Starts a server export of a list (a key of `EXPORT_SOURCES` in
    convex/exportSources.ts) with the list's current filters. */
export function useStartExport() {
  const { activeTeamId } = useWorkspace()
  const start = useMutation(api.exports.start)
  return async (
    resource: string,
    filters: Record<string, string | number | undefined> = {}
  ) => {
    if (!activeTeamId) return
    try {
      await start({
        organizationId: activeTeamId,
        resource,
        filters: Object.fromEntries(
          Object.entries(filters)
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([key, value]) => [key, String(value)])
        ),
      })
      toast.add({ type: "success", title: "Export started" })
    } catch (e) {
      toast.add({ type: "error", title: actionError(e) })
    }
  }
}

/** The team's server exports, newest first. The screen has no status for
    a failed export and no download action yet: a failed export reads as
    expired, and `api.exports.downloadUrl` waits for a download affordance. */
export function useExports(): ExportJob[] | undefined {
  const { activeTeamId } = useWorkspace()
  const rows = useQuery(
    api.exports.list,
    activeTeamId ? { organizationId: activeTeamId } : "skip"
  )
  return rows?.map((row) => ({
    id: row._id,
    resource: row.label,
    status: row.status === "failed" ? "expired" : row.status,
    createdAt: row._creationTime,
    expiresAt: row.expiresAt,
    rows: row.rows,
  }))
}
