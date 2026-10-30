"use client"
import {
  useConvex,
  useMutation,
  useQuery,
  type ConvexReactClient,
} from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useTeamRole, useWorkspace } from "@/components/auth/workspace"
import { toast } from "@/components/ui/toast"
import { actionError } from "@/lib/action-error"
import { exportOutcome, type ExportFilterLine } from "@/lib/dashboard/exports"
import { useTeamList } from "@/components/dashboard/primitives"
import type { ExportJob } from "@/lib/dashboard/types"
import { downloadBlob, downloadFromUrl } from "@/lib/dashboard/download"

type ExportRow = NonNullable<FunctionReturnType<typeof api.exports.get>>

/** An export as the dashboard shows it. `volumes` > 1 when the CSV is
    larger than one download carries and comes as several files. */
export type ExportItem = ExportJob & {
  creatorEmail: string
  summary: ExportFilterLine[]
  volumes: number
}

export function asExport(row: ExportRow): ExportItem {
  return {
    id: row._id,
    resource: row.resource,
    fileName: row.fileName,
    status: row.status,
    createdAt: row._creationTime,
    expiresAt: row.expiresAt,
    rows: row.rows,
    creatorEmail: row.creatorEmail,
    summary: row.summary,
    volumes: row.volumes,
  }
}

/** Saves one file of a completed export. Exports written in parts come
    from the backend's streaming route, which names the file itself, so the
    browser saves it straight to disk without holding it in page memory:
    "started", as the bytes arrive after this returns. Older single-file
    exports are fetched and saved under their own name, as the storage URL
    alone would download as a random id: "saved". Team admins only. */
async function download(
  convex: ConvexReactClient,
  id: string,
  fileName: string,
  volume = 0
): Promise<"started" | "saved"> {
  const url = await convex.action(api.exports.downloadUrl, {
    id: id as Id<"exports">,
    volume,
  })
  if (!url) throw new Error("This export is no longer available")
  if (new URL(url).pathname.startsWith("/exports/download/")) {
    downloadFromUrl(url)
    return "started"
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error("The download failed. Try again.")
  downloadBlob(fileName, await response.blob())
  return "saved"
}

export function useDownloadExport() {
  const convex = useConvex()
  return async (job: Pick<ExportJob, "id" | "fileName">, volume = 0) => {
    try {
      await download(convex, job.id, job.fileName, volume)
    } catch (e) {
      toast.add({ type: "error", title: actionError(e) })
    }
  }
}

/** Starts a server export of a list (a key of `EXPORT_SOURCES` in
    convex/exportSources.ts) with the filters the dialog confirmed, then
    follows it: a short export comes down in the browser for a team admin,
    anything else waits in Settings → Exports. Following outlives the page,
    so leaving the list does not lose the download. */
export function useStartExport() {
  const convex = useConvex()
  const { activeTeamId } = useWorkspace()
  const { isAdmin } = useTeamRole()
  const start = useMutation(api.exports.start)
  return async (
    resource: string,
    filters: Record<string, string | number | boolean | undefined>,
    summary: ExportFilterLine[]
  ) => {
    if (!activeTeamId) return
    const id = await start({
      organizationId: activeTeamId,
      resource,
      summary,
      filters: Object.fromEntries(
        Object.entries(filters)
          .filter(([, value]) => value !== undefined && value !== "")
          .map(([key, value]) => [key, String(value)])
      ),
    })
    toast.add({ type: "success", title: "Export started" })
    const watch = convex.watchQuery(api.exports.get, { id })
    let settled = false
    let stop = () => {}
    const settle = async () => {
      let row: ExportRow | null | undefined
      try {
        row = watch.localQueryResult()
      } catch {
        row = null
      }
      const outcome = exportOutcome(row, isAdmin)
      if (settled || outcome === "wait") return
      settled = true
      stop()
      if (outcome === "failed") {
        toast.add({ type: "error", title: "Export failed" })
      } else if (outcome === "listed") {
        toast.add({
          type: "success",
          title: "Export completed",
          description: isAdmin
            ? "It is too large to download here. Download it from Settings → Exports."
            : "Only team admins can download it. Find it in Settings → Exports.",
        })
      } else {
        try {
          const saved = await download(convex, id, row!.fileName)
          toast.add({
            type: "success",
            title:
              saved === "saved"
                ? "Export downloaded successfully."
                : "Download started",
          })
        } catch (e) {
          toast.add({ type: "error", title: actionError(e) })
        }
      }
    }
    stop = watch.onUpdate(() => void settle())
    if (settled) stop()
    else void settle()
  }
}

/** The team's server exports, newest first, a page at a time. */
export function useExportList() {
  return useTeamList(api.exports.list, api.exports.count, {}, asExport)
}

/** One export for its page: undefined while loading, null if not found. */
export function useExport(id: string) {
  const row = useQuery(api.exports.get, { id })
  return row && asExport(row)
}
