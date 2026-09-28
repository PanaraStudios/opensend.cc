import type { PaginationOptions, PaginationResult } from "convex/server"
import type { QueryCtx } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"
import { matchesNeedle, searchNeedle } from "../lib/dashboard/search"

/* Shared by the dashboard's list queries. A list whose filters no index
   expresses drops rows from each page instead, so a page may come back
   short; the dashboard's pager keeps loading until it fills or the list
   ends. */

/** Whether any field contains the whole search, ignoring case. */
export function matchesSearch(search: string | undefined) {
  const needle = searchNeedle(search ?? "")
  return (...fields: (string | null | undefined)[]) =>
    matchesNeedle(needle, ...fields)
}

/** The page with only the rows that `keep` accepts. */
export const narrow = <T>(
  result: PaginationResult<T>,
  keep: (row: T) => boolean
): PaginationResult<T> => ({ ...result, page: result.page.filter(keep) })

/** Scan an ordinary index, then filter one bounded page. Full-text search
    cannot supply complete substring candidates: its token expansion retains
    64 unique terms INCLUDING equality filters (one team leaves 63), and its
    candidate scan is capped at 1024. See constants.rs and lib.rs#L482-L542:
    https://github.com/get-convex/convex-backend/blob/b7cce5a2331854895d36b683d1eab17c47ef13a9/crates/search/src/constants.rs
    https://docs.convex.dev/search/text-search#limits
    Never fill a page in a loop or infer exhaustion from a short/empty page.
    Preserve cursor/split metadata so the existing pager can keep loading. */
export async function filteredPage<T>(
  rows: { paginate: (opts: PaginationOptions) => Promise<PaginationResult<T>> },
  paginationOpts: PaginationOptions,
  keep: (row: T) => boolean,
  search?: string
): Promise<PaginationResult<T>> {
  // Leave headroom for hydration: 16 template drafts (up to 512 KiB each)
  // or 16 contacts' memberships (up to 500 each), plus auth and metadata.
  const opts = search?.trim()
    ? {
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, 16),
        maximumRowsRead: Math.max(
          1,
          Math.min(paginationOpts.maximumRowsRead ?? 16, 16)
        ),
        maximumBytesRead: Math.max(
          1,
          Math.min(paginationOpts.maximumBytesRead ?? 1024 * 1024, 1024 * 1024)
        ),
      }
    : paginationOpts
  return narrow(await rows.paginate(opts), keep)
}

type TeamTable =
  "exports" | "segments" | "topics" | "contactProperties" | "webhooks"

/** A team's rows, newest first, narrowed by `keep`. */
export async function teamPage<T extends TeamTable>(
  ctx: QueryCtx,
  table: T,
  organizationId: string,
  paginationOpts: PaginationOptions,
  keep: (row: Doc<T>) => boolean,
  search?: string
) {
  // Each of these tables has the same `by_organizationId` index.
  const rows = ctx.db
    .query(table as TeamTable)
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .order("desc")
  return filteredPage(
    rows as unknown as {
      paginate: (opts: PaginationOptions) => Promise<PaginationResult<Doc<T>>>
    },
    paginationOpts,
    keep,
    search
  )
}
