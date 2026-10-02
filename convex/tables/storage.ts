import { defineTable } from "convex/server"
import { v } from "convex/values"
import { STORAGE_USES } from "../../lib/storage/policy"

/** Existing documents keep their original storageId; new documents use fileId. */
export const fileReference = {
  fileId: v.optional(v.id("storedFiles")),
  storageId: v.optional(v.id("_storage")),
}
export const storageUse = v.union(...STORAGE_USES.map((use) => v.literal(use)))
export const uploadInput = v.object({
  use: storageUse,
  contentType: v.string(),
  size: v.number(),
  filename: v.string(),
  animated: v.optional(v.boolean()),
  from: v.optional(v.string()),
})
export const storageTables = {
  // Legacy object-provider migration documents remain valid; the runner is unused.
  storageMigrations: defineTable({
    leaseUntil: v.optional(v.number()),
    table: v.number(),
    cursor: v.union(v.string(), v.null()),
    copied: v.number(),
    status: v.union(
      v.literal("running"),
      v.literal("failed"),
      v.literal("complete")
    ),
    error: v.optional(v.string()),
  }),
  teamAssets: defineTable({
    organizationId: v.string(),
    fileId: v.id("storedFiles"),
  }).index("by_organizationId", ["organizationId"]),
  storedFiles: defineTable({
    organizationId: v.string(),
    // "object", key, pendingKey and sourceStorageId are legacy-only schema compatibility.
    provider: v.union(v.literal("convex"), v.literal("object")),
    key: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    // Receipt retained for idempotent completion after IVR normalization replaces the object.
    uploadStorageId: v.optional(v.id("_storage")),
    size: v.number(),
    contentType: v.string(),
    filename: v.optional(v.string()),
    sha256: v.optional(v.string()),
    sourceStorageId: v.optional(v.string()),
    references: v.optional(v.number()),
    feature: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("completing"),
      v.literal("ready"),
      v.literal("deleting")
    ),
    expiresAt: v.optional(v.number()),
    accountId: v.optional(v.id("channelAccounts")),
    animated: v.optional(v.boolean()),
    pendingKey: v.optional(v.string()),
  })
    .index("by_sourceStorageId", ["sourceStorageId"])
    .index("by_storageId", ["storageId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_state_and_expiresAt", ["state", "expiresAt"]),
}
