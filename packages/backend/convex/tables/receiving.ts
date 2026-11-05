import { fileReference } from "./storage"
import { defineTable } from "convex/server"
import { v } from "convex/values"
import { phaseValue, regionValue } from "../ses/contracts"

/** Inbound mail. Every write to these tables goes through
    `convex/ses/inboundRegions.ts` and `convex/ses/inboundMessages.ts`. */
export const receivingTables = {
  /** A region's inbound infrastructure, installation-wide: the S3 bucket
      SES stores mail in, the SNS topic that announces it, and the receipt
      rule set the domains' rules live in. Created when the region's first
      domain turns receiving on. */
  inboundRegions: defineTable({
    region: regionValue,
    operation: v.union(v.literal("provision"), v.literal("cleanup")),
    phase: phaseValue,
    /** Bumped by every operation, so a stale worker cannot finish a newer one. */
    generation: v.number(),
    bucket: v.optional(v.string()),
    topicArn: v.optional(v.string()),
    subscriptionArn: v.optional(v.string()),
    callbackConfirmed: v.boolean(),
    /** The active rule set the domains' rules are added to. */
    ruleSet: v.optional(v.string()),
    /** Whether Opensend created and activated that set, rather than adopting
        the account's existing active one. Only such a set is ever
        deactivated again. */
    ownsRuleSet: v.optional(v.boolean()),
    error: v.optional(v.string()),
  })
    .index("by_region", ["region"])
    .index("by_topicArn", ["topicArn"]),
  /** One verified SNS notification of a message SES stored in S3, routed to
      the team whose domain received it. The raw notification is kept
      unparsed for the receiving pipeline. */
  inboundMessages: defineTable({
    organizationId: v.string(),
    domainId: v.id("domains"),
    region: regionValue,
    topicArn: v.string(),
    /** The SNS message ID, which deduplicates SNS's retries. */
    messageId: v.string(),
    /** SES's message ID, also the S3 object's name. */
    sesMessageId: v.string(),
    bucket: v.string(),
    objectKey: v.string(),
    /** The SES notification JSON, verbatim. */
    notification: v.string(),
    ...fileReference,
    size: v.optional(v.number()),
    storedAt: v.optional(v.number()),
    parsedAt: v.optional(v.number()),
    deletedFromS3At: v.optional(v.number()),
    rejected: v.optional(v.boolean()),
    transferError: v.optional(v.string()),
  })
    .index("by_bucket_and_objectKey", ["bucket", "objectKey"])
    .index("by_topicArn_and_messageId", ["topicArn", "messageId"])
    .index("by_organizationId", ["organizationId"]),
}
