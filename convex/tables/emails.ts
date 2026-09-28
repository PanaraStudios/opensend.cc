import { defineTable } from "convex/server"
import { v } from "convex/values"

/** `EmailStatus` in lib/dashboard/types.ts; also Resend's `last_event`. */
export const EMAIL_STATUSES = [
  "queued",
  "scheduled",
  "sent",
  "delivered",
  "delivery_delayed",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "failed",
  "canceled",
  "suppressed",
] as const
export const emailStatusValue = v.union(
  ...EMAIL_STATUSES.map((status) => v.literal(status))
)
export const SUPPRESSION_REASONS = ["bounced", "complained", "manual"] as const
export const suppressionReasonValue = v.union(
  ...SUPPRESSION_REASONS.map((reason) => v.literal(reason))
)
export const emailSourceValue = v.union(
  v.literal("api"),
  v.literal("dashboard"),
  v.literal("system")
)
export const tagValue = v.object({ name: v.string(), value: v.string() })
export const headerValue = v.object({ name: v.string(), value: v.string() })
export const attachmentValue = v.object({
  filename: v.string(),
  contentType: v.string(),
  contentId: v.optional(v.string()),
  size: v.number(),
  storageId: v.id("_storage"),
})

/* An email is four kinds of documents, so lists never read a body: the row
   the list, search and filters read; its content, read only by the detail
   view and the sender; its timeline; and one row per recipient address for
   a contact's history. At most 50 recipients and 50 tags, as SES allows. */
export const emailTables = {
  emails: defineTable({
    /** The team, or `SYSTEM_SCOPE` for account email no team lists. */
    organizationId: v.string(),
    /** The verified sending domain; its team's tenant sends. */
    domainId: v.id("domains"),
    from: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    replyTo: v.optional(v.array(v.string())),
    subject: v.string(),
    status: emailStatusValue,
    scheduledAt: v.optional(v.number()),
    /** The pending `release` of a scheduled email, canceled on change. */
    scheduledJob: v.optional(v.id("_scheduled_functions")),
    tags: v.optional(v.array(tagValue)),
    templateId: v.optional(v.string()),
    source: emailSourceValue,
    apiKeyId: v.optional(v.id("apiKeys")),
    apiLogId: v.optional(v.id("apiLogs")),
    /** Set by broadcasts, which are still demo data. */
    broadcastId: v.optional(v.string()),
    /* Each queued run of the sender carries the generation it was queued
       with; a reschedule, retry or throttle moves it on, so a stale run is
       a no-op. `claimed` marks the run that is calling SES. */
    generation: v.number(),
    claimed: v.optional(v.boolean()),
    attempts: v.number(),
    rateReadyAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    /** Recipients dropped before sending because they are suppressed. */
    suppressed: v.optional(v.array(v.string())),
    /** The SES MessageId: how SES events find the email. */
    messageId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
    /** Recipients, sender and subject as words, for the list's search. */
    search: v.string(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_status", ["organizationId", "status"])
    .index("by_messageId", ["messageId"])
    .index("by_expiresAt", ["expiresAt"])
    .searchIndex("search_search", {
      searchField: "search",
      filterFields: ["organizationId", "status"],
    }),
  emailContents: defineTable({
    emailId: v.id("emails"),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    headers: v.optional(v.array(headerValue)),
    attachments: v.optional(v.array(attachmentValue)),
  }).index("by_emailId", ["emailId"]),
  /** The email's timeline; SES event processing appends to it. */
  emailEvents: defineTable({
    emailId: v.id("emails"),
    type: emailStatusValue,
    at: v.number(),
  }).index("by_emailId_and_at", ["emailId", "at"]),
  emailRecipients: defineTable({
    organizationId: v.string(),
    emailId: v.id("emails"),
    /** Lowercased address, without a display name. */
    address: v.string(),
  })
    .index("by_organizationId_and_address", ["organizationId", "address"])
    .index("by_emailId", ["emailId"]),
  suppressions: defineTable({
    organizationId: v.string(),
    /** Lowercased; one row per team and address. */
    email: v.string(),
    reason: suppressionReasonValue,
    /** The address as words, for the list's search. */
    search: v.string(),
  })
    .index("by_organizationId_and_email", ["organizationId", "email"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_reason", ["organizationId", "reason"])
    .searchIndex("search_search", {
      searchField: "search",
      filterFields: ["organizationId", "reason"],
    }),
}
