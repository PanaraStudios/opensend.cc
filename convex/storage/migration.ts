import { patchRow } from "../counts"
import { v } from "convex/values"
import { internalMutation, internalQuery } from "../_generated/server"
import { internal, components } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { objectStorageConfig } from "./config"
import { retainFile } from "./files"
import { retirement } from "../teamLifecycle"

import { MIGRATION_TABLES } from "../../lib/storage/migration"
const tableValue = v.union(...MIGRATION_TABLES.map((table) => v.literal(table)))
const sourceValue = v.object({
  table: tableValue,
  id: v.string(),
  slot: v.number(),
  storageId: v.string(),
  organizationId: v.string(),
  feature: v.string(),
  filename: v.optional(v.string()),
  contentType: v.string(),
  url: v.optional(v.string()),
})
export type MigrationSource = typeof sourceValue.type

/** CLI/admin only: pnpm backend run storage/migration:start. Re-run to resume. */
export const start = internalMutation({
  args: {},
  returns: v.id("storageMigrations"),
  handler: async (ctx) => {
    if (!objectStorageConfig())
      throw new Error("Configure object storage first")
    const old = await ctx.db.query("storageMigrations").first()
    if (old?.status === "complete" || (old?.leaseUntil ?? 0) > Date.now())
      return old!._id
    const id =
      old?._id ??
      (await ctx.db.insert("storageMigrations", {
        table: 0,
        cursor: null,
        status: "running",
        copied: 0,
      }))
    if (old)
      await ctx.db.patch("storageMigrations", id, {
        status: "running",
        error: undefined,
      })
    await ctx.scheduler.runAfter(0, internal.storage.migrate.run, { id })
    return id
  },
})
export const job = internalQuery({
  args: { id: v.id("storageMigrations") },
  handler: (ctx, { id }): Promise<Doc<"storageMigrations"> | null> =>
    ctx.db.get("storageMigrations", id),
})
export const status = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query("storageMigrations").first(),
})
export const page = internalQuery({
  args: { table: tableValue, cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    sources: v.array(sourceValue),
    cursor: v.string(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (args.table === "avatars") {
      const page = await ctx.runQuery(
        components.betterAuth.teams.storageMigrationPage,
        { cursor: args.cursor }
      )
      return {
        sources: page.page.map((row) => ({
          table: "avatars" as const,
          id: row.id,
          slot: 0,
          storageId: row.storageId,
          organizationId: row.organizationId,
          feature: "asset",
          contentType: "application/octet-stream",
          url: row.url,
        })),
        cursor: page.continueCursor,
        done: page.isDone,
      }
    }
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 10,
      maximumBytesRead: 512 * 1024,
    })
    const sources: MigrationSource[] = []
    for (const row of page.page) {
      let organizationId =
        "organizationId" in row ? row.organizationId : undefined
      if (args.table === "channelMessageContents" && "messageId" in row)
        organizationId = (
          await ctx.db.get(
            "channelMessages",
            row.messageId as Id<"channelMessages">
          )
        )?.organizationId
      if (args.table === "emailContents" && "emailId" in row)
        organizationId = (
          await ctx.db.get("emails", row.emailId as Id<"emails">)
        )?.organizationId
      if (args.table === "receivedAttachments" && "emailId" in row)
        organizationId = (
          await ctx.db.get(
            "receivedEmails",
            row.emailId as Id<"receivedEmails">
          )
        )?.organizationId
      if (!organizationId) continue
      const files =
        "media" in row
          ? (row.media ?? [])
          : "attachments" in row
            ? (row.attachments ?? [])
            : [row]
      for (const [slot, file] of files.entries()) {
        const storageId =
          "rawId" in file
            ? file.rawId
            : "storageId" in file
              ? file.storageId
              : undefined
        if (
          !storageId ||
          ("fileId" in file && file.fileId) ||
          ("rawFileId" in file && file.rawFileId) ||
          ("provider" in file && file.provider !== "convex")
        )
          continue
        const filename =
          "filename" in file && typeof file.filename === "string"
            ? file.filename
            : undefined
        const contentType =
          "contentType" in file
            ? file.contentType
            : args.table === "receivedEmails" ||
                args.table === "inboundMessages"
              ? "message/rfc822"
              : "text/csv;charset=utf-8"
        sources.push({
          table: args.table,
          id: row._id,
          slot,
          storageId,
          organizationId,
          feature:
            args.table === "emailContents"
              ? "email"
              : args.table === "channelMediaUploads"
                ? "whatsapp"
                : args.table === "storedFiles" && "feature" in row
                  ? row.feature
                  : "migration",
          filename,
          contentType,
        })
      }
    }
    return { sources, cursor: page.continueCursor, done: page.isDone }
  },
})
export const mapped = internalQuery({
  args: { organizationId: v.string(), storageId: v.string() },
  handler: async (ctx, args): Promise<Doc<"storedFiles"> | null> => {
    const rows = await ctx.db
      .query("storedFiles")
      .withIndex("by_sourceStorageId", (q) =>
        q.eq("sourceStorageId", args.storageId)
      )
      .take(10)
    return (
      rows.find(
        (row) =>
          row.organizationId === args.organizationId &&
          row.provider === "object"
      ) ?? null
    )
  },
})
export const commit = internalMutation({
  args: {
    source: sourceValue,
    key: v.string(),
    size: v.number(),
    contentType: v.string(),
    sha256: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, { source, ...file }) => {
    if (await retirement(ctx, source.organizationId)) return false
    if (source.table === "avatars") {
      const old = await ctx.db
        .query("teamAssets")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", source.organizationId)
        )
        .unique()
      if (old) return false
      const fileId = await ctx.db.insert("storedFiles", {
        ...file,
        provider: "object",
        organizationId: source.organizationId,
        feature: "asset",
        sourceStorageId: source.storageId,
        state: "ready",
        references: 1,
      })
      await ctx.db.insert("teamAssets", {
        organizationId: source.organizationId,
        fileId,
      })
      await ctx.runMutation(components.betterAuth.teams.storageMigrationDrop, {
        id: source.id,
        storageId: source.storageId,
      })
      return true
    }
    const id = ctx.db.normalizeId(source.table, source.id)
    const row = id ? await ctx.db.get(source.table, id) : null
    if (!row) return false
    if (source.table === "storedFiles") {
      const stored = row as Doc<"storedFiles">
      if (stored.provider !== "convex" || stored.storageId !== source.storageId)
        return false
      await ctx.db.patch("storedFiles", stored._id, {
        ...file,
        provider: "object",
        sourceStorageId: source.storageId,
      })
      return true
    }
    const files =
      "media" in row
        ? row.media
        : "attachments" in row
          ? row.attachments
          : undefined
    const current = files ? files[source.slot] : row
    if (
      !current ||
      ("fileId" in current && current.fileId) ||
      ("rawFileId" in current && current.rawFileId)
    )
      return false
    const oldId =
      "rawId" in current
        ? current.rawId
        : "storageId" in current
          ? current.storageId
          : undefined
    if (oldId !== source.storageId) return false
    const existing = await ctx.db
      .query("storedFiles")
      .withIndex("by_sourceStorageId", (q) =>
        q.eq("sourceStorageId", source.storageId)
      )
      .take(10)
    const match = existing.find(
      (file) =>
        file.organizationId === source.organizationId &&
        file.provider === "object" &&
        file.state === "ready"
    )
    const fileId =
      match?._id ??
      (await ctx.db.insert("storedFiles", {
        ...file,
        organizationId: source.organizationId,
        sourceStorageId: source.storageId,
        storageId: source.storageId as Id<"_storage">,
        feature: source.feature,
        filename: source.filename,
        state: "ready",
        provider: "object",
        references: 0,
      }))
    if (!(
      source.table === "inboundMessages" &&
      "parsedAt" in row &&
      row.parsedAt !== undefined
    ))
      await retainFile(ctx, fileId, source.organizationId)
    if (source.table === "channelMessageContents")
      await ctx.db.patch(
        "channelMessageContents",
        row._id as Id<"channelMessageContents">,
        {
          media: (row as Doc<"channelMessageContents">).media!.map(
            (item, index) =>
              index === source.slot
                ? { ...item, fileId, storageId: undefined }
                : item
          ),
        }
      )
    else if (source.table === "emailContents")
      await ctx.db.patch("emailContents", row._id as Id<"emailContents">, {
        attachments: (row as Doc<"emailContents">).attachments!.map(
          (item, index) =>
            index === source.slot
              ? { ...item, fileId, storageId: undefined }
              : item
        ),
      })
    else if (source.table === "receivedEmails")
      await patchRow(ctx, "receivedEmails", row._id as Id<"receivedEmails">, {
        rawFileId: fileId,
        rawId: undefined,
      })
    else if (source.table === "exports")
      await patchRow(ctx, "exports", row._id as Id<"exports">, {
        fileId,
        storageId: undefined,
      })
    else
      await ctx.db.patch(
        source.table,
        row._id as Id<
          "inboundMessages" | "channelMediaUploads" | "receivedAttachments"
        >,
        { fileId, storageId: undefined }
      )
    return true
  },
})
export const checkpoint = internalMutation({
  args: {
    id: v.id("storageMigrations"),
    table: v.number(),
    cursor: v.union(v.string(), v.null()),
    copied: v.number(),
    done: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("storageMigrations", args.id)
    if (!row || row.status === "complete") return null
    await ctx.db.patch("storageMigrations", row._id, {
      leaseUntil: undefined,
      table: args.table,
      cursor: args.cursor,
      copied: row.copied + args.copied,
      status: args.error ? "failed" : args.done ? "complete" : "running",
      error: args.error,
    })
    if (!args.done && !args.error)
      await ctx.scheduler.runAfter(1000, internal.storage.migrate.run, {
        id: row._id,
      })
    return null
  },
})

export const claim = internalMutation({
  args: { id: v.id("storageMigrations") },
  handler: async (ctx, { id }): Promise<Doc<"storageMigrations"> | null> => {
    const job = await ctx.db.get("storageMigrations", id)
    if (!job || job.status !== "running" || (job.leaseUntil ?? 0) > Date.now())
      return null
    await ctx.db.patch("storageMigrations", id, {
      leaseUntil: Date.now() + 11 * 60_000,
    })
    return job
  },
})
