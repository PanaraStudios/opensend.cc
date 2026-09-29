import { defineTable } from "convex/server"
import { v } from "convex/values"

export const sharedEmailId = v.union(v.id("emails"), v.id("receivedEmails"))
export const emailShareTables = {
  emailShares: defineTable({
    organizationId: v.string(),
    emailId: sharedEmailId,
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_emailId", ["organizationId", "emailId"])
    .index("by_tokenHash", ["tokenHash"])
    .index("by_expiresAt", ["expiresAt"]),
}
