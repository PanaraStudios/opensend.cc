import { defineTable } from "convex/server"
import { v } from "convex/values"

export const exportStatusValue = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("expired"),
  v.literal("failed")
)

export const exportTables = {
  exports: defineTable({
    organizationId: v.string(),
    /** A key of `EXPORT_SOURCES` in convex/exportSources.ts. */
    resource: v.string(),
    status: exportStatusValue,
    rows: v.number(),
    storageId: v.optional(v.id("_storage")),
    expiresAt: v.number(),
    /** The list filters the export was started with. */
    filters: v.record(v.string(), v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
}
