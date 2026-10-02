import { defineTable } from "convex/server"
import { v } from "convex/values"

export const noteAuthorValue = v.object({
  kind: v.union(v.literal("user"), v.literal("bot"), v.literal("api")),
  id: v.optional(v.string()),
  name: v.optional(v.string()),
})
export const noteSourceValue = v.object({
  callId: v.optional(v.id("calls")),
  conversationId: v.optional(v.id("conversations")),
  messageId: v.optional(v.id("channelMessages")),
})
export const contactNoteTables = {
  contactNotes: defineTable({
    organizationId: v.string(),
    contactId: v.id("contacts"),
    body: v.string(),
    author: noteAuthorValue,
    source: v.optional(noteSourceValue),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_contactId", ["organizationId", "contactId"])
    .index("by_contactId", ["contactId"]),
}
