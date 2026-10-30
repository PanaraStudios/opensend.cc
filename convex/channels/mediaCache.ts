import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"

/* Meta media ids of stored files a number already uploaded. A broadcast
   sends its header image to thousands of people; each send reuses the
   number's upload instead of uploading the same bytes again. */

/** Reuse an upload for 25 of Meta's 30 days, so a cached id never expires
    between the lookup and the send. */
export const MEDIA_CACHE_MS = 25 * 86400_000
const BATCH = 200

export const mediaCacheKey = {
  accountId: v.id("channelAccounts"),
  fileId: v.id("storedFiles"),
  storageId: v.id("_storage"),
}

/** The Meta media id the number holds for the file, while it is fresh. */
export const find = internalQuery({
  args: { ...mediaCacheKey, now: v.number() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { accountId, fileId, storageId, now }) => {
    const row = await ctx.db
      .query("channelMediaCache")
      .withIndex("by_accountId_and_fileId_and_storageId", (q) =>
        q
          .eq("accountId", accountId)
          .eq("fileId", fileId)
          .eq("storageId", storageId)
      )
      .first()
    return row && row.expiresAt > now ? row.mediaId : null
  },
})

/** Keeps one row per number and file: a new upload replaces the last. */
export const remember = internalMutation({
  args: { ...mediaCacheKey, organizationId: v.string(), mediaId: v.string() },
  returns: v.null(),
  handler: async (ctx, { organizationId, mediaId, ...key }) => {
    const account = await ctx.db.get("channelAccounts", key.accountId)
    // A number disconnected while it uploaded keeps nothing.
    if (
      !account ||
      account.organizationId !== organizationId ||
      account.disconnectedAt !== undefined
    )
      return null
    const expiresAt = Date.now() + MEDIA_CACHE_MS
    const rows = await ctx.db
      .query("channelMediaCache")
      .withIndex("by_accountId_and_fileId_and_storageId", (q) =>
        q
          .eq("accountId", key.accountId)
          .eq("fileId", key.fileId)
          .eq("storageId", key.storageId)
      )
      .take(10)
    const [first, ...rest] = rows
    if (first)
      await ctx.db.patch("channelMediaCache", first._id, {
        mediaId,
        expiresAt,
      })
    else
      await ctx.db.insert("channelMediaCache", {
        organizationId,
        ...key,
        mediaId,
        expiresAt,
      })
    for (const row of rest) await ctx.db.delete("channelMediaCache", row._id)
    return null
  },
})

/** Drops ids Meta no longer knows, unless a newer upload replaced them. */
export const forget = internalMutation({
  args: {
    entries: v.array(v.object({ ...mediaCacheKey, mediaId: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { entries }) => {
    for (const { mediaId, ...key } of entries) {
      const rows = await ctx.db
        .query("channelMediaCache")
        .withIndex("by_accountId_and_fileId_and_storageId", (q) =>
          q
            .eq("accountId", key.accountId)
            .eq("fileId", key.fileId)
            .eq("storageId", key.storageId)
        )
        .take(10)
      for (const row of rows)
        if (row.mediaId === mediaId)
          await ctx.db.delete("channelMediaCache", row._id)
    }
    return null
  },
})

/** Drops a number's ids for the stored files a message payload names,
    after Meta failed the message for its media. */
export async function forgetPayloadFiles(
  ctx: MutationCtx,
  accountId: Id<"channelAccounts">,
  payload: string
) {
  const fileIds = new Set<Id<"storedFiles">>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!value || typeof value !== "object") return
    for (const [key, item] of Object.entries(value)) {
      const fileId =
        key === "id" && typeof item === "string"
          ? ctx.db.normalizeId("storedFiles", item)
          : null
      if (fileId) fileIds.add(fileId)
      else walk(item)
    }
  }
  try {
    walk(JSON.parse(payload))
  } catch {
    return
  }
  for (const fileId of fileIds) {
    const rows = await ctx.db
      .query("channelMediaCache")
      .withIndex("by_accountId_and_fileId_and_storageId", (q) =>
        q.eq("accountId", accountId).eq("fileId", fileId)
      )
      .take(10)
    for (const row of rows) await ctx.db.delete("channelMediaCache", row._id)
  }
}

/** A disconnected number's uploads, a batch at a time. A reconnect may
    bring another app or business that cannot use them. */
export const forgetAccount = internalMutation({
  args: { accountId: v.id("channelAccounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    const rows = await ctx.db
      .query("channelMediaCache")
      .withIndex("by_accountId_and_fileId_and_storageId", (q) =>
        q.eq("accountId", accountId)
      )
      .take(BATCH)
    for (const row of rows) await ctx.db.delete("channelMediaCache", row._id)
    if (rows.length === BATCH)
      await ctx.scheduler.runAfter(
        0,
        internal.channels.mediaCache.forgetAccount,
        { accountId }
      )
    return null
  },
})

/** Expired rows only: the stored file belongs to its template or message. */
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("channelMediaCache")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now()))
      .take(BATCH)
    for (const row of rows) await ctx.db.delete("channelMediaCache", row._id)
    if (rows.length === BATCH)
      await ctx.scheduler.runAfter(0, internal.channels.mediaCache.prune, {})
    return null
  },
})
