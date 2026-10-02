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
  const templateHeaders = new Set<string>()
  const template = object(object(value).template)
  if (Array.isArray(template.components))
    for (const component of template.components) {
      const header = object(component)
      if (header.type !== "header" || !Array.isArray(header.parameters))
        continue
      for (const parameter of header.parameters)
        for (const kind of ["image", "video", "document"])
          if (typeof object(object(parameter)[kind]).id === "string")
            templateHeaders.add(object(object(parameter)[kind]).id as string)
    }
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
          !(
            (row.feature === "template" && templateHeaders.has(id)) ||
            (row.feature === "whatsapp" && row.accountId === accountId)
          ) ||
          !row.storageId ||
          row.state !== "ready"
        )
          throw invalid(
            "Media upload is not ready or does not belong to this account"
          )
        if (files.some((file) => file.fileId === id)) return
        await retainFile(ctx, id, organizationId, row.feature)
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
