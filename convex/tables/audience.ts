import { defineTable } from "convex/server"
import { v } from "convex/values"

export const topicDefaultValue = v.union(
  v.literal("opt_in"),
  v.literal("opt_out")
)
export const topicVisibilityValue = v.union(
  v.literal("public"),
  v.literal("private")
)
export const topicSubscriptionValue = v.union(
  v.literal("subscribed"),
  v.literal("unsubscribed")
)
export const propertyTypeValue = v.union(
  v.literal("string"),
  v.literal("number")
)

/* Segment membership and topic choices are child tables, not arrays on the
   contact: a segment can hold any number of contacts, and broadcasts resolve
   recipients by segment or topic. */
export const audienceTables = {
  contacts: defineTable({
    organizationId: v.string(),
    /** Normalized lowercase; unique per team. */
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    unsubscribed: v.boolean(),
    /** Keyed by property key, so bounded by the team's property count. */
    properties: v.record(v.string(), v.string()),
    /** Email and names, for the search box. */
    search: v.string(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_email", ["organizationId", "email"])
    .index("by_organizationId_and_unsubscribed", [
      "organizationId",
      "unsubscribed",
    ])
    .searchIndex("search_search", {
      searchField: "search",
      filterFields: ["organizationId", "unsubscribed"],
    }),
  contactProperties: defineTable({
    organizationId: v.string(),
    key: v.string(),
    name: v.string(),
    type: propertyTypeValue,
    fallbackValue: v.optional(v.string()),
    /** Set while its values are stripped from every contact. The key stays
        reserved until that finishes, so a new property never loses values. */
    deleting: v.optional(v.boolean()),
  }).index("by_organizationId_and_key", ["organizationId", "key"]),
  segments: defineTable({
    organizationId: v.string(),
    name: v.string(),
    /** Kept in the same mutation as every membership write. */
    memberCount: v.number(),
  }).index("by_organizationId", ["organizationId"]),
  segmentMembers: defineTable({
    organizationId: v.string(),
    segmentId: v.id("segments"),
    contactId: v.id("contacts"),
  })
    .index("by_segmentId", ["segmentId"])
    .index("by_contactId_and_segmentId", ["contactId", "segmentId"]),
  topics: defineTable({
    organizationId: v.string(),
    name: v.string(),
    description: v.string(),
    /** Fixed at creation: it decides every contact without an explicit row. */
    defaultSubscription: topicDefaultValue,
    visibility: topicVisibilityValue,
  }).index("by_organizationId", ["organizationId"]),
  /** Only explicit choices; anyone else follows the topic's default. */
  topicSubscriptions: defineTable({
    organizationId: v.string(),
    topicId: v.id("topics"),
    contactId: v.id("contacts"),
    subscription: topicSubscriptionValue,
  })
    .index("by_topicId_and_subscription", ["topicId", "subscription"])
    .index("by_contactId_and_topicId", ["contactId", "topicId"]),
}
