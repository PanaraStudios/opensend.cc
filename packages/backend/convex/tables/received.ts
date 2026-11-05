import { fileReference } from "./storage"
import { defineTable } from "convex/server"
import { v } from "convex/values"

export const receivedMetadata = v.object({
  from: v.string(),
  sender: v.string(),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  bcc: v.array(v.string()),
  replyTo: v.array(v.string()),
  subject: v.string(),
  messageId: v.string(),
  date: v.optional(v.number()),
})
export const receivedContent = v.object({
  html: v.string(),
  text: v.string(),
  headers: v.record(v.string(), v.string()),
})
export const receivedAttachment = v.object({
  ...fileReference,
  filename: v.union(v.string(), v.null()),
  contentType: v.string(),
  contentId: v.union(v.string(), v.null()),
  contentDisposition: v.union(v.string(), v.null()),
  size: v.number(),
})
export const receivedTables = {
  receivedEmails: defineTable({
    organizationId: v.string(),
    inboundId: v.id("inboundMessages"),
    domainId: v.id("domains"),
    ...receivedMetadata.fields,
    receivedFor: v.array(v.string()),
    authentication: v.record(v.string(), v.string()),
    receivedAt: v.number(),
    expiresAt: v.number(),
    rawId: v.optional(v.id("_storage")),
    rawFileId: v.optional(v.id("storedFiles")),
    parseError: v.optional(v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_receivedAt", ["organizationId", "receivedAt"])
    .index("by_organizationId_and_sender_and_receivedAt", [
      "organizationId",
      "sender",
      "receivedAt",
    ])
    /** A sender's mail in creation order, so an inbox email thread merges
        it with the team's sends to that address. */
    .index("by_organizationId_and_sender", ["organizationId", "sender"])
    .index("by_inboundId", ["inboundId"])
    .index("by_expiresAt", ["expiresAt"]),
  receivedContents: defineTable({
    emailId: v.id("receivedEmails"),
    ...receivedContent.fields,
  }).index("by_emailId", ["emailId"]),
  receivedAttachments: defineTable({
    emailId: v.id("receivedEmails"),
    ...receivedAttachment.fields,
  }).index("by_emailId", ["emailId"]),
}
