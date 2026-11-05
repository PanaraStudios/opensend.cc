import { fileReference } from "../tables/storage"
import { deleteFile } from "../storage/files"
import { v } from "convex/values"
import { internalMutation } from "../_generated/server"
import { internal } from "../_generated/api"
import { callerValue } from "../api/caller"
import { idempotent } from "../api/idempotency"

export const complete = internalMutation({
  args: {
    caller: callerValue,
    accountId: v.id("channelAccounts"),
    ...fileReference,
    mediaId: v.string(),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { caller, ...file }) => {
    await idempotent(
      ctx,
      caller,
      async () => {
        await ctx.db.insert("channelMediaUploads", {
          organizationId: caller.organizationId,
          ...file,
          expiresAt: Date.now() + 30 * 86400_000,
        })
        return file.mediaId
      },
      (id) => ({ body: { id } })
    )
    return null
  },
})
export const tokenInvalid = internalMutation({
  args: {
    caller: callerValue,
    accountId: v.id("channelAccounts"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { caller, accountId, error }) => {
    const account = await ctx.db.get("channelAccounts", accountId)
    if (!account || account.organizationId !== caller.organizationId)
      return null
    await ctx.db.patch("metaConnections", account.connectionId, {
      status: "error",
      error,
      checkedAt: Date.now(),
    })
    return null
  },
})
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("channelMediaUploads")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now()))
      .take(100)
    for (const row of rows) {
      await deleteFile(ctx, row)
      await ctx.db.delete("channelMediaUploads", row._id)
    }
    if (rows.length === 100)
      await ctx.scheduler.runAfter(0, internal.channels.mediaUploads.prune, {})
    return null
  },
})
