import { v, ConvexError } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { query, mutation, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import schema from "./schema"
import { CLEANUP_BATCH, LIMITS, requireRoom } from "./audience"
import { countValue, counters, deleteRow, insertRow, patchRow } from "./counts"
import { matchesSearch, teamPage } from "./lists"
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

/** Every segment of the team, newest first, for pickers; the per-team
    limit keeps it one read. */
export const options = query({
  args: { organizationId: v.string() },
  returns: v.array(segmentValue),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    const segments = await ctx.db
      .query("segments")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .order("desc")
      .take(LIMITS.segments)
    return withSizes(ctx, segments)
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), segmentValue),
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("segments", id)
    const segment = normalized ? await ctx.db.get("segments", normalized) : null
    if (!segment) return null
    await requireTeam(ctx, segment.organizationId)
    return (await withSizes(ctx, [segment]))[0]
  },
})

export const create = mutation({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.id("segments"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    const name = segmentName(args.name)
    await requireRoom(ctx, "segments", args.organizationId)
    return insertRow(ctx, "segments", {
      organizationId: args.organizationId,
      name,
    })
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
    await patchRow(ctx, "segments", args.id, { name: segmentName(args.name) })
    return null
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
    await deleteRow(ctx, "segments", id)
    await purgeMembers(ctx, id)
    return null
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
