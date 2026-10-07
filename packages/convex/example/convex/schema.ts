import { defineSchema, defineTable } from "convex/server"
import { vEmailEvent } from "@opensendcc/convex"
import { v } from "convex/values"
export default defineSchema({
  emailEvents: defineTable({ emailId: v.string(), event: vEmailEvent }).index(
    "by_emailId",
    ["emailId"]
  ),
})
