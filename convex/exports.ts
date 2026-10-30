import { fileReference } from "./tables/storage"
import { fileUrl } from "./storage/urls"
import { deleteFile } from "./storage/files"
import { ConvexError, v } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
  type HttpRouter,
} from "convex/server"
import {
  action,
  env,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { findInstallation, requireTeam, sessionId } from "./access"
import schema from "./schema"
import { countValue, counters } from "./counts"
import { teamPage, readTeamRow } from "./lists"
import { EXPORT_SOURCES } from "./exportSources"
import {
  deleteExport,
  deleteExportFiles,
  insertExport,
  patchExport,
} from "./exportRows"
import { exportFilterLineValue } from "./tables/exports"
import { signedFileLink, verifyFileToken } from "./fileDownloads"
import { sendSystemEmail } from "./systemEmail"
import { retirement } from "./teamLifecycle"
import { csvLine } from "../lib/dashboard/csv"
import { AUTO_DOWNLOAD_ROWS, exportFileName } from "../lib/dashboard/exports"
import {
  VOLUME_BYTES,
  exportVolumes,
  volumeFileName,
} from "../lib/exports/volumes"

/** Completed files stay downloadable this long, as Resend keeps them. */
const EXPORT_TTL = 7 * 86_400_000
/** Expired rows stay listed this much longer, then go. */
const EXPIRED_KEPT = 30 * 86_400_000
const BATCH = 500
const CSV_TYPE = "text/csv;charset=utf-8"
/** Exports are written in parts of about `partBytes`, one short action
    each, and stop at `rows` or `bytes`. Downloads come as one file up to
    `volumeBytes`. Tests lower these; nothing else changes them. */
export const exportLimits = {
  rows: 1_000_000,
  bytes: 1024 * 1024 * 1024,
  partBytes: 8 * 1024 * 1024,
  volumeBytes: VOLUME_BYTES,
}
/** Bounds on what a client may store with an export. */
const SUMMARY_LINES = 20
const FILTERS = 20
const TEXT = 500

export const exportView = schema
  .doc("exports")
  .omit(
    "storageId",
    "fileId",
    "parts",
    "header",
    "cursor",
    "bytes",
    "filters",
    "fileName",
    "creatorEmail",
    "summary",
    "notificationEmailId",
    "touchedAt"
  )
  .extend({
    fileName: v.string(),
    creatorEmail: v.string(),
    summary: v.array(exportFilterLineValue),
    /** Files the download comes as: more than one past `volumeBytes`. */
    volumes: v.number(),
  })

/** What the dashboard sees: never the file itself, nor the raw filters. */
function view(row: Doc<"exports">) {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    organizationId: row.organizationId,
    resource: row.resource,
    // The dashboard derives "expired" from `expiresAt` against its own clock.
    status: row.status,
    rows: row.rows,
    error: row.error,
    expiresAt: row.expiresAt,
    fileName: row.fileName ?? exportFileName(row.resource, row._creationTime),
    creatorEmail: row.creatorEmail ?? "",
    summary: row.summary ?? [],
    volumes: row.parts?.length ? volumesOf(row).length : 1,
  }
}

function headerLine(row: Doc<"exports">) {
  return csvLine(row.header ?? [])
}
function volumesOf(row: Doc<"exports">) {
  return exportVolumes(
    row.parts ?? [],
    new TextEncoder().encode(headerLine(row)).byteLength,
    exportLimits.volumeBytes
  )
}

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
    if (
      filters.some(
        ([key, value]) => key.length > TEXT || value.length > TEXT
      ) ||
      args.summary.some(
        (line) => line.label.length > TEXT || line.value.length > TEXT
      )
    )
      throw new ConvexError("Export filters are too long")
    const creator = await ctx.runQuery(
      components.betterAuth.policy.checkSession,
      { sessionId: await sessionId(ctx) }
    )
    const now = Date.now()
    const id = await insertExport(ctx, {
      organizationId: args.organizationId,
      resource: args.resource,
      filters: args.filters,
      status: "processing",
      rows: 0,
      expiresAt: now + EXPORT_TTL,
      touchedAt: now,
      fileName: exportFileName(args.resource, now),
      creatorEmail: creator.email,
      summary: args.summary,
    })
    await ctx.scheduler.runAfter(0, internal.exports.run, { id })
    return id
  },
})

