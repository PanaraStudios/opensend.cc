import type { Doc, Id, TableNames } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { patchRow, type CountedTable } from "./counts"

type Fields<T extends TableNames> = Partial<
  Omit<Doc<T>, "_id" | "_creationTime">
>

/** Convex values compare by content: plain objects, arrays and scalars. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && same(left[key], right[key]))
  )
}

/** The fields of `value` that differ from `doc`. `undefined` removes a field,
    so it differs only when the document has one. */
export function changedFields<T extends TableNames>(
  doc: Doc<T>,
  value: Fields<T>
): Fields<T> {
  const stored = doc as Record<string, unknown>
  const changed: Record<string, unknown> = {}
  for (const [key, next] of Object.entries(value))
    if (!same(stored[key], next)) changed[key] = next
  return changed as Fields<T>
}

/** `ctx.db.patch` that writes nothing when every value is already stored. An
    unchanged patch still writes the document, conflicts with concurrent
    readers and re-runs every query that read it. Returns whether it wrote. */
export async function patchIfChanged<T extends TableNames>(
  ctx: MutationCtx,
  table: T,
  doc: Doc<T>,
  value: Fields<T>
) {
  const changed = changedFields(doc, value)
  if (Object.keys(changed).length === 0) return false
  await ctx.db.patch(table, doc._id as Id<T>, changed as never)
  return true
}

/** `patchRow` for counted tables, skipping an unchanged patch. Returns the
    document as it is after. */
export async function patchRowIfChanged<T extends CountedTable>(
  ctx: MutationCtx,
  table: T,
  doc: Doc<T>,
  value: Fields<T>
): Promise<Doc<T>> {
  const changed = changedFields(doc, value)
  if (Object.keys(changed).length === 0) return doc
  return patchRow(ctx, table, doc._id as Id<T>, changed as never)
}
