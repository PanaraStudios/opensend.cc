import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { tables } from "./generatedSchema"
export default defineSchema({
  ...tables,
  member: tables.member.index("by_organizationId_and_userId", [
    "organizationId",
    "userId",
  ]),
  bootstrap: defineTable({ key: v.string(), userId: v.string() }).index(
    "by_key",
    ["key"]
  ),
  sso: defineTable({
    organizationId: v.string(),
    issuer: v.string(),
    clientId: v.string(),
    encryptedSecret: v.string(),
    revision: v.string(),
    tested: v.boolean(),
    enforced: v.boolean(),
  }).index("by_organizationId", ["organizationId"]),
  ssoProof: defineTable({
    sessionId: v.string(),
    organizationId: v.string(),
    revision: v.string(),
  }).index("by_sessionId_and_organizationId", ["sessionId", "organizationId"]),
  avatar: defineTable({
    organizationId: v.string(),
    storageId: v.id("_storage"),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_storageId", ["storageId"]),
})
