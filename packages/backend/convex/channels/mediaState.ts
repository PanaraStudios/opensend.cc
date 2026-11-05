import { findMetaApp } from "../meta/app"
import { v } from "convex/values"
import { Workpool, vOnCompleteArgs } from "@convex-dev/workpool"
import { components, internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import {
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "../_generated/server"
import { retirement } from "../teamLifecycle"
import { channelMediaValue } from "../tables/channels"
import { deleteFile } from "../storage/files"

const pool = new Workpool(components.channelPool, { maxParallelism: 10 })
type FetchJob = {
  messageId: Id<"channelMessages">
  mediaId: string
  attempt?: number
}
const fetchJob = v.object({
  messageId: v.id("channelMessages"),
  mediaId: v.string(),
  attempt: v.number(),
})

/** Downloads are idempotent: competing completions discard the extra file. */
export async function enqueueMediaFetch(
  ctx: MutationCtx,
  args: FetchJob,
  runAfter = 0
) {
  const job = { ...args, attempt: args.attempt ?? 0 }
  await pool.enqueueAction(ctx, internal.channels.media.fetch, job, {
    runAfter,
    retry: false,
    onComplete: internal.channels.mediaState.fetchDone,
    onCompleteExcludeKinds: ["success"],
    context: job,
  })
}

async function fetchFailure(
  ctx: MutationCtx,
  args: FetchJob & { error: string; retryable: boolean }
): Promise<null> {
  const { messageId, mediaId, error, retryable, attempt = 0 } = args
  if (retryable && attempt < 5)
    await enqueueMediaFetch(
      ctx,
      { messageId, mediaId, attempt: attempt + 1 },
      10000 * 2 ** attempt
    )
  else
    await ctx.runMutation(internal.channels.mediaState.complete, {
      messageId,
      mediaId,
      error,
    })
  return null
}

export const retryFetch = internalMutation({
  args: { ...fetchJob.fields, error: v.string(), retryable: v.boolean() },
  returns: v.null(),
  handler: fetchFailure,
})

/** A crashed scheduled action still exhausts a bounded retry budget. */
export const fetchDone = internalMutation({
  args: vOnCompleteArgs(fetchJob),
  returns: v.null(),
  handler: async (ctx, { context, result }): Promise<null> => {
    if (result.kind === "success") return null
    return fetchFailure(ctx, {
      ...context,
      retryable: true,
      error:
        result.kind === "failed" ? result.error : "Media download canceled",
    })
  },
})

export const context = internalQuery({
  args: { messageId: v.id("channelMessages"), mediaId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      encryptedToken: v.string(),
      version: v.string(),
      organizationId: v.string(),
      media: channelMediaValue,
      channel: v.union(
        v.literal("whatsapp"),
        v.literal("messenger"),
        v.literal("instagram")
      ),
      messageType: v.string(),
      direction: v.union(v.literal("inbound"), v.literal("outbound")),
    })
  ),
  handler: async (ctx, { messageId, mediaId }) => {
    const message = await ctx.db.get("channelMessages", messageId)
    if (!message || (await retirement(ctx, message.organizationId))) return null
    const account = await ctx.db.get("channelAccounts", message.accountId)
    const connection = account
      ? await ctx.db.get("metaConnections", account.connectionId)
      : null
    const app = await findMetaApp(ctx)
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
      !media.storageId &&
      !media.fileId
      ? {
          encryptedToken: account.encryptedToken ?? connection.encryptedToken,
          version: app.graphVersion,
          organizationId: message.organizationId,
          media,
          channel: message.channel,
          messageType: message.type,
          direction: message.direction,
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
      media.fileId ||
      (await retirement(ctx, message.organizationId))
    ) {
      if (args.file) await deleteFile(ctx, args.file)
      return null
    }
    await ctx.db.patch("channelMessageContents", content!._id, {
      media: content!.media!.map((m) =>
        m.mediaId === args.mediaId
          ? {
              ...(args.file ?? { ...m, error: args.error }),
              mimeType: m.mimeType ?? m.contentType,
            }
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
    if (file.storageId || file.fileId) return file
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
      ? { ...file, storageId: upload.storageId, fileId: upload.fileId }
      : null
  },
})
