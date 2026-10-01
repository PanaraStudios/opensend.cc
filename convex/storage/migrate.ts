"use node"
import { Readable } from "node:stream"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { MIGRATION_TABLES } from "../../lib/storage/migration"
import type { MigrationSource } from "./migration"
import { putStream, headObject } from "./objects"
import { objectKey, verifyUpload } from "../../lib/storage/policy"

export const run = internalAction({
  args: { id: v.id("storageMigrations") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const job = await ctx.runMutation(internal.storage.migration.claim, { id })
    if (!job || job.status !== "running") return null
    let copied = 0
    try {
      const page = await ctx.runQuery(internal.storage.migration.page, {
        table: MIGRATION_TABLES[job.table],
        cursor: job.cursor,
      })
      for (const source of page.sources as MigrationSource[]) {
        const mapped = await ctx.runQuery(internal.storage.migration.mapped, {
          organizationId: source.organizationId,
          storageId: source.storageId,
        })
        const raw = mapped
          ? null
          : source.url
            ? await (await fetch(source.url)).blob()
            : await ctx.storage.get(source.storageId)
        if (!mapped && !raw) continue
        const key =
          mapped?.key ??
          objectKey(source.organizationId, "migration", source.storageId, 0)
        const contentType =
          mapped?.contentType ??
          (source.table === "avatars" ? raw!.type : source.contentType)
        const result = mapped
          ? { size: mapped.size, sha256: mapped.sha256 ?? "" }
          : await putStream(
              key!,
              Readable.fromWeb(
                raw!.stream() as import("node:stream/web").ReadableStream<Uint8Array>
              ),
              { contentType, size: raw!.size }
            )
        verifyUpload({ size: result.size, contentType }, await headObject(key!))
        if (
          await ctx.runMutation(internal.storage.migration.commit, {
            source,
            key: key!,
            contentType,
            ...result,
          })
        )
          copied++
      }
      const table = page.done ? job.table + 1 : job.table
      await ctx.runMutation(internal.storage.migration.checkpoint, {
        id,
        table,
        cursor: page.done ? null : page.cursor,
        copied,
        done: table >= MIGRATION_TABLES.length,
      })
    } catch (e) {
      await ctx.runMutation(internal.storage.migration.checkpoint, {
        id,
        table: job.table,
        cursor: job.cursor,
        copied,
        done: false,
        error: e instanceof Error ? e.message : "Storage migration failed",
      })
    }
    return null
  },
})
