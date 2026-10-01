import { retainFile } from "./files"
import type { MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { invalid } from "../api/caller"
import { object } from "../../lib/meta/webhooks"
import { channelMediaValue } from "../tables/channels"
import type { Infer } from "convex/values"

/** Resolve storage ids in media and template header parameters before queueing. */
export async function messageFiles(
  ctx: MutationCtx,
  value: unknown,
  organizationId: string,
  accountId: Doc<"channelAccounts">["_id"]
) {
  const files: Infer<typeof channelMediaValue>[] = []
  async function visit(value: unknown): Promise<void> {
    if (Array.isArray(value)) {
      for (const item of value) await visit(item)
      return
    }
    const node = object(value)
    if (typeof node.id === "string") {
      const id = ctx.db.normalizeId("storedFiles", node.id)
      if (id) {
        const row = await ctx.db.get("storedFiles", id)
        if (
          !row ||
          row.organizationId !== organizationId ||
          row.accountId !== accountId ||
          row.feature !== "whatsapp" ||
          row.state !== "ready"
        )
          throw invalid(
            "Media upload is not ready or does not belong to this account"
          )
        if (files.some((file) => file.fileId === id)) return
        await retainFile(ctx, id, organizationId, "whatsapp")
        files.push({
          fileId: id,
          mediaId: id,
          contentType: row.contentType,
          mimeType: row.contentType,
          filename: row.filename,
          size: row.size,
        })
      }
    }
    for (const item of Object.values(node))
      if (item && typeof item === "object") await visit(item)
  }
  await visit(value)
  return files
}
