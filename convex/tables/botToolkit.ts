import { defineTable } from "convex/server"
import { v } from "convex/values"
export const collectField = v.object({
  key: v.string(),
  label: v.string(),
  description: v.string(),
  type: v.union(
    ...(
      ["text", "number", "boolean", "email", "phone", "date", "enum"] as const
    ).map(v.literal)
  ),
  options: v.optional(v.array(v.string())),
  required: v.boolean(),
  contactProperty: v.optional(v.string()),
})
export const collectedValue = v.union(v.string(), v.number(), v.boolean())
export const collected = v.record(
  v.string(),
  v.object({ value: collectedValue, inferred: v.boolean() })
)
export const knowledgeStatus = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed")
)
export const botToolkitTables = {
  knowledgeDocumentTexts: defineTable({
    organizationId: v.string(),
    documentId: v.id("knowledgeDocuments"),
    text: v.string(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_documentId", ["documentId"]),
  knowledgeBases: defineTable({
    organizationId: v.string(),
    name: v.string(),
    description: v.string(),
    documentCount: v.optional(v.number()),
    status: knowledgeStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organizationId", ["organizationId"]),
  knowledgeDocuments: defineTable({
    organizationId: v.string(),
    knowledgeBaseId: v.id("knowledgeBases"),
    title: v.string(),
    source: v.union(v.literal("upload"), v.literal("url"), v.literal("text")),
    text: v.optional(v.string()),
    url: v.optional(v.string()),
    fileId: v.optional(v.id("storedFiles")),
    storageId: v.optional(v.id("_storage")),
    byteSize: v.number(),
    status: knowledgeStatus,
    error: v.optional(v.string()),
    revision: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_knowledgeBaseId", ["knowledgeBaseId"])
    .index("by_knowledgeBaseId_and_status", ["knowledgeBaseId", "status"]),
  knowledgeChunks: defineTable({
    organizationId: v.string(),
    knowledgeBaseId: v.id("knowledgeBases"),
    scope: v.string(),
    documentId: v.id("knowledgeDocuments"),
    revision: v.string(),
    text: v.string(),
    position: v.number(),
    embedding: v.array(v.float64()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_documentId", ["documentId"])
    .index("by_knowledgeBaseId", ["knowledgeBaseId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["organizationId", "knowledgeBaseId", "scope"],
    }),
  botTools: defineTable({
    organizationId: v.string(),
    name: v.string(),
    description: v.string(),
    parameters: v.string(),
    method: v.union(
      v.literal("GET"),
      v.literal("POST"),
      v.literal("PUT"),
      v.literal("PATCH"),
      v.literal("DELETE")
    ),
    url: v.string(),
    encryptedHeaders: v.string(),
    encryptedSigningSecret: v.string(),
    timeoutMs: v.number(),
    resultFields: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_name", ["organizationId", "name"]),
}
