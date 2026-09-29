import { includeSelected } from "../lib/dashboard/options"
import { PAGE_SIZES } from "../lib/dashboard/pagination"
import { v, ConvexError } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { query, mutation, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import schema from "./schema"
import { CLEANUP_BATCH } from "./audience"
import { countValue, counters, deleteRow, insertRow, patchRow } from "./counts"
import {
  matchesSearch,
  teamPage,
  selectedOption,
  readTeamRow,
  searchOptions,
} from "./lists"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

const segmentName = (name: string) => {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 200)
    throw new ConvexError("Name a segment in 1 to 200 characters")
  return trimmed
}

/** A segment with its size, read from the member counts. */
const segmentValue = schema
  .doc("segments")
  .omit("memberCount")
  .extend({ memberCount: v.number() })
async function withSizes(ctx: QueryCtx, segments: Doc<"segments">[]) {
  const sizes = await counters.segmentMembers.totals(
    ctx,
    segments.map((segment) => segment._id)
  )
  return segments.map((segment, index) => ({
    _id: segment._id,
    _creationTime: segment._creationTime,
    organizationId: segment.organizationId,
    name: segment.name,
    memberCount: sizes[index],
  }))
}

const segmentFilters = {
  organizationId: v.string(),
  search: v.optional(v.string()),
}

// 256 segments; reserve 128 KiB per aggregate total (tree + root + up to 17 children).
export const SEGMENT_SEARCH_BUDGET = {
  rows: 256,
  bytes: 4 * 1024 * 1024,
  bytesPerMatch: 128 * 1024,
}

/** The team's segments, newest first, a page at a time. */
export const list = query({
  args: { ...segmentFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(segmentValue),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const matches = matchesSearch(args.search)
    const result = await teamPage(
      ctx,
      "segments",
      args.organizationId,
      args.paginationOpts,
      (segment) => matches(segment.name),
      SEGMENT_SEARCH_BUDGET,
      args.search
    )
    return { ...result, page: await withSizes(ctx, result.page) }
  },
})

export const count = query({
  args: segmentFilters,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    if (args.search?.trim()) return { total: null }
    return { total: await counters.segments.total(ctx, args.organizationId) }
  },
})

/** Up to twenty segments for a picker, newest first or matching `search`,
    plus the selected one wherever it falls. Never the whole list: a team
    has any number of segments. */
export const options = query({
  args: {
    organizationId: v.string(),
    search: v.optional(v.string()),
    selectedId: v.optional(v.id("segments")),
  },
  returns: v.array(segmentValue),
  handler: async (ctx, { organizationId, search, selectedId }) => {
    await requireTeam(ctx, organizationId, "read")
    const rows = await searchOptions(ctx, "segments", organizationId, search)
    const selected = await selectedOption(
      ctx,
      "segments",
      organizationId,
      selectedId
    )
    return withSizes(
      ctx,
      includeSelected(rows, selected, (row) => row._id)
    )
  },
})

/** Which of `contactIds` (one list page) are in the segment. */
export const memberIds = query({
  args: { id: v.id("segments"), contactIds: v.array(v.id("contacts")) },
  returns: v.array(v.id("contacts")),
  handler: async (ctx, { id, contactIds }) => {
    const segment = await ctx.db.get("segments", id)
    if (!segment) return []
    await requireTeam(ctx, segment.organizationId)
    if (contactIds.length > Math.max(...PAGE_SIZES))
      throw new ConvexError("Check one page of contacts at a time")
    const members = []
    for (const contactId of new Set(contactIds))
      if (
        await ctx.db
          .query("segmentMembers")
          .withIndex("by_contactId_and_segmentId", (q) =>
            q.eq("contactId", contactId).eq("segmentId", id)
          )
          .unique()
      )
        members.push(contactId)
    return members
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), segmentValue),
  handler: async (ctx, { id }) => {
    const segment = await readTeamRow(ctx, "segments", id)
    if (!segment) return null
    return (await withSizes(ctx, [segment]))[0]
  },
})

export const create = mutation({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.id("segments"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    return createSegment(ctx, args)
  },
})

async function writable(ctx: MutationCtx, id: Id<"segments">) {
  const segment = await ctx.db.get("segments", id)
  if (!segment) throw new ConvexError("Segment not found")
  await requireTeam(ctx, segment.organizationId, "write")
  return segment
}

export const update = mutation({
  args: { id: v.id("segments"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await writable(ctx, args.id)
    return updateSegment(ctx, args)
  },
})

/** The segment goes at once; its memberships follow in batches. Contacts
    stay. Broadcasts still live in the demo store, which clears their
    reference itself; the broadcasts lane must do the same server-side. */
export const remove = mutation({
  args: { id: v.id("segments") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await writable(ctx, id)
    return removeSegment(ctx, id)
  },
})

async function purgeMembers(ctx: MutationCtx, segmentId: Id<"segments">) {
  const rows = await ctx.db
    .query("segmentMembers")
    .withIndex("by_segmentId", (q) => q.eq("segmentId", segmentId))
    .take(CLEANUP_BATCH)
  for (const row of rows) await deleteRow(ctx, "segmentMembers", row._id)
  if (rows.length === CLEANUP_BATCH)
    await ctx.scheduler.runAfter(0, internal.segments.purge, { segmentId })
}
export const purge = internalMutation({
  args: { segmentId: v.id("segments") },
  returns: v.null(),
  handler: async (ctx, { segmentId }) => {
    await purgeMembers(ctx, segmentId)
    return null
  },
})

export async function createSegment(
  ctx: MutationCtx,
  args: { organizationId: string; name: string }
) {
  const name = segmentName(args.name)
  return insertRow(ctx, "segments", {
    organizationId: args.organizationId,
    name,
  })
}

export async function updateSegment(
  ctx: MutationCtx,
  args: { id: Id<"segments">; name: string }
) {
  await patchRow(ctx, "segments", args.id, { name: segmentName(args.name) })
  return null
}

export async function removeSegment(ctx: MutationCtx, id: Id<"segments">) {
  await deleteRow(ctx, "segments", id)
  await purgeMembers(ctx, id)
  return null
}
