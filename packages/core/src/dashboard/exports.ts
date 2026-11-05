import { sentenceCase } from "./format"

/** Exports this long or shorter download in the browser as soon as they
    finish, as on Resend; longer ones wait in Settings → Exports. */
export const AUTO_DOWNLOAD_ROWS = 1000

/** One confirmed list filter: "Status" and "All statuses". */
export type ExportFilterLine = { label: string; value: string }

/** `domains-1790557161016.csv`, as Resend names its files. */
export const exportFileName = (resource: string, createdAt: number) =>
  `${resource}-${Math.floor(createdAt)}.csv`

/** Postgres `timestamptz` text, as Resend writes times in its API and
    exports: `2026-07-02 18:11:32.270000+00`. */
export const pgTimestamp = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").replace("Z", "000+00")

/** A CSV cell for a time that may never have happened. */
export const csvTime = (ms: number | null | undefined) =>
  ms == null ? "" : pgTimestamp(ms)

/** "Filter by user agent" → "User agent". */
export const filterLabel = (ariaLabel: string) =>
  sentenceCase(ariaLabel.replace(/^filter by\s+/i, ""))

/** What the export dialog confirms and the export's page lists: the search,
    the date range with its timezone, then each filter select as shown. */
export function exportSummary({
  search,
  date,
  timezone,
  filters = [],
  extra = [],
}: {
  search?: string
  /** The date picker's label, when the list has one. */
  date?: string
  timezone?: string
  filters?: readonly {
    value: string
    items: readonly { value: string; label: string }[]
    "aria-label": string
  }[]
  extra?: readonly ExportFilterLine[]
}): ExportFilterLine[] {
  const text = search?.trim()
  return [
    ...(text ? [{ label: "Search", value: text }] : []),
    ...(date ? [{ label: "Date", value: date }] : []),
    ...(date && timezone ? [{ label: "Timezone", value: timezone }] : []),
    ...filters.map((filter) => ({
      label: filterLabel(filter["aria-label"]),
      value:
        filter.items.find((item) => item.value === filter.value)?.label ??
        filter.value,
    })),
    ...extra,
  ]
}

/** What a started export's creator gets once it settles: nothing yet, the
    file itself, a pointer to Settings → Exports, or the failure. Only team
    admins can download, and only short exports come down on their own. */
export function exportOutcome(
  row: { status: string; rows: number } | null | undefined,
  isAdmin: boolean
): "wait" | "download" | "listed" | "failed" {
  if (row === undefined || row?.status === "processing") return "wait"
  if (row?.status !== "ready") return "failed"
  return isAdmin && row.rows <= AUTO_DOWNLOAD_ROWS ? "download" : "listed"
}
