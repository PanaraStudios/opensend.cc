import { Migrations } from "@convex-dev/migrations"
import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import { counters, insertRow, patchRow, deleteRow } from "./counts"
import { invalid } from "./api/caller"
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

export const CUSTOM_EVENT_LIMIT = 10_000
export const CUSTOM_EVENT_LIMIT_MESSAGE =
  "This team has reached the limit of 10,000 custom event types. Delete unused ones or contact support."
const migrations = new Migrations<DataModel>(components.migrations)

export const insertAutomationEvent = async (
  ctx: MutationCtx,
  organizationId: string,
  fields: Fields
) => {
  // A partially backfilled aggregate must never authorize a legacy team's
  // new definition. This status lookup and the count have bounded reads.
  const [status] = await migrations.getStatus(ctx, {
    migrations: [internal.migrations.countAutomationEvents],
  })
  if (status?.state !== "success") {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .first()
    if (existing)
      throw invalid(
        "Custom event counts are being initialized. Run migrations:backfillCounts before creating new event types."
      )
  }
  if (
    (await counters.automationEvents.total(ctx, organizationId))! >=
    CUSTOM_EVENT_LIMIT
  )
    throw invalid(CUSTOM_EVENT_LIMIT_MESSAGE)
  return insertRow(ctx, "automationEvents", {
    organizationId,
    ...fields,
    searchText: searchText(fields),
    updatedAt: Date.now(),
  })
}

export const patchAutomationEvent = (
  ctx: MutationCtx,
  event: Doc<"automationEvents">,
  fields: Partial<Fields>
) => {
  const next = { name: event.name, schema: event.schema, ...fields }
  return patchRow(ctx, "automationEvents", event._id, {
    ...next,
    searchText: searchText(next),
    updatedAt: Date.now(),
  })
}

export const deleteAutomationEvent = (
  ctx: MutationCtx,
  id: Id<"automationEvents">
) => deleteRow(ctx, "automationEvents", id)
