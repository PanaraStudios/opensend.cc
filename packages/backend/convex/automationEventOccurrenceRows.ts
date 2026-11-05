import type { MutationCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

/* Every write to `automationEventOccurrences` goes through here, so anything
   that mirrors the table (a row count) is kept in step in one place. */

export const insertOccurrence = (
  ctx: MutationCtx,
  occurrence: Omit<Doc<"automationEventOccurrences">, "_id" | "_creationTime">
) => ctx.db.insert("automationEventOccurrences", occurrence)

export const deleteOccurrence = (
  ctx: MutationCtx,
  id: Id<"automationEventOccurrences">
) => ctx.db.delete("automationEventOccurrences", id)
