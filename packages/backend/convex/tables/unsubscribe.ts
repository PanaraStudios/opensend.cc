import { defineTable } from "convex/server"
import { v } from "convex/values"

export const unsubscribeTables = {
  /** A team's saved unsubscribe page; a team without one gets the defaults.
      Written only through `savePage` in convex/unsubscribe.ts. */
  unsubscribePages: defineTable({
    organizationId: v.string(),
    brandName: v.string(),
    heading: v.string(),
    body: v.string(),
    updatedAt: v.number(),
  }).index("by_organizationId", ["organizationId"]),
}
