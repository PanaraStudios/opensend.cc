import type { WithoutSystemFields } from "convex/server"
import type { MutationCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

import { insertRow, patchRow, deleteRow } from "./counts"
import { deleteFile } from "./storage/files"

/* The only writers of the `exports` table, so a counter or any other
   mirror of it attaches in one place. */

export const insertExport = (
  ctx: MutationCtx,
  row: WithoutSystemFields<Doc<"exports">>
) => insertRow(ctx, "exports", row)

export const patchExport = (
  ctx: MutationCtx,
  id: Id<"exports">,
  patch: Partial<WithoutSystemFields<Doc<"exports">>>
) => patchRow(ctx, "exports", id, patch)

export const deleteExport = (ctx: MutationCtx, id: Id<"exports">) =>
  deleteRow(ctx, "exports", id)

/** Every stored file of an export: the single file of an older export and
    each part. The caller clears the references on the row. */
export async function deleteExportFiles(
  ctx: MutationCtx,
  row: Pick<Doc<"exports">, "storageId" | "fileId" | "parts">
) {
  if (row.storageId || row.fileId) await deleteFile(ctx, row)
  for (const part of row.parts ?? []) await deleteFile(ctx, part)
  return row.parts?.length ?? 0
}
