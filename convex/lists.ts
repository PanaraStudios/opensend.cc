import { OPTION_LIMIT } from "../lib/dashboard/options"
import type { PaginationOptions, PaginationResult } from "convex/server"
import {
  QueryStream,
  stream,
  type IndexBounds,
  type IndexKey,
} from "convex-helpers/server/stream"
import schema from "./schema"
import type { QueryCtx } from "./_generated/server"
import { requireTeam } from "./access"
import type { Doc, TableNames } from "./_generated/dataModel"
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
export type SearchBudget<T = unknown> = {
  rows: number
  bytes: number
  /** Reserve downstream reads for each kept row, before hydration starts. */
  bytesPerMatch?: number | ((row: T) => number)
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
    private bytesPerMatch: number | ((row: T) => number)
  ) {
    super()
  }

  async *iterWithKeys(): AsyncGenerator<
    [T | null, IndexKey, number],
    undefined
  > {
    for await (const [row, key, bytes] of this.rows.iterWithKeys(true)) {
      const kept = row !== null && (await this.keep(row))
      const reserved = kept
        ? typeof this.bytesPerMatch === "function"
          ? this.bytesPerMatch(row)
          : this.bytesPerMatch
        : 0
      yield [kept ? row : null, key, bytes + reserved]
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

/** `rows` is one index's query, or a merge of several (`mergedStream`),
    which pages through the stream itself. */
export async function filteredPage<T extends NonNullable<unknown>>(
  rows: ListQuery<T> | QueryStream<T>,
  paginationOpts: PaginationOptions,
  keep: (row: T) => boolean | Promise<boolean>,
  budget: SearchBudget<T>,
  search?: string
): Promise<PaginationResult<T>> {
  if (!search?.trim()) {
    const result = await ("inner" in rows
      ? rows.inner().paginate(paginationOpts)
      : rows.paginate(paginationOpts))
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
  | "broadcasts"
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
  keep: (row: Doc<T>) => boolean,
  budget: SearchBudget<Doc<T>>,
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

export type TeamRowTable = {
  [T in TableNames]: Doc<T> extends { organizationId: string } ? T : never
}[TableNames]
export type TeamRowOptions<T extends TeamRowTable> = {
  keep?: (row: Doc<T>) => boolean
  fallback?: () => Promise<Doc<T> | null>
  /** Aliases usually apply only when the value is not a document ID. */
  fallbackOnMissing?: boolean
}

export async function teamRow<T extends TeamRowTable>(
  ctx: QueryCtx,
  table: T,
  organizationId: string,
  id: string | undefined,
  options: TeamRowOptions<T> = {}
): Promise<Doc<T> | null> {
  if (id === undefined) return null
  const normalized = ctx.db.normalizeId(table, id)
  let row = normalized ? await ctx.db.get(table, normalized) : null
  if (row?.organizationId !== organizationId) row = null
  if ((!normalized || (!row && options.fallbackOnMissing)) && options.fallback)
    row = await options.fallback()
  return row?.organizationId === organizationId &&
    (!options.keep || options.keep(row))
    ? row
    : null
}

/** Resolve the current selection independently of the bounded suggestions. */
export function selectedOption<T extends TeamRowTable>(
  ctx: QueryCtx,
  table: T,
  organizationId: string,
  id: string | undefined
) {
  return teamRow(ctx, table, organizationId, id || undefined)
}

/** Dashboard detail access is checked after resolving the document's team. */
export async function readTeamRow<T extends TeamRowTable>(
  ctx: QueryCtx,
  table: T,
  id: string,
  options: { beforeAccess?: (row: Doc<T>) => boolean } = {}
): Promise<Doc<T> | null> {
  const normalized = ctx.db.normalizeId(table, id)
  const row = normalized ? await ctx.db.get(table, normalized) : null
  if (!row || (options.beforeAccess && !options.beforeAccess(row))) return null
  await requireTeam(ctx, row.organizationId)
  return row
}

export async function hasTeamRows(
  ctx: QueryCtx,
  table: "webhooks" | "apiLogs" | "templates" | "apiKeys",
  organizationId: string
) {
  await requireTeam(ctx, organizationId)
  return (
    (await ctx.db
      .query(table)
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .first()) !== null
  )
}

/** Topics have an enforced per-team write limit, so they load whole. */
export function configurationRows(
  ctx: QueryCtx,
  table: "topics",
  organizationId: string,
  limit: number
) {
  return ctx.db
    .query(table)
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .order("desc")
    .take(limit)
}

/** Bounded full-text suggestions, otherwise the team's newest rows. */
export function searchOptions<T extends "segments" | "templates" | "emails">(
  ctx: QueryCtx,
  table: T,
  organizationId: string,
  search?: string
): Promise<Doc<T>[]>
export async function searchOptions(
  ctx: QueryCtx,
  table: "segments" | "templates" | "emails",
  organizationId: string,
  search?: string
) {
  const needle = search?.trim()
  const rows = needle
    ? table === "segments"
      ? ctx.db
          .query("segments")
          .withSearchIndex("search_name", (q) =>
            q.search("name", needle).eq("organizationId", organizationId)
          )
      : table === "templates"
        ? ctx.db
            .query("templates")
            .withSearchIndex("search_searchText", (q) =>
              q
                .search("searchText", needle)
                .eq("organizationId", organizationId)
            )
        : ctx.db
            .query("emails")
            .withSearchIndex("search_search", (q) =>
              q.search("search", needle).eq("organizationId", organizationId)
            )
    : ctx.db
        .query(table)
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId)
        )
        .order("desc")
  return rows.take(OPTION_LIMIT)
}

/** Prefix suggestions retain the caller's case normalization and index order. */
export function prefixOptions<
  T extends "contacts" | "automationEvents" | "domains",
>(
  ctx: QueryCtx,
  table: T,
  organizationId: string,
  prefix: string
): Promise<Doc<T>[]>
export async function prefixOptions(
  ctx: QueryCtx,
  table: "contacts" | "automationEvents" | "domains",
  organizationId: string,
  prefix: string
) {
  const rows = prefix
    ? table === "contacts"
      ? ctx.db.query("contacts").withIndex("by_organizationId_and_email", (q) =>
          q
            .eq("organizationId", organizationId)
            .gte("email", prefix)
            .lt("email", prefix + "\uffff")
        )
      : table === "automationEvents"
        ? ctx.db
            .query("automationEvents")
            .withIndex("by_organizationId_and_name", (q) =>
              q
                .eq("organizationId", organizationId)
                .gte("name", prefix)
                .lt("name", prefix + "\uffff")
            )
        : ctx.db.query("domains").withIndex("by_organizationId_and_name", (q) =>
            q
              .eq("organizationId", organizationId)
              .gte("name", prefix)
              .lt("name", prefix + "\uffff")
          )
    : ctx.db
        .query(table)
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId)
        )
        .order("desc")
  return rows.take(OPTION_LIMIT)
}
