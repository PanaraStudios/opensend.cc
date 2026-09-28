import { defineTable } from "convex/server"
import { v } from "convex/values"

export const BROADCAST_STATUSES = [
  "draft",
  "scheduled",
  "queued",
  "sent",
  "failed",
  "canceled",
] as const
export const broadcastStatusValue = v.union(
  ...BROADCAST_STATUSES.map((s) => v.literal(s))
)
export const broadcastEventValue = v.union(
  ...[
    "delivered",
    "opened",
    "clicked",
    "bounced",
    "suppressed",
    "complained",
    "unsubscribed",
  ].map((s) => v.literal(s))
)
export const broadcastTables = {
  broadcasts: defineTable({
    organizationId: v.string(),
    name: v.string(),
    subject: v.string(),
    preview: v.string(),
    from: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    replyToAddresses: v.optional(v.array(v.string())),
    segmentId: v.union(v.id("segments"), v.null()),
    topicId: v.union(v.id("topics"), v.null()),
    status: broadcastStatusValue,
    updatedAt: v.number(),
    scheduledAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    scheduledJob: v.optional(v.id("_scheduled_functions")),
    workflowId: v.optional(v.string()),
    generation: v.number(),
    cursor: v.optional(v.string()),
    audienceDone: v.boolean(),
    audienceBefore: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_status", ["organizationId", "status"])
    .index("by_organizationId_and_segmentId", ["organizationId", "segmentId"])
    .index("by_organizationId_and_status_and_segmentId", [
      "organizationId",
      "status",
      "segmentId",
    ]),
  broadcastDrafts: defineTable({
    organizationId: v.string(),
    broadcastId: v.id("broadcasts"),
    html: v.string(),
    text: v.optional(v.string()),
    content: v.optional(v.any()),
  })
    .index("by_broadcastId", ["broadcastId"])
    .index("by_organizationId", ["organizationId"]),
  broadcastRecipients: defineTable({
    organizationId: v.string(),
    broadcastId: v.id("broadcasts"),
    contactId: v.id("contacts"),
    email: v.string(),
    emailId: v.id("emails"),
    settled: v.boolean(),
    failed: v.boolean(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_email", ["organizationId", "email"])
    .index("by_broadcastId_and_email", ["broadcastId", "email"])
    .index("by_emailId", ["emailId"]),
  broadcastEvents: defineTable({
    organizationId: v.string(),
    broadcastId: v.id("broadcasts"),
    emailId: v.id("emails"),
    email: v.string(),
    type: broadcastEventValue,
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_broadcastId_and_type", ["broadcastId", "type"])
    .index("by_emailId_and_type", ["emailId", "type"]),
}
