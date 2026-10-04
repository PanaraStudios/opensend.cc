import { defineTable } from "convex/server"
import { v } from "convex/values"
import { variableSources } from "./variables"

export const broadcastChannel = v.union(
  v.literal("email"),
  v.literal("whatsapp"),
  v.literal("messenger"),
  v.literal("instagram")
)
export const skipReasonValue = v.union(
  v.literal("no_phone"),
  v.literal("no_channel_identity"),
  v.literal("no_email"),
  v.literal("unsubscribed"),
  v.literal("topic_opt_out"),
  v.literal("marketing_opt_out"),
  v.literal("missing_variables"),
  v.literal("contact_deleted"),
  v.literal("window_closed")
)
export const whatsappBroadcast = v.object({
  accountId: v.id("channelAccounts"),
  templateId: v.id("templates"),
  variables: variableSources,
})
export const whatsappStatsValue = v.object({
  recipients: v.number(),
  sent: v.number(),
  delivered: v.number(),
  read: v.number(),
  failed: v.number(),
  skipped: v.number(),
})

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
export const broadcastStatsValue = v.object({
  recipients: v.number(),
  delivered: v.number(),
  opened: v.number(),
  clicked: v.number(),
  bounced: v.number(),
  suppressed: v.number(),
  complained: v.number(),
  unsubscribed: v.number(),
})
export const broadcastTables = {
  broadcastLinks: defineTable({
    organizationId: v.string(),
    broadcastId: v.id("broadcasts"),
    url: v.string(),
    clicks: v.number(),
    uniqueClicks: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_broadcastId_and_url", ["broadcastId", "url"])
    .index("by_broadcastId_and_clicks", ["broadcastId", "clicks"]),
  broadcastRecipientLinks: defineTable({
    organizationId: v.string(),
    broadcastId: v.id("broadcasts"),
    emailId: v.id("emails"),
    linkId: v.id("broadcastLinks"),
    clicks: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_broadcastId", ["broadcastId"])
    .index("by_emailId_and_linkId", ["emailId", "linkId"]),
  broadcasts: defineTable({
    organizationId: v.string(),
    name: v.string(),
    channel: v.optional(broadcastChannel),
    whatsapp: v.optional(whatsappBroadcast),
    messaging: v.optional(whatsappBroadcast),
    retainedWhatsAppStats: v.optional(whatsappStatsValue),
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
    settledAt: v.optional(v.number()),
    lastMessageSentAt: v.optional(v.number()),
    settleJob: v.optional(v.id("_scheduled_functions")),
    scheduledJob: v.optional(v.id("_scheduled_functions")),
    workflowId: v.optional(v.string()),
    generation: v.number(),
    cursor: v.optional(v.string()),
    audienceDone: v.boolean(),
    retainedStats: v.optional(broadcastStatsValue),
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
    emailId: v.optional(v.id("emails")),
    messageId: v.optional(v.id("channelMessages")),
    skipReason: v.optional(skipReasonValue),
    sent: v.optional(v.boolean()),
    settled: v.boolean(),
    failed: v.boolean(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_email", ["organizationId", "email"])
    .index("by_organizationId_and_contactId", ["organizationId", "contactId"])
    .index("by_broadcastId_and_sent", ["broadcastId", "sent"])
    .index("by_broadcastId_and_email", ["broadcastId", "email"])
    .index("by_broadcastId_and_contactId", ["broadcastId", "contactId"])
    .index("by_messageId", ["messageId"])
    .index("by_emailId", ["emailId"]),
  broadcastEvents: defineTable({
    organizationId: v.string(),
    broadcastId: v.id("broadcasts"),
    emailId: v.id("emails"),
    email: v.string(),
    type: broadcastEventValue,
    count: v.optional(v.number()),
    bounceType: v.optional(v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_broadcastId_and_type", ["broadcastId", "type"])
    .index("by_emailId_and_type", ["emailId", "type"]),
}
