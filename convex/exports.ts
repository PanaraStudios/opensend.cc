import { ConvexError, v } from "convex/values"
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { requireTeam } from "./access"
import schema from "./schema"
import { EXPORT_SOURCES } from "./exportSources"
import { csvLine } from "../lib/dashboard/csv"

/** Ready files stay downloadable this long, as Settings → Exports says. */
const EXPORT_TTL = 7 * 86_400_000
/** Expired rows stay listed this much longer, then go. */
const EXPIRED_KEPT = 30 * 86_400_000
const BATCH = 500
/** An export stops here rather than run past an action's limits. */
const MAX_ROWS = 200_000

export const exportView = schema.doc("exports").omit("storageId", "filters")

export const start = mutation({
  args: {
    organizationId: v.string(),
    resource: v.string(),
    filters: v.record(v.string(), v.string()),
  },
  returns: v.id("exports"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    if (!Object.hasOwn(EXPORT_SOURCES, args.resource))
      throw new ConvexError("This list cannot be exported yet")
    const id = await ctx.db.insert("exports", {
      ...args,
      status: "processing",
      rows: 0,
      expiresAt: Date.now() + EXPORT_TTL,
    })
    await ctx.scheduler.runAfter(0, internal.exports.run, { id })
    return id
  },
})

export const list = query({
  args: { organizationId: v.string() },
  returns: v.array(exportView.extend({ label: v.string() })),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    const rows = await ctx.db
      .query("exports")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .order("desc")
      .take(100)
    return rows.map(({ storageId: _file, filters: _filters, ...row }) => ({
      ...row,
      label: EXPORT_SOURCES[row.resource]?.label ?? row.resource,
    }))
  },
})

/** A signed URL for a ready export's file. */
export const downloadUrl = query({
  args: { id: v.id("exports") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("exports", id)
    if (!row) return null
    await requireTeam(ctx, row.organizationId)
    if (row.status !== "ready" || !row.storageId) return null
    return ctx.storage.getUrl(row.storageId)
  },
})

export const job = internalQuery({
  args: { id: v.id("exports") },
  returns: v.union(v.null(), schema.doc("exports")),
  handler: (ctx, { id }) => ctx.db.get("exports", id),
})
export const page = internalQuery({
  args: {
    organizationId: v.string(),
    resource: v.string(),
    filters: v.record(v.string(), v.string()),
    cursor: v.union(v.null(), v.string()),
  },
  returns: v.object({
    rows: v.array(v.array(v.string())),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await EXPORT_SOURCES[args.resource].page(
      ctx,
      args.organizationId,
      args.filters,
      { numItems: BATCH, cursor: args.cursor }
    )
    return {
      rows: result.rows,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    }
  },
})

/** Pages through the resource and stores the CSV in file storage. */
export const run = internalAction({
  args: { id: v.id("exports") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.exports.job, { id })
    if (!row || row.status !== "processing") return null
    try {
      const source = EXPORT_SOURCES[row.resource]
      const lines = [csvLine(source.columns)]
      let cursor: string | null = null
      let rows = 0
      while (rows < MAX_ROWS) {
        const batch: {
          rows: string[][]
          isDone: boolean
          continueCursor: string
        } = await ctx.runQuery(internal.exports.page, {
          organizationId: row.organizationId,
          resource: row.resource,
          filters: row.filters,
          cursor,
        })
        for (const cells of batch.rows.slice(0, MAX_ROWS - rows))
          lines.push(csvLine(cells))
        rows += Math.min(batch.rows.length, MAX_ROWS - rows)
        if (batch.isDone) break
        cursor = batch.continueCursor
      }
      const storageId = await ctx.storage.store(
        new Blob(lines, { type: "text/csv;charset=utf-8" })
      )
      await ctx.runMutation(internal.exports.finish, { id, storageId, rows })
    } catch (e) {
      console.error(e)
      await ctx.runMutation(internal.exports.finish, { id })
    }
    return null
  },
})
/** Marks an export ready with its file, or failed without one. */
export const finish = internalMutation({
  args: {
    id: v.id("exports"),
    storageId: v.optional(v.id("_storage")),
    rows: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { id, storageId, rows }) => {
    const row = await ctx.db.get("exports", id)
    if (!row || row.status !== "processing") {
      // Expired or gone while it ran: the file has no one to go to.
      if (storageId) await ctx.storage.delete(storageId)
      return null
    }
    await ctx.db.patch(
      "exports",
      id,
      storageId
        ? { status: "ready", storageId, rows: rows ?? 0 }
        : { status: "failed" }
    )
    return null
  },
})

/** Deletes the files of exports past their expiry, then the rows once
    they have been listed as expired for a while. */
export const expire = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now()
    const due: Id<"exports">[] = []
    for (const status of ["processing", "ready", "failed"] as const)
      for (const row of await ctx.db
        .query("exports")
        .withIndex("by_status_and_expiresAt", (q) =>
          q.eq("status", status).lte("expiresAt", now)
        )
        .take(100)) {
        if (row.storageId) await ctx.storage.delete(row.storageId)
        await ctx.db.patch("exports", row._id, {
          status: "expired",
          storageId: undefined,
        })
        due.push(row._id)
      }
    for (const row of await ctx.db
      .query("exports")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", "expired").lte("expiresAt", now - EXPIRED_KEPT)
      )
      .take(100))
      await ctx.db.delete("exports", row._id)
    if (due.length >= 100)
      await ctx.scheduler.runAfter(0, internal.exports.expire, {})
    return null
  },
})
