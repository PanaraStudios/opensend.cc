import type { PaginationOptions, PaginationResult } from "convex/server"
import type { QueryCtx } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"
import { matchesNeedle, searchNeedle } from "../lib/dashboard/search"

/* Shared by the dashboard's list queries. A list whose filters no index
   expresses drops rows from each page instead, so a page may come back
   short; the dashboard's pager keeps loading until it fills or the list
   ends. */

/** Whether any of `fields` contains the whole search, ignoring case: what
    the dashboard's search boxes have always matched. A search index only
    finds candidates, since it matches any one word of the search. */
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

type TeamTable =
  | "automations"
  | "exports"
  | "segments"
  | "topics"
  | "contactProperties"
  | "webhooks"
  | "emails"
  | "suppressions"

/** A team's rows, newest first, narrowed by `keep`. */
export async function teamPage<T extends TeamTable>(
  ctx: QueryCtx,
  table: T,
  organizationId: string,
  paginationOpts: PaginationOptions,
  keep: (row: Doc<T>) => boolean
) {
  // Each of these tables has the same `by_organizationId` index.
  const result = (await ctx.db
    .query(table as TeamTable)
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .order("desc")
    .paginate(paginationOpts)) as unknown as PaginationResult<Doc<T>>
  return narrow(result, keep)
}
