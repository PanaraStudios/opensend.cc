import { defineTable } from "convex/server"
import { v } from "convex/values"
import {
  adoptionValue,
  dnsProviderValue,
  domainConnectValue,
  domainOperationValue,
  domainStatusValue,
  phaseValue,
  recordValue,
  regionValue,
  tlsValue,
} from "../ses/contracts"

export const domainTables = {
  domains: defineTable({
    dnsProvider: v.optional(dnsProviderValue),
    dnsProviderCheckedAt: v.optional(v.number()),
    dnsProviderRequestedAt: v.optional(v.number()),
    domainConnect: v.optional(domainConnectValue),
    tenantId: v.optional(v.id("sesTenants")),
    tenantAssociated: v.optional(v.boolean()),
    adoption: v.optional(adoptionValue),
    /* Set by the worker when a failure is an identity-ownership conflict an
       installation admin can resolve by reviewing the existing identity. */
    needsAdoptionReview: v.optional(v.boolean()),
    organizationId: v.string(),
    name: v.string(),
    region: regionValue,
    customReturnPath: v.string(),
    status: domainStatusValue,
    phase: phaseValue,
    deleted: v.boolean(),
    sending: v.boolean(),
    receiving: v.optional(v.boolean()),
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
    /* When the next automatic status check is due, and how many have run
       since the last operation. Unset once the domain is verified or the
       checks run out. */
    nextCheckAt: v.optional(v.number()),
    checkAttempt: v.optional(v.number()),
    /** Set while a status check is running, so the UI can show it. */
    checking: v.optional(v.boolean()),
    error: v.optional(v.string()),
    operation: domainOperationValue,
  })
    .index("by_name_and_region_and_deleted", ["name", "region", "deleted"])
    .index("by_nextCheckAt", ["nextCheckAt"])
    // The REST API lists newest first, like Resend.
    .index("by_organizationId_and_deleted", ["organizationId", "deleted"])
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
}
