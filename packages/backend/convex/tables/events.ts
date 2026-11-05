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
    /** Durable customer webhook fan-out progress; replays do not resend it. */
    webhookCursor: v.optional(v.string()),
    webhooksDeliveredAt: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_type", ["organizationId", "type"]),
}
