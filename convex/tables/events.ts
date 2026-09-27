import { defineTable } from "convex/server"
import { v } from "convex/values"

export const eventTables = {
  /* The outbox every feature writes to and reads from: webhooks, metrics
     and automations consume these rows instead of hooking each producer. */
  events: defineTable({
    organizationId: v.string(),
    /** A system event (`email.delivered`…) or a team's custom event name. */
    type: v.string(),
    data: v.record(v.string(), v.any()),
  }).index("by_organizationId_and_type", ["organizationId", "type"]),
}
