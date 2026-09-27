import { v, ConvexError } from "convex/values"
import { query, mutation, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { requireTeam } from "./access"
import schema from "./schema"
import { CLEANUP_BATCH, LIMITS, requireRoom } from "./audience"
import type { MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"

const segmentName = (name: string) => {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 200)
    throw new ConvexError("Name a segment in 1 to 200 characters")
  return trimmed
}

/** Every segment of the team, newest first; the limit keeps it one read. */
export const list = query({
  args: { organizationId: v.string() },
  returns: v.array(schema.doc("segments")),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    return ctx.db
      .query("segments")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .order("desc")
      .take(LIMITS.segments)
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), schema.doc("segments")),
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("segments", id)
    const segment = normalized ? await ctx.db.get("segments", normalized) : null
    if (!segment) return null
    await requireTeam(ctx, segment.organizationId)
    return segment
  },
})

export const create = mutation({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.id("segments"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    const name = segmentName(args.name)
    await requireRoom(ctx, "segments", args.organizationId)
    return ctx.db.insert("segments", {
      organizationId: args.organizationId,
      name,
      memberCount: 0,
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
    await ctx.db.patch("segments", args.id, { name: segmentName(args.name) })
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
    await ctx.db.delete("segments", id)
    await purgeMembers(ctx, id)
    return null
  },
})

async function purgeMembers(ctx: MutationCtx, segmentId: Id<"segments">) {
  const rows = await ctx.db
    .query("segmentMembers")
    .withIndex("by_segmentId", (q) => q.eq("segmentId", segmentId))
    .take(CLEANUP_BATCH)
  for (const row of rows) await ctx.db.delete("segmentMembers", row._id)
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
