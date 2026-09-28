import { ConvexError, v } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { requireTeam, sessionId } from "./access"
import schema from "./schema"
import { EXPORT_SOURCES } from "./exportSources"
import { deleteExport, insertExport, patchExport } from "./exportRows"
import { exportFilterLineValue } from "./tables/exports"
import { csvLine } from "../lib/dashboard/csv"
import { AUTO_DOWNLOAD_ROWS, exportFileName } from "../lib/dashboard/exports"

/** Completed files stay downloadable this long, as Resend keeps them. */
const EXPORT_TTL = 7 * 86_400_000
/** Expired rows stay listed this much longer, then go. */
const EXPIRED_KEPT = 30 * 86_400_000
const BATCH = 500
/** An export stops here rather than run past an action's limits. */
const MAX_ROWS = 200_000
/** Bounds on what a client may store with an export. */
const SUMMARY_LINES = 20
const FILTERS = 20
const TEXT = 500

export const exportView = schema
  .doc("exports")
  .omit("storageId", "filters", "fileName", "creatorEmail", "summary")
  .extend({
    fileName: v.string(),
    creatorEmail: v.string(),
    summary: v.array(exportFilterLineValue),
  })

/** What the dashboard sees: never the file itself, nor the raw filters. */
function view(row: Doc<"exports">) {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    organizationId: row.organizationId,
    resource: row.resource,
    status: row.status,
    rows: row.rows,
    expiresAt: row.expiresAt,
    fileName: row.fileName ?? exportFileName(row.resource, row._creationTime),
    creatorEmail: row.creatorEmail ?? "",
    summary: row.summary ?? [],
  }
}

const cut = (text: string) => text.slice(0, TEXT)

/** Any member starts an export of a list with its current filters: `filters`
    as the list's source reads them, `summary` as the dialog confirmed them. */
export const start = mutation({
  args: {
    organizationId: v.string(),
    resource: v.string(),
    filters: v.record(v.string(), v.string()),
    summary: v.array(exportFilterLineValue),
  },
  returns: v.id("exports"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    if (!Object.hasOwn(EXPORT_SOURCES, args.resource))
      throw new ConvexError("This list cannot be exported yet")
    const filters = Object.entries(args.filters)
    if (filters.length > FILTERS || args.summary.length > SUMMARY_LINES)
      throw new ConvexError("Too many filters")
    const creator = await ctx.runQuery(
      components.betterAuth.policy.checkSession,
      { sessionId: await sessionId(ctx) }
    )
    const now = Date.now()
    const id = await insertExport(ctx, {
      organizationId: args.organizationId,
      resource: args.resource,
      filters: Object.fromEntries(
        filters.map(([key, value]) => [key, cut(value)])
      ),
      status: "processing",
      rows: 0,
      expiresAt: now + EXPORT_TTL,
      fileName: exportFileName(args.resource, now),
      creatorEmail: creator.email,
      summary: args.summary.map((line) => ({
        label: cut(line.label),
        value: cut(line.value),
      })),
    })
    await ctx.scheduler.runAfter(0, internal.exports.run, { id })
    return id
  },
})

/** The team's exports, newest first. */
export const list = query({
  args: { organizationId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(exportView),
  handler: async (ctx, { organizationId, paginationOpts }) => {
    await requireTeam(ctx, organizationId)
    const result = await ctx.db
      .query("exports")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .order("desc")
      .paginate(paginationOpts)
    return { ...result, page: result.page.map(view) }
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), exportView),
  handler: async (ctx, { id }) => {
    const exportId = ctx.db.normalizeId("exports", id)
    const row = exportId ? await ctx.db.get("exports", exportId) : null
    if (!row) return null
    await requireTeam(ctx, row.organizationId)
    return view(row)
  },
})

/** A signed URL for a completed export's file. Members see exports; only
    team admins download them, as on Resend. */
export const downloadUrl = query({
  args: { id: v.id("exports") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("exports", id)
    if (!row) return null
    await requireTeam(ctx, row.organizationId, "admin")
    if (row.status !== "ready" || !row.storageId) return null
    return ctx.storage.getUrl(row.storageId)
  },
})

export const job = internalQuery({
  args: { id: v.id("exports") },
  returns: v.union(v.null(), schema.doc("exports")),
  handler: (ctx, { id }) => ctx.db.get("exports", id),
})
/** The file's header row, read once so every batch keeps to it. */
export const header = internalQuery({
  args: { organizationId: v.string(), resource: v.string() },
  returns: v.object({ columns: v.array(v.string()), extra: v.array(v.string()) }),
  handler: async (ctx, { organizationId, resource }) => {
    const source = EXPORT_SOURCES[resource]
    return {
      columns: [...source.columns],
      extra: (await source.extraColumns?.(ctx, organizationId)) ?? [],
    }
  },
})
export const page = internalQuery({
  args: {
    organizationId: v.string(),
    resource: v.string(),
    filters: v.record(v.string(), v.string()),
    extra: v.array(v.string()),
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
      { numItems: BATCH, cursor: args.cursor },
      args.extra
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
      const { columns, extra } = await ctx.runQuery(internal.exports.header, {
        organizationId: row.organizationId,
        resource: row.resource,
      })
      const lines = [csvLine([...columns, ...extra])]
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
          extra,
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
/** Marks an export completed with its file, or failed without one. */
export const finish = internalMutation({
  args: {
    id: v.id("exports"),
    storageId: v.optional(v.id("_storage")),
    rows: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { id, storageId, rows = 0 }) => {
    const row = await ctx.db.get("exports", id)
    if (!row || row.status !== "processing") {
      // Expired or gone while it ran: the file has no one to go to.
      if (storageId) await ctx.storage.delete(storageId)
      return null
    }
    await patchExport(
      ctx,
      id,
      storageId ? { status: "ready", storageId, rows } : { status: "failed" }
    )
    // Too long to come down in the browser: Resend emails the creator.
    if (storageId && rows > AUTO_DOWNLOAD_ROWS)
      await ctx.scheduler.runAfter(0, internal.exports.emailCreator, { id })
    return null
  },
})
/** Emails a completed long export's creator a link to it, as Resend does.
    TODO(sending lane): send it through the installation sender once that
    exists: to `creatorEmail`, linking `/settings/exports/{id}`. Until then
    the export waits in Settings → Exports, and the dashboard says so. */
export const emailCreator = internalAction({
  args: { id: v.id("exports") },
  returns: v.null(),
  handler: async () => null,
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
        await patchExport(ctx, row._id, {
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
      await deleteExport(ctx, row._id)
    if (due.length >= 100)
      await ctx.scheduler.runAfter(0, internal.exports.expire, {})
    return null
  },
})
