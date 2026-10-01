"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { graph, graphLocalOrigin } from "../meta/graph"
import { decryptSecret } from "../secrets"
import { publicFetch } from "../../lib/net/public-fetch"
import { MetaError } from "../../lib/meta/errors"
import { object, string } from "../../lib/meta/webhooks"

const MAX_BYTES = 25 * 1024 * 1024
/** Refresh Meta's short-lived media URL on every attempt. The file stays in
    Convex storage; both HTTP calls go through the public-host guard.
    https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media */
export const fetch = internalAction({
  args: {
    messageId: v.id("channelMessages"),
    mediaId: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, mediaId, attempt = 0 }): Promise<null> => {
    const context = await ctx.runQuery(internal.channels.mediaState.context, {
      messageId,
      mediaId,
    })
    if (!context) return null
    const label = context.media.url ? "Channel" : "WhatsApp"
    try {
      const token = await decryptSecret(context.encryptedToken)
      const metadata = context.media.url
        ? { url: context.media.url }
        : object(
            await graph({
              token,
              method: "GET",
              path: mediaId,
              version: context.version,
            })
          )
      if (
        !string(metadata.url) ||
        (typeof metadata.file_size === "number" &&
          metadata.file_size > MAX_BYTES)
      )
        throw new MetaError({
          status: 413,
          isTransient: false,
          message: `${label} media is missing or exceeds 25 MB`,
        })
      const response = await publicFetch(string(metadata.url), {
        ...(context.media.url
          ? {}
          : { headers: { authorization: `Bearer ${token}` } }),
        maxBytes: MAX_BYTES,
        timeoutMs: 30_000,
        localOrigin: graphLocalOrigin(),
      })
      if (!response.ok)
        throw new MetaError({
          status: response.status,
          isTransient: false,
          message: `${label} media returned HTTP ${response.status}`,
        })
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > MAX_BYTES)
        throw new MetaError({
          status: 413,
          isTransient: false,
          message: `${label} media exceeds 25 MB`,
        })
      const contentType =
        string(metadata.mime_type) ||
        (context.media.url ? response.headers.get("content-type") : null) ||
        context.media.contentType
      const storageId = await ctx.storage.store(
        new Blob([bytes], { type: contentType })
      )
      try {
        await ctx.runMutation(internal.channels.mediaState.complete, {
          messageId,
          mediaId,
          file: {
            mediaId,
            storageId,
            contentType,
            size: bytes.byteLength,
            ...(context.media.filename
              ? { filename: context.media.filename }
              : {}),
          },
        })
      } catch (error) {
        await ctx.storage.delete(storageId)
        throw error
      }
    } catch (error) {
      const retryable =
        !(error instanceof MetaError) ||
        error.action === "retry" ||
        error.action === "retry_after" ||
        error.status === 404
      if (retryable && attempt < 5)
        await ctx.scheduler.runAfter(
          10000 * 2 ** attempt,
          internal.channels.media.fetch,
          { messageId, mediaId, attempt: attempt + 1 }
        )
      else
        await ctx.runMutation(internal.channels.mediaState.complete, {
          messageId,
          mediaId,
          error:
            error instanceof Error
              ? error.message
              : `${label} media fetch failed`,
        })
    }
    return null
  },
})
