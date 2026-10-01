import { v } from "convex/values"
import { internalMutation } from "../_generated/server"
import { fileReference } from "../tables/storage"
import { deleteFile } from "../storage/files"
import { emitEvent } from "../events"
import { payload } from "./rows"
import { retirement } from "../teamLifecycle"
export const kindValue = v.union(
  v.literal("recording"),
  v.literal("transcription")
)
export const complete = internalMutation({
  args: {
    id: v.id("calls"),
    kind: kindValue,
    ...fileReference,
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, kind, ...file }) => {
    const row = await ctx.db.get("calls", id)
    if (
      !row ||
      (await retirement(ctx, row.organizationId)) ||
      row[kind]?.fileId ||
      row[kind]?.storageId
    ) {
      if (file.fileId || file.storageId) await deleteFile(ctx, file)
      return null
    }
    await ctx.db.patch("calls", id, {
      [kind]: { ...row[kind], ...file, error: file.error },
    })
    if (!file.error)
      await emitEvent(
        ctx,
        row.organizationId,
        kind === "recording"
          ? "whatsapp.call.recording_ready"
          : "whatsapp.call.transcription_ready",
        await payload(ctx, (await ctx.db.get("calls", id))!)
      )
    return null
  },
})