// 1024 export metadata rows, no hydration; file contents are never read by the list.
export const EXPORT_SEARCH_BUDGET = { rows: 1024, bytes: 4 * 1024 * 1024 }

/** The team's exports, newest first. */
export const list = query({
  args: { organizationId: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(exportView),
  handler: async (ctx, { organizationId, paginationOpts }) => {
    await requireTeam(ctx, organizationId)
    const result = await teamPage(
      ctx,
      "exports",
      organizationId,
      paginationOpts,
      () => true,
      EXPORT_SEARCH_BUDGET
    )
    return { ...result, page: result.page.map(view) }
  },
})

export const count = query({
  args: { organizationId: v.string() },
  returns: countValue,
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "read")
    return { total: await counters.exports.total(ctx, organizationId) }
  },
})

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), exportView),
  handler: async (ctx, { id }) => {
    const row = await readTeamRow(ctx, "exports", id)
    if (!row) return null
    return view(row)
  },
})

/** Where a completed export downloads from. Members see exports; only
    team admins download them, as on Resend. Exports written in parts stream
    through the HTTP route behind a short-lived signed link, one link per
    file (`volume`); older exports keep their single stored file. */
export const downloadUrl = action({
  args: { id: v.id("exports"), volume: v.optional(v.number()) },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { id, volume = 0 }): Promise<string | null> => {
    const target: { url: string } | { volumes: number } | null =
      await ctx.runQuery(internal.exports.downloadTarget, {
        id,
        now: Date.now(),
      })
    if (!target) return null
    if ("url" in target) return volume === 0 ? target.url : null
    if (!Number.isInteger(volume) || volume < 0 || volume >= target.volumes)
      return null
    const link = await signedFileLink(ctx, DOWNLOAD_PREFIX, DOWNLOAD_AUDIENCE, {
      exportId: id,
      volume,
    })
    return link.download_url
  },
})
/** Queries carry no clock: `downloadUrl` passes the time in. */
export const downloadTarget = internalQuery({
  args: { id: v.id("exports"), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({ url: v.string() }),
    v.object({ volumes: v.number() })
  ),
  handler: async (ctx, { id, now }) => {
    const row = await ctx.db.get("exports", id)
    if (!row) return null
    await requireTeam(ctx, row.organizationId, "admin")
    if (row.status !== "ready" || row.expiresAt <= now) return null
    if (row.parts?.length) return { volumes: volumesOf(row).length }
    if (!row.storageId && !row.fileId) return null
    const url = await fileUrl(ctx, row, { filename: row.fileName })
    return url ? { url } : null
  },
})

/** One downloadable file of a ready export: its parts' storage in order.
    The signed link already proved the caller was a team admin. */
export const volume = internalQuery({
  args: { id: v.string(), volume: v.number(), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      fileName: v.string(),
      header: v.union(v.null(), v.string()),
      storageIds: v.array(v.id("_storage")),
      bytes: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("exports", args.id)
    const row = id ? await ctx.db.get("exports", id) : null
    if (
      !row?.parts?.length ||
      row.status !== "ready" ||
      row.expiresAt <= args.now ||
      (await retirement(ctx, row.organizationId))
    )
      return null
    const volumes = volumesOf(row)
    const target = volumes[args.volume]
    if (!target) return null
    const storageIds: Id<"_storage">[] = []
    for (const part of row.parts.slice(target.from, target.to)) {
      const file = await ctx.db.get("storedFiles", part.fileId)
      if (file?.state !== "ready" || !file.storageId) return null
      storageIds.push(file.storageId)
    }
    return {
      fileName: volumeFileName(
        row.fileName ?? exportFileName(row.resource, row._creationTime),
        args.volume,
        volumes.length
      ),
      header: args.volume === 0 ? null : headerLine(row),
      storageIds,
      bytes: target.bytes,
    }
  },
})

