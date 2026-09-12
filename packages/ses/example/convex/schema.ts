import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  testEmails: defineTable({
    email: v.string(),
    expectation: v.union(
      v.literal("success"),
      v.literal("bounce"),
      v.literal("complaint")
    ),
  }).index("by_email", ["email"]),
})
