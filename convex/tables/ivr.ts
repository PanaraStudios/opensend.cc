import { defineTable } from "convex/server"
import { v } from "convex/values"
import { definition, action } from "../ivr/validators"
export const ivrTables = {
  ivrs: defineTable({
    organizationId: v.string(),
    ...definition.fields,
    webhookSecret: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organizationId", ["organizationId"]),
  ivrPromptRenders: defineTable({
    organizationId: v.string(),
    hash: v.string(),
    text: v.string(),
    language: v.string(),
    voice: v.optional(v.string()),
    renderer: v.string(),
    status: v.union(v.literal("pending_render"), v.literal("ready")),
    fileId: v.optional(v.id("storedFiles")),
  })
    .index("by_organizationId_and_hash", ["organizationId", "hash"])
    .index("by_organizationId", ["organizationId"]),
  ivrSessions: defineTable({
    organizationId: v.string(),
    callId: v.id("calls"),
    ivrId: v.id("ivrs"),
    definition,
    webhookSecret: v.string(),
    menuId: v.optional(v.string()),
    step: v.number(),
    deciding: v.boolean(),
    finalAction: v.optional(action),
  })
    .index("by_callId", ["callId"])
    .index("by_organizationId", ["organizationId"]),
}