const DOWNLOAD_PREFIX = "/exports/download/"
const DOWNLOAD_AUDIENCE = "export-download"

/** Streams one file of an export: the parts are read from storage one at a
    time, so memory holds a single part, never the whole CSV. */
const downloadExport = httpAction(async (ctx, request) => {
  let exportId: string, index: number
  try {
    const payload = await verifyFileToken(
      new URL(request.url).pathname.slice(DOWNLOAD_PREFIX.length),
      DOWNLOAD_AUDIENCE
    )
    if (
      typeof payload.exportId !== "string" ||
      typeof payload.volume !== "number"
    )
      throw new Error("Invalid export token")
    exportId = payload.exportId
    index = payload.volume
  } catch {
    return new Response(null, { status: 404 })
  }
  const file = await ctx.runQuery(internal.exports.volume, {
    id: exportId,
    volume: index,
    now: Date.now(),
  })
  if (!file) return new Response(null, { status: 404 })
  let header = file.header
  let next = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (header) {
        controller.enqueue(new TextEncoder().encode(header))
        header = null
      }
      while (true) {
        if (reader) {
          const chunk = await reader.read()
          if (!chunk.done) return controller.enqueue(chunk.value)
          reader = null
        }
        if (next >= file.storageIds.length) return controller.close()
        const blob = await ctx.storage.get(file.storageIds[next++])
        if (!blob) return controller.error(new Error("Export part missing"))
        reader = blob.stream().getReader()
      }
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": CSV_TYPE,
      "Content-Length": String(file.bytes),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
})
export function registerExportRoutes(http: HttpRouter) {
  http.route({
    pathPrefix: DOWNLOAD_PREFIX,
    method: "GET",
    handler: downloadExport,
  })
}

