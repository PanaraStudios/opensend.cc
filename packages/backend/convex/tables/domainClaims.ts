import { defineTable } from "convex/server"
import { v } from "convex/values"
import { regionValue } from "../ses/contracts"

export const claimStatus = v.union(
  ...(
    [
      "pending",
      "verified",
      "completed",
      "blocked",
      "expired",
      "superseded",
      "canceled",
      "failed",
    ] as const
  ).map((status) => v.literal(status))
)
export const claimRecord = v.object({
  type: v.literal("TXT"),
  name: v.string(),
  value: v.string(),
  ttl: v.literal("Auto"),
})
export const domainClaimTables = {
  domainClaims: defineTable({
    organizationId: v.string(),
    domainId: v.id("domains"),
    previousDomainId: v.id("domains"),
    name: v.string(),
    region: regionValue,
    status: claimStatus,
    record: claimRecord,
    expiresAt: v.number(),
    blockedReason: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    checkingAt: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_domainId", ["domainId"])
    .index("by_organizationId_and_name", ["organizationId", "name"]),
}
