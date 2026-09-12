import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import {
  vEventType,
  vNameValue,
  vOptions,
  vOnEmailEvent,
  vStatus,
  vTemplate,
} from "./shared.js"

export default defineSchema({
  // Email bodies are stored separately so batch workers stay small and fast.
  content: defineTable({
    content: v.bytes(),
    mimeType: v.string(),
  }),
  // At most one row: the currently scheduled batch worker.
  nextBatchRun: defineTable({
    runId: v.id("_scheduled_functions"),
  }),
  // At most one row: the most recent runtime options, used by background workers.
  lastOptions: defineTable({
    options: vOptions,
  }),
  // Every SES event received for an email, for auditing and analytics.
  deliveryEvents: defineTable({
    emailId: v.id("emails"),
    sesMessageId: v.string(),
    eventType: vEventType,
    createdAt: v.string(),
    message: v.optional(v.string()),
    notificationId: v.optional(v.string()),
  })
    .index("by_emailId_eventType", ["emailId", "eventType"])
    .index("by_notificationId", ["notificationId"]),
  emails: defineTable({
    from: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    replyTo: v.array(v.string()),
    html: v.optional(v.id("content")),
    text: v.optional(v.id("content")),
    template: v.optional(vTemplate),
    headers: v.optional(v.array(vNameValue)),
    tags: v.optional(v.array(vNameValue)),
    configurationSetName: v.optional(v.string()),
    // Private execution metadata; never returned by get().
    options: v.optional(vOptions),
    onEmailEvent: v.optional(vOnEmailEvent),
    sendStarted: v.optional(v.boolean()),
    payloadBytes: v.optional(v.number()),
    status: vStatus,
    errorMessage: v.optional(v.string()),
    bounced: v.boolean(),
    complained: v.boolean(),
    failed: v.boolean(),
    deliveryDelayed: v.boolean(),
    opened: v.boolean(),
    clicked: v.boolean(),
    /** The message ID assigned by Amazon SES once the email has been accepted. */
    sesMessageId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    segment: v.number(),
    finalizedAt: v.number(),
  })
    .index("by_status_segment", ["status", "segment"])
    .index("by_sesMessageId", ["sesMessageId"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_finalizedAt", ["finalizedAt"]),
})
