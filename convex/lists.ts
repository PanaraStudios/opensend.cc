import type { PaginationOptions, PaginationResult } from "convex/server"
import {
  QueryStream,
  stream,
  type IndexBounds,
  type IndexKey,
} from "convex-helpers/server/stream"
import schema from "./schema"
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

/** Scan an ordinary index, then filter one bounded page. Full-text search
    cannot supply complete substring candidates: its token expansion retains
    64 unique terms INCLUDING equality filters (one team leaves 63), and its
    candidate scan is capped at 1024. See constants.rs and lib.rs#L482-L542:
    https://github.com/get-convex/convex-backend/blob/b7cce5a2331854895d36b683d1eab17c47ef13a9/crates/search/src/constants.rs
    https://docs.convex.dev/search/text-search#limits
    Never scan beyond the caller's budget or infer exhaustion from an empty page.
    Preserve cursor/split metadata so the existing pager can keep loading. */
export type SearchBudget = {
  rows: number
  bytes: number
  /** Reserve downstream reads for each kept row, before hydration starts. */
  bytesPerMatch?: number
}

type ListQuery<T extends NonNullable<unknown>> = QueryStream<T> & {
  inner(): {
    paginate: (opts: PaginationOptions) => Promise<PaginationResult<T>>
  }
}

/** Account for hydration in the stream's byte budget, including endCursor
    replays. Pagination stops at the last inspected key, never after dropping
    matches from an already-paginated page. */
class SearchStream<T extends NonNullable<unknown>> extends QueryStream<T> {
  constructor(
    private rows: QueryStream<T>,
    private keep: (row: T) => boolean | Promise<boolean>,
    private bytesPerMatch: number
  ) {
    super()
  }

  async *iterWithKeys(): AsyncGenerator<
    [T | null, IndexKey, number],
    undefined
  > {
    for await (const [row, key, bytes] of this.rows.iterWithKeys(true)) {
      const kept = row !== null && (await this.keep(row))
      yield [kept ? row : null, key, bytes + (kept ? this.bytesPerMatch : 0)]
    }
  }

  narrow(bounds: IndexBounds): SearchStream<T> {
    return new SearchStream(
      this.rows.narrow(bounds),
      this.keep,
      this.bytesPerMatch
    )
  }
  getOrder() {
    return this.rows.getOrder()
  }
  getIndexFields() {
    return this.rows.getIndexFields()
  }
  getEqualityIndexFilter() {
    return this.rows.getEqualityIndexFilter()
  }
}

const readLimit = (requested: number | undefined, maximum: number) =>
  requested === undefined || !Number.isFinite(requested)
    ? maximum
    : Math.max(1, Math.min(Math.floor(requested), maximum))

export async function filteredPage<T extends NonNullable<unknown>>(
  rows: ListQuery<T>,
  paginationOpts: PaginationOptions,
  keep: (row: T) => boolean | Promise<boolean>,
  budget: SearchBudget,
  search?: string
): Promise<PaginationResult<T>> {
  if (!search?.trim()) {
    const result = await rows.inner().paginate(paginationOpts)
    const page = []
    for (const row of result.page) if (await keep(row)) page.push(row)
    return { ...result, page }
  }
  return new SearchStream(rows, keep, budget.bytesPerMatch ?? 0).paginate({
    ...paginationOpts,
    // A UI request for one more match must still scan a useful batch.
    numItems: budget.rows,
    maximumRowsRead: readLimit(paginationOpts.maximumRowsRead, budget.rows),
    maximumBytesRead: readLimit(paginationOpts.maximumBytesRead, budget.bytes),
  })
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
  budget: SearchBudget,
  search?: string
) {
  // Each of these tables has the same `by_organizationId` index.
  const rows = stream(ctx.db, schema)
    .query(table as TeamTable)
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .order("desc")
  return filteredPage(
    rows as unknown as ListQuery<Doc<T>>,
    paginationOpts,
    keep,
    budget,
    search
  )
}
