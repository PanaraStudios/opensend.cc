import { defineTable } from "convex/server"
import { v } from "convex/values"

export const webhookTables = {
  webhooks: defineTable({
    organizationId: v.string(),
    endpoint: v.string(),
    /** At most the catalogue's event types, so the array stays small. */
    events: v.array(v.string()),
    enabled: v.boolean(),
    /** `whsec_…`, encrypted with SSO_ENCRYPTION_KEY. */
    secret: v.string(),
    /* After a rotation the old secret keeps signing beside the new one
       until this time, as Svix does, so receivers can switch unhurried. */
    previousSecret: v.optional(v.string()),
    previousSecretExpiresAt: v.optional(v.number()),
    /** When attempts started failing without a success since; after five
        days of that the endpoint is disabled, as Svix does. */
    failingSince: v.optional(v.number()),
  }).index("by_organizationId", ["organizationId"]),
  /* One row per subscribed event type, so the outbox finds a team's enabled
     listeners for an event with one index range. */
  webhookSubscriptions: defineTable({
    organizationId: v.string(),
    event: v.string(),
    enabled: v.boolean(),
    webhookId: v.id("webhooks"),
  })
    .index("by_organizationId_and_event_and_enabled", [
      "organizationId",
      "event",
      "enabled",
    ])
    .index("by_webhookId", ["webhookId"]),
  /** One message to one endpoint and what its latest attempt got back. */
  webhookDeliveries: defineTable({
    organizationId: v.string(),
    webhookId: v.id("webhooks"),
    /** `svix-id`: shared by every attempt and replay of the message. */
    messageId: v.string(),
    event: v.string(),
    /** The request body: `{ type, created_at, data }`. */
    payload: v.record(v.string(), v.any()),
    /** The latest attempt's HTTP status; 0 before one answers. */
    status: v.number(),
    /** `status` outside 2xx, kept for the status filter's index. */
    failed: v.boolean(),
    attempts: v.number(),
    durationMs: v.number(),
    /** The latest answer's body, truncated, or why there was none. */
    response: v.string(),
    /** A replay is one manual attempt; it is not retried on its own. */
    replay: v.boolean(),
    /** Set while another automatic attempt is scheduled. */
    nextAttemptAt: v.optional(v.number()),
  })
    .index("by_webhookId", ["webhookId"])
    .index("by_webhookId_and_failed", ["webhookId", "failed"])
    .index("by_webhookId_and_event", ["webhookId", "event"])
    .index("by_webhookId_and_event_and_failed", [
      "webhookId",
      "event",
      "failed",
    ]),
  /* Running totals for the webhook page, kept apart from the webhook so a
     busy endpoint's deliveries never contend with edits to it. */
  webhookStats: defineTable({
    webhookId: v.id("webhooks"),
    deliveries: v.number(),
    failed: v.number(),
  }).index("by_webhookId", ["webhookId"]),
}
