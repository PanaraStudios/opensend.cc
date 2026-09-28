import { defineTable } from "convex/server"
import { v } from "convex/values"

export const eventFieldTypeValue = v.union(
  v.literal("string"),
  v.literal("number"),
  v.literal("boolean"),
  v.literal("date")
)
export const eventSchemaValue = v.array(
  v.object({ key: v.string(), type: eventFieldTypeValue })
)

/* Custom events: what a team says its app sends (definitions), and what it
   did send (occurrences). Occurrences name their event rather than point at
   the definition, so deleting a definition keeps its history, and an event
   sent without one is kept too. */
export const automationEventTables = {
  automationEvents: defineTable({
    organizationId: v.string(),
    /** Unique per team; automations find the event by it. */
    name: v.string(),
    /** Capped at MAX_SCHEMA_KEYS, so the array stays small. */
    schema: eventSchemaValue,
    /** Name and property keys, as words, for the list's search. */
    searchText: v.string(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_name", ["organizationId", "name"])
    .searchIndex("search_searchText", {
      searchField: "searchText",
      filterFields: ["organizationId"],
    }),
  automationEventOccurrences: defineTable({
    organizationId: v.string(),
    /** The event name as sent. */
    name: v.string(),
    /** Set when the contact existed when the event arrived. */
    contactId: v.optional(v.id("contacts")),
    /** The contact's address, normalized. An address with no contact yet is
        kept as sent: the run that starts from it creates the contact. */
    email: v.optional(v.string()),
    /** Size-capped when received (MAX_PAYLOAD_BYTES). */
    payload: v.record(v.string(), v.any()),
  }).index("by_organizationId_and_name", ["organizationId", "name"]),
}
