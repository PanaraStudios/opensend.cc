import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { tables } from "./generatedSchema"
import { oauthTables } from "./oauthSchema"
export default defineSchema({
  ...tables,
  ...oauthTables,
  oauthEpoch: defineTable({ key: v.string(), revision: v.number() }).index(
    "by_key",
    ["key"]
  ),
  oauthFlow: defineTable({
    token: v.string(),
    browserHash: v.string(),
    query: v.string(),
    clientId: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.number(),
    used: v.boolean(),
  }).index("by_token", ["token"]),
  oauthGrant: defineTable({
    clientId: v.string(),
    userId: v.string(),
    organizationId: v.string(),
    memberId: v.string(),
    scopes: v.array(v.string()),
    epochs: v.array(v.object({ key: v.string(), revision: v.number() })),
    createdAt: v.number(),
    revoked: v.boolean(),
  })
    .index("by_userId", ["userId"])
    .index("by_organizationId", ["organizationId"]),
  oauthUse: defineTable({ key: v.string(), grantId: v.string() }).index(
    "by_key",
    ["key"]
  ),
  oauthRate: defineTable({
    key: v.string(),
    start: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),
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
