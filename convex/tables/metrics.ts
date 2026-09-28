import { defineTable } from "convex/server"
import { v } from "convex/values"
import { emailStatusValue } from "./emails"

export const metricType = v.union(
  emailStatusValue,
  v.literal("Permanent"),
  v.literal("Transient"),
  v.literal("Undetermined")
)

export const metricsTables = {
  recipientMetrics: defineTable({
    organizationId: v.string(),
    emailId: v.id("emails"),
    tenantId: v.id("sesTenants"),
    type: v.union(
      v.literal("sent"),
      v.literal("Permanent"),
      v.literal("complained")
    ),
    address: v.string(),
    at: v.number(),
  }).index("by_emailId_and_type_and_address", ["emailId", "type", "address"]),
  // One milestone per email, not one count per open/click notification.
  emailMetrics: defineTable({
    organizationId: v.string(),
    emailId: v.id("emails"),
    domainId: v.id("domains"),
    tenantId: v.optional(v.id("sesTenants")),
    type: metricType,
    createdAt: v.number(),
    at: v.number(),
    recipients: v.array(v.string()),
  }).index("by_emailId_and_type", ["emailId", "type"]),
}