export const job = internalQuery({
  args: { id: v.id("exports") },
  returns: v.union(v.null(), schema.doc("exports")),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("exports", id)
    return row && !(await retirement(ctx, row.organizationId)) ? row : null
  },
})
/** The file's header row, read once so every batch keeps to it. */
export const header = internalQuery({
  args: { organizationId: v.string(), resource: v.string() },
  returns: v.object({
    columns: v.array(v.string()),
    extra: v.array(v.string()),
  }),
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

/** Writes the next part of the CSV: pages through the resource until the
    part holds `partBytes` (or the source ends), stores it and hands it to
    `addPart`, which records it and schedules the next part. Each run is a
    few seconds of work over about one part, resumable from the cursor on
    the row, so the CSV is never held in memory whole. */
export const run = internalAction({
  args: { id: v.id("exports") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.exports.job, { id })
    if (!row || row.status !== "processing") return null
    const index = row.parts?.length ?? 0
    let stored: Id<"_storage"> | null = null
    try {
      let header = row.header
      let extra: string[]
      if (index > 0 && header)
        extra = header.slice(EXPORT_SOURCES[row.resource].columns.length)
      else {
        const read = await ctx.runQuery(internal.exports.header, {
          organizationId: row.organizationId,
          resource: row.resource,
        })
        header = [...read.columns, ...read.extra]
        extra = read.extra
      }
      const encoder = new TextEncoder()
      const chunks: Uint8Array<ArrayBuffer>[] =
        index === 0 ? [encoder.encode(csvLine(header))] : []
      let bytes = index === 0 ? chunks[0].byteLength : 0
      let cursor: string | null = row.cursor ?? null
      let rows = 0
      let isDone = false
      // Every part reads at least one page, so each one moves the cursor on.
      while (true) {
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
        if (row.rows + rows + batch.rows.length > exportLimits.rows)
          throw new ConvexError(
            `Export exceeds ${exportLimits.rows.toLocaleString("en-US")} rows. Choose a smaller date range or add filters.`
          )
        for (const cells of batch.rows) {
          const chunk = encoder.encode(csvLine(cells))
          bytes += chunk.byteLength
          if ((row.bytes ?? 0) + bytes > exportLimits.bytes)
            throw new ConvexError(
              "Export exceeds 1 GiB. Choose a smaller date range or add filters."
            )
          chunks.push(chunk)
        }
        rows += batch.rows.length
        cursor = batch.continueCursor
        if (batch.isDone) {
          isDone = true
          break
        }
        if (bytes >= exportLimits.partBytes) break
      }
      // A source that ends right after a full part leaves nothing to store.
      if (bytes > 0)
        stored = await ctx.storage.store(new Blob(chunks, { type: CSV_TYPE }))
      await ctx.runMutation(internal.exports.addPart, {
        id,
        index,
        part: stored ? { storageId: stored, rows, bytes } : undefined,
        header,
        cursor: cursor ?? "",
        isDone,
      })
    } catch (error) {
      console.error("Export could not be completed")
      // `addPart` did not commit, so the part it was given has no owner.
      if (stored) await ctx.storage.delete(stored)
      await ctx.runMutation(internal.exports.finish, {
        id,
        error:
          error instanceof ConvexError
            ? String(error.data)
            : "Export could not be completed. Try again with fewer rows.",
      })
    }
    return null
  },
})

/** Records part `index` as a stored file and continues, or completes the
    export after the last part. A part for an export that moved on
    (expired, failed, retired, or a duplicate run) is deleted instead. */
export const addPart = internalMutation({
  args: {
    id: v.id("exports"),
    index: v.number(),
    part: v.optional(
      v.object({
        storageId: v.id("_storage"),
        rows: v.number(),
        bytes: v.number(),
      })
    ),
    header: v.array(v.string()),
    cursor: v.string(),
    isDone: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { id, index, part, header, cursor, isDone }) => {
    const row = await ctx.db.get("exports", id)
    if (
      !row ||
      row.status !== "processing" ||
      (row.parts?.length ?? 0) !== index ||
      (await retirement(ctx, row.organizationId))
    ) {
      if (part) await ctx.storage.delete(part.storageId)
      return null
    }
    const parts = [...(row.parts ?? [])]
    if (part) {
      const fileId = await ctx.db.insert("storedFiles", {
        organizationId: row.organizationId,
        provider: "convex",
        storageId: part.storageId,
        size: part.bytes,
        contentType: CSV_TYPE,
        filename: row.fileName,
        feature: "exports",
        state: "ready",
      })
      parts.push({ fileId, rows: part.rows, bytes: part.bytes })
    }
    const rows = row.rows + (part?.rows ?? 0)
    await patchExport(ctx, id, {
      parts,
      header,
      rows,
      bytes: (row.bytes ?? 0) + (part?.bytes ?? 0),
      touchedAt: Date.now(),
      ...(isDone
        ? { status: "ready" as const, cursor: undefined }
        : { cursor }),
    })
    if (!isDone) await ctx.scheduler.runAfter(0, internal.exports.run, { id })
    // Too long to come down in the browser: Resend emails the creator.
    else if (rows > AUTO_DOWNLOAD_ROWS)
      await ctx.scheduler.runAfter(0, internal.exports.emailCreator, { id })
    return null
  },
})

/** A failed export keeps no file: every part written so far goes. */
const failure = (error: string) => ({
  status: "failed" as const,
  error,
  rows: 0,
  parts: undefined,
  header: undefined,
  cursor: undefined,
  bytes: undefined,
})

/** Marks an export failed, dropping any parts written, or completes it with
    one stored file (exports written before parts). */
export const finish = internalMutation({
  args: {
    id: v.id("exports"),
    ...fileReference,
    rows: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, storageId, fileId, rows = 0, error }) => {
    const row = await ctx.db.get("exports", id)
    if (
      !row ||
      row.status !== "processing" ||
      (await retirement(ctx, row.organizationId))
    ) {
      // Expired or gone while it ran: the file has no one to go to.
      if (storageId || fileId) await deleteFile(ctx, { storageId, fileId })
      return null
    }
    if (!storageId && !fileId) {
      await deleteExportFiles(ctx, row)
      await patchExport(
        ctx,
        id,
        failure(error ?? "Export could not be completed.")
      )
      return null
    }
    await patchExport(ctx, id, { status: "ready", storageId, fileId, rows })
    // Too long to come down in the browser: Resend emails the creator.
    if (rows > AUTO_DOWNLOAD_ROWS)
      await ctx.scheduler.runAfter(0, internal.exports.emailCreator, { id })
    return null
  },
})
/** The authenticated details page keeps admin-only download enforcement. */
export const emailCreator = internalMutation({
  args: { id: v.id("exports") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("exports", id)
    if (
      !row ||
      (await retirement(ctx, row.organizationId)) ||
      row.status !== "ready" ||
      row.rows <= AUTO_DOWNLOAD_ROWS ||
      row.expiresAt <= Date.now() ||
      !row.creatorEmail ||
      row.notificationEmailId ||
      !(await findInstallation(ctx))?.systemSender
    )
      return null
    const url = new URL(`/settings/exports/${id}`, env.SITE_URL).href
    const email = await sendSystemEmail(ctx, {
      to: row.creatorEmail,
      subject: "Your export is ready",
      text: `Your export is ready to download.\n\nDownload your data: ${url}\n\nOnly team admins can download the data. This export is available for 7 days after creation.\n`,
      category: "export",
    })
    if (email) await patchExport(ctx, id, { notificationEmailId: email })
    return null
  },
})

