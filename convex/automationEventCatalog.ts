import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server"
import { v } from "convex/values"
import { eventCatalog, type CatalogEvent } from "../lib/event-catalog"
import { OPTION_LIMIT } from "../lib/dashboard/options"
import { CATALOG_SELECTED_LIMIT } from "../lib/dashboard/event-catalog-options"
import { requireTeam } from "./access"
import { listProperties } from "./audience"
import { findEvent } from "./automationEvents"
import { invalid } from "./api/caller"
import { query, type QueryCtx } from "./_generated/server"

export const CATALOG_PAGE_LIMIT = 100
export const CATALOG_PAGE_BYTES = 256 * 1024

/** The built-in events are a fixed, bounded set prepended to the first page.
 * numItems limits custom definitions; later pages contain only custom events.
 * Preserve Convex's native continuation and split metadata. */
export async function catalogPage(
  ctx: QueryCtx,
  organizationId: string,
  paginationOpts: PaginationOptions,
  search?: string
) {
  if (
    !Number.isInteger(paginationOpts.numItems) ||
    paginationOpts.numItems < 1 ||
    paginationOpts.numItems > CATALOG_PAGE_LIMIT
  )
    throw invalid(
      `Request between 1 and ${CATALOG_PAGE_LIMIT} custom event types`
    )
  // Reactive endCursor ranges can grow beyond numItems. Require a bounded
  // read budget for those replays rather than losing optional native fields.
  if (
    (paginationOpts.endCursor &&
      paginationOpts.maximumRowsRead === undefined) ||
    (paginationOpts.maximumRowsRead !== undefined &&
      (!Number.isInteger(paginationOpts.maximumRowsRead) ||
        paginationOpts.maximumRowsRead < 1 ||
        paginationOpts.maximumRowsRead > CATALOG_PAGE_LIMIT)) ||
    (paginationOpts.maximumBytesRead !== undefined &&
      (!Number.isInteger(paginationOpts.maximumBytesRead) ||
        paginationOpts.maximumBytesRead < 1 ||
        paginationOpts.maximumBytesRead > CATALOG_PAGE_BYTES))
  )
    throw invalid("Catalog pages require bounded read budgets")
  const needle = catalogSearch(search)
  const source = needle
    ? ctx.db
        .query("automationEvents")
        .withSearchIndex("search_name", (q) =>
          q.search("name", needle).eq("organizationId", organizationId)
        )
    : ctx.db
        .query("automationEvents")
        .withIndex("by_organizationId_and_name", (q) =>
          q.eq("organizationId", organizationId)
        )
  const result = await source.paginate(paginationOpts)
  const catalog = eventCatalog(
    result.page,
    paginationOpts.cursor === null
      ? await listProperties(ctx, organizationId)
      : []
  )
  return {
    ...result,
    page: catalog.filter(
      (event) =>
        event.group === "Custom events" ||
        (paginationOpts.cursor === null && matchesSystemEvent(event, needle))
    ),
  }
}

function catalogSearch(search?: string) {
  const needle = search?.trim() ?? ""
  if (needle.length > 256)
    throw invalid("Search event names with at most 256 characters")
  return needle
}
function matchesSystemEvent(event: CatalogEvent, needle: string) {
  return `${event.name} ${event.trigger} ${event.label} ${event.description}`
    .toLowerCase()
    .includes(needle.toLowerCase())
}

export const page = query({
  args: { organizationId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.any()),
  handler: async (ctx, { organizationId, paginationOpts }) => {
    await requireTeam(ctx, organizationId, "read")
    return catalogPage(ctx, organizationId, paginationOpts)
  },
})
export const search = query({
  args: {
    organizationId: v.string(),
    search: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(v.any()),
  handler: async (ctx, { organizationId, search, paginationOpts }) => {
    await requireTeam(ctx, organizationId, "read")
    return catalogPage(ctx, organizationId, paginationOpts, search)
  },
})

/** Server-search suggestions plus exact saved names, as in pickerOptions.
 * Triggers are stored as names, so selections use indexed name lookups.
 * An exact search lookup also makes every custom name reachable when a text
 * index's prefix expansion would otherwise truncate the candidate set. */
export async function catalogOptions(
  ctx: QueryCtx,
  organizationId: string,
  search?: string,
  selectedNames: readonly string[] = []
) {
  if (selectedNames.length > CATALOG_SELECTED_LIMIT)
    throw invalid(`Look up at most ${CATALOG_SELECTED_LIMIT} saved event types`)
  const needle = catalogSearch(search)
  const rows = needle
    ? await ctx.db
        .query("automationEvents")
        .withSearchIndex("search_name", (q) =>
          q.search("name", needle).eq("organizationId", organizationId)
        )
        .take(OPTION_LIMIT)
    : await ctx.db
        .query("automationEvents")
        .withIndex("by_organizationId_and_name", (q) =>
          q.eq("organizationId", organizationId)
        )
        .take(OPTION_LIMIT)
  const seen = new Set(rows.map((row) => row.name))
  for (const name of new Set([...selectedNames, ...(needle ? [needle] : [])])) {
    if (seen.has(name) || name.startsWith("opensend:")) continue
    const row = await findEvent(ctx, organizationId, name)
    if (row) {
      rows.push(row)
      seen.add(row.name)
    }
  }
  return eventCatalog(rows, await listProperties(ctx, organizationId)).filter(
    (event) =>
      event.group === "Custom events" ||
      selectedNames.includes(event.trigger) ||
      matchesSystemEvent(event, needle)
  )
}
export const options = query({
  args: {
    organizationId: v.string(),
    search: v.optional(v.string()),
    selectedNames: v.optional(v.array(v.string())),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { organizationId, search, selectedNames }) => {
    await requireTeam(ctx, organizationId, "read")
    return catalogOptions(ctx, organizationId, search, selectedNames)
  },
})
