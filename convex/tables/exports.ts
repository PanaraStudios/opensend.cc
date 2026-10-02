import { fileReference } from "./storage"
import { defineTable } from "convex/server"
import { v } from "convex/values"

export const exportStatusValue = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("expired"),
  v.literal("failed")
)
/** One list filter as the export dialog confirmed it. */
export const exportFilterLineValue = v.object({
  label: v.string(),
  value: v.string(),
})

/* Every write goes through convex/exportRows.ts. */
export const exportTables = {
  exports: defineTable({
    organizationId: v.string(),
    /** A key of `EXPORT_SOURCES` in convex/exportSources.ts. */
    resource: v.string(),
    status: exportStatusValue,
    rows: v.number(),
    error: v.optional(v.string()),
    notificationEmailId: v.optional(v.id("emails")),
    ...fileReference,
    expiresAt: v.number(),
    /** The list filters the export was started with, as the source reads
        them. */
    filters: v.record(v.string(), v.string()),
    /* Optional only for exports started before these were kept. */
    /** `domains-1790557161016.csv`. */
    fileName: v.optional(v.string()),
    creatorEmail: v.optional(v.string()),
    /** The filters as the dialog showed them; at most `SUMMARY_LINES`. */
    summary: v.optional(v.array(exportFilterLineValue)),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"]),
}
