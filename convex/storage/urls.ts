import type { ActionCtx, QueryCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import { signedFileLink } from "../fileDownloads"
import type { FileReference } from "./files"
import { publicAssetUrl } from "./config"

export async function fileUrl(
  ctx: Pick<ActionCtx, "runAction"> | QueryCtx,
  file: FileReference,
  opts: {
    filename?: string
    disposition?: "inline" | "attachment"
    expiresIn?: number
  } = {}
): Promise<string | null> {
  if ("runAction" in ctx)
    return ctx.runAction(internal.storage.objects.url, {
      fileId: file.fileId,
      storageId: file.storageId,
      ...opts,
    })
  if (!file.fileId)
    return file.storageId ? ctx.storage.getUrl(file.storageId) : null
  const row = await ctx.db.get("storedFiles", file.fileId)
  if (!row || row.state !== "ready") return null
  if (row.provider === "convex")
    return row.storageId ? ctx.storage.getUrl(row.storageId) : null
  if (row.feature === "asset" && row.key) {
    const url = publicAssetUrl(row.key)
    if (url) return url
  }
  return (
    await signedFileLink(ctx, "/stored-files/", "stored-file", {
      fileId: row._id,
      filename: opts.filename ?? row.filename,
    })
  ).download_url
}