/** Fails "processing" exports that made no progress for this long: their
    action crashed or timed out and nothing else will settle them. */
export const STALLED_AFTER = 30 * 60_000
const STALLED_ERROR =
  "The export stopped before it finished. Start it again; narrow the filters if it keeps failing."

export const failStalled = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const before = Date.now() - STALLED_AFTER
    // Rows from before `touchedAt` sort first; judge those by creation time.
    const stalled = await ctx.db
      .query("exports")
      .withIndex("by_status_and_touchedAt", (q) =>
        q.eq("status", "processing").lte("touchedAt", before)
      )
      .take(100)
    let failed = 0
    for (const row of stalled)
      if ((row.touchedAt ?? row._creationTime) <= before) {
        await deleteExportFiles(ctx, row)
        await patchExport(ctx, row._id, failure(STALLED_ERROR))
        failed++
      }
    if (failed === 100)
      await ctx.scheduler.runAfter(0, internal.exports.failStalled, {})
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
    // Each part is a file to delete: past this many, continue in a new run.
    let files = 0
    for (const status of ["processing", "ready", "failed"] as const)
      for (const row of await ctx.db
        .query("exports")
        .withIndex("by_status_and_expiresAt", (q) =>
          q.eq("status", status).lte("expiresAt", now)
        )
        .take(100)) {
        if (files >= 1000) break
        files += 1 + (await deleteExportFiles(ctx, row))
        await patchExport(ctx, row._id, {
          status: "expired",
          storageId: undefined,
          fileId: undefined,
          parts: undefined,
          header: undefined,
          cursor: undefined,
          bytes: undefined,
        })
        due.push(row._id)
      }
    const expired = await ctx.db
      .query("exports")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", "expired").lte("expiresAt", now - EXPIRED_KEPT)
      )
      .take(100)
    for (const row of expired) await deleteExport(ctx, row._id)
    if (due.length >= 100 || files >= 1000 || expired.length === 100)
      await ctx.scheduler.runAfter(0, internal.exports.expire, {})
    return null
  },
})
