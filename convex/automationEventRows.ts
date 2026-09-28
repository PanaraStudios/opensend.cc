import type { MutationCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

/* Every write to `automationEvents` goes through here, so anything that
   mirrors the table (a row count) is kept in step in one place. */

type Fields = Pick<Doc<"automationEvents">, "name" | "schema">

const searchText = ({ name, schema }: Fields) =>
  [
    name,
    name.replace(/[^A-Za-z0-9]+/g, " "),
    ...schema.map((field) => field.key.replace(/_+/g, " ")),
  ].join(" ")

export const insertAutomationEvent = (
  ctx: MutationCtx,
  organizationId: string,
  fields: Fields
) =>
  ctx.db.insert("automationEvents", {
    organizationId,
    ...fields,
    searchText: searchText(fields),
    updatedAt: Date.now(),
  })

export const patchAutomationEvent = (
  ctx: MutationCtx,
  event: Doc<"automationEvents">,
  fields: Partial<Fields>
) => {
  const next = { name: event.name, schema: event.schema, ...fields }
  return ctx.db.patch("automationEvents", event._id, {
    ...next,
    searchText: searchText(next),
    updatedAt: Date.now(),
  })
}

export const deleteAutomationEvent = (
  ctx: MutationCtx,
  id: Id<"automationEvents">
) => ctx.db.delete("automationEvents", id)
