import { defineTable } from "convex/server"
import { v } from "convex/values"

export const smtpPort = v.union(v.literal(465), v.literal(587))
export const smtpTables = {
  smtpSettings: defineTable({
    organizationId: v.string(),
    enabled: v.boolean(),
    port: smtpPort,
  }).index("by_organizationId", ["organizationId"]),
}
