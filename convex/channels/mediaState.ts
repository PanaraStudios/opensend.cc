import { v } from "convex/values"
import { internalQuery, internalMutation } from "../_generated/server"
import { retirement } from "../teamLifecycle"
import { channelMediaValue } from "../tables/channels"

export const context = internalQuery({
  args: { messageId: v.id("channelMessages"), mediaId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      encryptedToken: v.string(),
      version: v.string(),
      media: channelMediaValue,
    })
  ),
  handler: async (ctx, { messageId, mediaId }) => {
    const message = await ctx.db.get("channelMessages", messageId)
    if (!message || (await retirement(ctx, message.organizationId))) return null
    const account = await ctx.db.get("channelAccounts", message.accountId)
    const connection = account
      ? await ctx.db.get("metaConnections", account.connectionId)
      : null
    const app = await ctx.db
      .query("metaApps")
      .withIndex("by_key", (q) => q.eq("key", "metaApp"))
      .unique()
    const content = await ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .unique()
    const media = content?.media?.find((m) => m.mediaId === mediaId)
    return account?.organizationId === message.organizationId &&
      connection?.organizationId === message.organizationId &&
      connection.status === "active" &&
      account.status !== "disconnected" &&
      app &&
      media &&
      !media.storageId
      ? {
          encryptedToken: account.encryptedToken ?? connection.encryptedToken,
          version: app.graphVersion,
          media,
        }
      : null
  },
})
export const complete = internalMutation({
  args: {
    messageId: v.id("channelMessages"),
    mediaId: v.string(),
    file: v.optional(channelMediaValue),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get("channelMessages", args.messageId)
    const content = await ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .unique()
    const media = content?.media?.find((m) => m.mediaId === args.mediaId)
    if (
      !message ||
      !media ||
      media.storageId ||
      (await retirement(ctx, message.organizationId))
    ) {
      if (args.file?.storageId) await ctx.storage.delete(args.file.storageId)
      return null
    }
    await ctx.db.patch("channelMessageContents", content!._id, {
      media: content!.media!.map((m) =>
        m.mediaId === args.mediaId
          ? (args.file ?? { ...m, error: args.error })
          : m
      ),
    })
    return null
  },
})

export const file = internalQuery({
  args: { messageId: v.string(), mediaId: v.string() },
  returns: v.union(v.null(), channelMediaValue),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("channelMessages", args.messageId)
    const message = id ? await ctx.db.get("channelMessages", id) : null
    if (
      !message ||
      (message.expiresAt !== undefined && message.expiresAt <= Date.now()) ||
      (await retirement(ctx, message.organizationId))
    )
      return null
    const content = await ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .unique()
    const file = content?.media?.find((m) => m.mediaId === args.mediaId)
    if (!file) return null
    if (file.storageId) return file
    const upload = await ctx.db
      .query("channelMediaUploads")
      .withIndex("by_team_and_mediaId", (q) =>
        q
          .eq("organizationId", message.organizationId)
          .eq("mediaId", args.mediaId)
      )
      .unique()
    return upload &&
      upload.accountId === message.accountId &&
      upload.expiresAt > Date.now()
      ? { ...file, storageId: upload.storageId }
      : null
  },
})
