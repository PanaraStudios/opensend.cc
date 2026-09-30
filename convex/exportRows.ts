import type { WithoutSystemFields } from "convex/server"
import type { MutationCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

import { insertRow, patchRow, deleteRow } from "./counts"

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
