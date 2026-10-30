import { retainFile } from "./files"
import type { MutationCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { invalid } from "../api/caller"
import { object } from "../../lib/meta/webhooks"
import { channelMediaValue } from "../tables/channels"
import type { Infer } from "convex/values"

/** Stored files a broadcast step's messages share (a template's header
    media): each is read once per step, and its references are added once,
    by `retainStepMedia`, rather than rewritten for every recipient. */
export type StepMedia = {
  rows: Map<Id<"storedFiles">, Doc<"storedFiles"> | null>
  retained: Map<Id<"storedFiles">, number>
}
export const stepMedia = (): StepMedia => ({
  rows: new Map(),
  retained: new Map(),
})
/** Adds the references a step's messages took, in the step's transaction. */
export async function retainStepMedia(ctx: MutationCtx, media: StepMedia) {
  for (const [id, count] of media.retained) {
    const row = await ctx.db.get("storedFiles", id)
    if (!row) continue
    await ctx.db.patch("storedFiles", id, {
      references: (row.references ?? 0) + count,
      expiresAt: undefined,
    })
  }
  media.retained.clear()
}

/** Resolve storage ids in media and template header parameters before queueing. */
export async function messageFiles(
  ctx: MutationCtx,
  value: unknown,
  organizationId: string,
  accountId: Doc<"channelAccounts">["_id"],
  media?: StepMedia
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
        let row = media?.rows.get(id)
        if (row === undefined) {
          row = await ctx.db.get("storedFiles", id)
          media?.rows.set(id, row)
        }
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
        if (media) media.retained.set(id, (media.retained.get(id) ?? 0) + 1)
        else await retainFile(ctx, id, organizationId, row.feature)
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
