import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import {
  adoptionValue,
  setupStepValue,
  dnsProviderValue,
} from "./ses/contracts"
import {
  domainStatusValue,
  phaseValue,
  quotaValue,
  recordValue,
  regionValue,
  tlsValue,
} from "./ses/contracts"
export default defineSchema({
  installation: defineTable({
    key: v.literal("installation"),
    siteUrl: v.string(),
    callbackOrigin: v.string(),
    environmentCheckedAt: v.number(),
    completedAt: v.optional(v.number()),
    accountId: v.optional(v.string()),
    credentialKind: v.optional(v.union(v.literal("role"), v.literal("keys"))),
    encryptedCredentials: v.optional(v.string()),
    wrappedEncryptionKey: v.optional(v.string()),
    setupStep: v.optional(setupStepValue),
    accessKeyLast4: v.optional(v.string()),
    credentialRevision: v.number(),
    defaultRegion: v.optional(regionValue),
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
    error: v.optional(v.string()),
    checkedAt: v.optional(v.number()),
  })
    .index("by_organizationId_and_region", ["organizationId", "region"])
    .index("by_operation_and_deleted_and_phase", [
      "operation",
      "deleted",
      "phase",
    ]),
  domains: defineTable({
    dnsProvider: v.optional(dnsProviderValue),
    dnsProviderCheckedAt: v.optional(v.number()),
    dnsProviderRequestedAt: v.optional(v.number()),
    tenantId: v.optional(v.id("sesTenants")),
    tenantAssociated: v.optional(v.boolean()),
    adoption: v.optional(adoptionValue),
    organizationId: v.string(),
    name: v.string(),
    region: regionValue,
    customReturnPath: v.string(),
    status: domainStatusValue,
    phase: phaseValue,
    deleted: v.boolean(),
    sending: v.boolean(),
    tls: tlsValue,
    pendingTls: v.optional(tlsValue),
    records: v.array(recordValue),
    sesVerified: v.boolean(),
    dkimVerified: v.boolean(),
    mailFromVerified: v.boolean(),
    dnsVerifiedAt: v.optional(v.number()),
    partiallyVerifiedAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    configurationSet: v.optional(v.string()),
    checkedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    operation: v.union(
      v.literal("provision"),
      v.literal("refresh"),
      v.literal("settings"),
      v.literal("remove")
    ),
  })
    .index("by_name_and_region", ["name", "region"])
    .index("by_name_and_region_and_deleted", ["name", "region", "deleted"])
    .index("by_organizationId_and_deleted_and_name", [
      "organizationId",
      "deleted",
      "name",
    ])
    .index("by_organizationId_and_deleted_and_region_and_name", [
      "organizationId",
      "deleted",
      "region",
      "name",
    ])
    .index("by_organizationId_and_deleted_and_status_and_name", [
      "organizationId",
      "deleted",
      "status",
      "name",
    ])
    .index("by_organizationId_and_deleted_and_status_and_region_and_name", [
      "organizationId",
      "deleted",
      "status",
      "region",
      "name",
    ]),
  domainHistory: defineTable({
    domainId: v.id("domains"),
    message: v.string(),
  }).index("by_domainId", ["domainId"]),
  sesEvents: defineTable({
    topicArn: v.string(),
    messageId: v.string(),
    message: v.string(),
  }).index("by_topicArn_and_messageId", ["topicArn", "messageId"]),
})
