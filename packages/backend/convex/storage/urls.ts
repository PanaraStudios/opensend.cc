import type { ActionCtx, QueryCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { FileReference } from "./files"

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
  return row.storageId ? ctx.storage.getUrl(row.storageId) : null
}

export async function readFile(
  ctx: ActionCtx,
  ref: FileReference
): Promise<Blob | null> {
  if (!ref.fileId) return ref.storageId ? ctx.storage.get(ref.storageId) : null
  const row = await ctx.runQuery(internal.storage.files.get, { id: ref.fileId })
  if (!row || row.state !== "ready") return null
  return row.storageId ? ctx.storage.get(row.storageId) : null
}
