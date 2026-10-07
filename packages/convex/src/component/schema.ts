import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

import { vEmail, vStatus } from "./shared.js"

export default defineSchema({
  emails: defineTable({
    ...vEmail.fields,
    status: vStatus,
    /* Sent as Idempotency-Key on every attempt, so a retry never sends
       twice. */
    idempotencyKey: v.string(),
    workId: v.optional(v.string()),
    onEmailEvent: v.optional(v.string()),
    sentEventApplied: v.optional(v.boolean()),
    enqueueKey: v.optional(v.string()),
    /* OpenSend's id for the email, set once OpenSend accepts it. Webhook
       events are matched on it. */
    opensendId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    opened: v.boolean(),
    clicked: v.boolean(),
    complained: v.boolean(),
    /* Last finalization or applied webhook activity. NOT_FINALIZED while
       queued, so the cleanup range scan never reaches queued mail. */
    finalizedAt: v.number(),
  })
    .index("by_enqueueKey", ["enqueueKey"])
    .index("by_opensendId", ["opensendId"])
    .index("by_finalizedAt", ["finalizedAt"]),
})
