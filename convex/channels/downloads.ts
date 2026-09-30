import type { HttpRouter } from "convex/server"
import { httpAction, type ActionCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { signedFileLink, verifyFileToken } from "../fileDownloads"
const PREFIX = "/channels/media/"
export const mediaDownloadLink = (
  ctx: Pick<ActionCtx, "runQuery">,
  messageId: Id<"channelMessages">,
  mediaId: string
) => signedFileLink(ctx, PREFIX, "channel-media", { messageId, mediaId })
export const download = httpAction(async (ctx, request) => {
  let messageId: string, mediaId: string
  try {
    const payload = await verifyFileToken(
      new URL(request.url).pathname.slice(PREFIX.length),
      "channel-media"
    )
    if (
      typeof payload.messageId !== "string" ||
      typeof payload.mediaId !== "string"
    )
      throw new Error("Invalid media token")
    messageId = payload.messageId
    mediaId = payload.mediaId
  } catch {
    return new Response(null, { status: 404 })
  }
  const file = await ctx.runQuery(internal.channels.mediaState.file, {
    messageId,
    mediaId,
  })
  const blob = file?.storageId ? await ctx.storage.get(file.storageId) : null
  if (!blob || !file) return new Response(null, { status: 404 })
  return new Response(blob, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename ?? "attachment")}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
})
export function registerChannelDownloadRoutes(http: HttpRouter) {
  http.route({ method: "GET", pathPrefix: PREFIX, handler: download })
}
