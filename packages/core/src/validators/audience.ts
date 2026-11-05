/* Validators the schema and the apps share. The schema (convex/tables)
   uses them for its fields; lib/ derives its types from them. */
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
