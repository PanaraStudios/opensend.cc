import { defineTable } from "convex/server"
import { v } from "convex/values"

export const teamTables = {
  // Erasure metadata only: no team name, member identity or product content.
  teamRetirements: defineTable({
    teamId: v.string(),
    completedAt: v.optional(v.number()),
  }).index("by_teamId", ["teamId"]),
}
