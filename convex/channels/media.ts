"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { graph, metaFetch } from "../meta/graph"
import { decryptSecret } from "../secrets"
import { whatsappMediaLimit } from "../../lib/meta/media"
import { MetaError } from "../../lib/meta/errors"
import { object, string } from "../../lib/meta/webhooks"
import { Readable } from "node:stream"
import { storeFile } from "../storage/objects"
import { objectStorageConfig } from "../storage/config"

const PAGE_MAX_BYTES = 25 * 1024 * 1024
/** Refresh Meta's short-lived media URL on every attempt. The file stays in
    configured storage provider; both HTTP calls use the public-host guard.
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
    const whatsapp = context.channel === "whatsapp"
    const publicLink =
      !!context.media.url && (!whatsapp || context.direction === "outbound")
    const maxBytes = whatsapp
      ? (context.media.contentType === "image/webp"
          ? 0.5
          : context.messageType === "document" ||
              context.media.contentType === "application/octet-stream"
            ? 100
            : context.media.contentType.startsWith("image/")
              ? 5
              : 16) *
        1024 *
        1024
      : PAGE_MAX_BYTES
    const allowedBytes =
      whatsapp && context.media.contentType === "image/webp"
        ? 500 * 1024
        : maxBytes
    const label = whatsapp ? "WhatsApp" : "Channel"
    try {
      const token = await decryptSecret(context.encryptedToken)
      const metadata =
        publicLink && context.media.url
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
          metadata.file_size > allowedBytes)
      )
        throw new MetaError({
          status: 413,
          isTransient: false,
          message: `${label} media is missing or exceeds ${allowedBytes} bytes`,
        })
      const response = await metaFetch(string(metadata.url), {
        ...(publicLink && context.media.url
          ? {}
          : { headers: { authorization: `Bearer ${token}` } }),
        maxBytes: allowedBytes,
        timeoutMs: 240_000,
        stream: !!objectStorageConfig(),
      })
      if (!response.ok)
        throw new MetaError({
          status: response.status,
          isTransient: false,
          message: `${label} media returned HTTP ${response.status}`,
        })
      const contentType =
        string(metadata.mime_type) ||
        (context.media.url ? response.headers.get("content-type") : null) ||
        context.media.contentType
      if (!response.body) throw new Error("Media body is missing")
      const source = Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream<Uint8Array>
      )
      const sticker = whatsapp && contentType.split(";")[0] === "image/webp"
      // Only the WebP header is buffered; size validation still runs before
      // the shared helper finalizes either provider's file.
      const body = (async function* () {
        const header = new Uint8Array(32)
        let headerSize = 0
        let size = 0
        for await (const chunk of source) {
          size += chunk.byteLength
          if (size > allowedBytes)
            throw new MetaError({
              status: 413,
              isTransient: false,
              message: `${label} media exceeds ${allowedBytes} bytes`,
            })
          if (sticker && headerSize < header.length) {
            const length = Math.min(
              chunk.byteLength,
              header.length - headerSize
            )
            header.set(chunk.subarray(0, length), headerSize)
            headerSize += length
          }
          yield chunk
        }
        if (sticker) {
          const format = new TextDecoder().decode(header.subarray(12, 16))
          const animated =
            format === "ANIM" || (format === "VP8X" && (header[20] & 2) !== 0)
          const limit = whatsappMediaLimit(contentType, animated)
          if (!size || size > limit)
            throw new Error(
              `Media must contain 1 to ${limit} bytes for this type.`
            )
        }
      })()
      const file = await storeFile(ctx, {
        organizationId: context.organizationId,
        feature: "media",
        contentType,
        filename: context.media.filename,
        body,
        maxBytes: allowedBytes,
      })
      const size = file.fileId
        ? (await ctx.runQuery(internal.storage.files.get, { id: file.fileId }))!
            .size
        : (await ctx.storage.get(file.storageId!))!.size
      try {
        await ctx.runMutation(internal.channels.mediaState.complete, {
          messageId,
          mediaId,
          file: {
            mediaId,
            ...file,
            contentType,
            mimeType: context.media.mimeType ?? context.media.contentType,
            size,
            ...(context.media.filename
              ? { filename: context.media.filename }
              : {}),
          },
        })
      } catch (error) {
        await ctx.runMutation(internal.storage.files.discard, file)
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
