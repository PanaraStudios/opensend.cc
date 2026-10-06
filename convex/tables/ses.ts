import { defineTable } from "convex/server"
import { v } from "convex/values"
import {
  phaseValue,
  quotaValue,
  regionValue,
  setupStepValue,
} from "../ses/contracts"

/** Installation-scoped state: owned by the super admin (first account). */
export const sesTables = {
  installation: defineTable({
    key: v.literal("installation"),
    siteUrl: v.string(),
    callbackOrigin: v.string(),
    environmentCheckedAt: v.number(),
    completedAt: v.optional(v.number()),
    installationId: v.optional(v.string()),
    telemetryEnabled: v.optional(v.boolean()),
    telemetryLastAttemptAt: v.optional(v.number()),
    telemetryScheduledAt: v.optional(v.number()),
    accountId: v.optional(v.string()),
    credentialKind: v.optional(v.union(v.literal("role"), v.literal("keys"))),
    encryptedCredentials: v.optional(v.string()),
    wrappedEncryptionKey: v.optional(v.string()),
    setupStep: v.optional(setupStepValue),
    accessKeyLast4: v.optional(v.string()),
    credentialRevision: v.number(),
    defaultRegion: v.optional(regionValue),
    /** The verified IAM policy revision; missing means revision 1. */
    policyRevision: v.optional(v.number()),
    /** Sends account email (verification, resets, invitations); set with
        `installationAdmin:setSystemSender`. */
    systemSender: v.optional(
      v.object({ from: v.string(), domainId: v.id("domains") })
    ),
  }).index("by_key", ["key"]),
  sesRegions: defineTable({
    region: regionValue,
    quota: quotaValue,
    checkedAt: v.number(),
    phase: phaseValue,
    error: v.optional(v.string()),
    topicArn: v.optional(v.string()),
    queueArn: v.optional(v.string()),
    subscriptionArn: v.optional(v.string()),
    callbackConfirmed: v.boolean(),
  })
    .index("by_region", ["region"])
    .index("by_topicArn", ["topicArn"]),
  sesTenants: defineTable({
    organizationId: v.string(),
    region: regionValue,
    name: v.string(),
    phase: phaseValue,
    operation: v.union(v.literal("provision"), v.literal("remove")),
    generation: v.number(),
    deleted: v.boolean(),
    arn: v.optional(v.string()),
    providerId: v.optional(v.string()),
    sendingStatus: v.optional(v.string()),
    customerSendingStatus: v.optional(v.string()),
    statusOperation: v.optional(v.string()),
    statusOperationAt: v.optional(v.number()),
    error: v.optional(v.string()),
    checkedAt: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_deleted", ["deleted"])
    .index("by_organizationId_and_region", ["organizationId", "region"])
    .index("by_operation_and_deleted_and_phase", [
      "operation",
      "deleted",
      "phase",
    ]),
  sesEvents: defineTable({
    topicArn: v.string(),
    messageId: v.string(),
    message: v.string(),
    projectedAt: v.optional(v.number()),
  }).index("by_topicArn_and_messageId", ["topicArn", "messageId"]),
}
