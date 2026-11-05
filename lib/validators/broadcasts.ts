/* Validators the schema and the apps share. The schema (convex/tables)
   uses them for its fields; lib/ derives its types from them. */
import { v } from "convex/values"

export const broadcastChannel = v.union(
  v.literal("email"),
  v.literal("whatsapp"),
  v.literal("messenger"),
  v.literal("instagram")
)
export const skipReasonValue = v.union(
  v.literal("no_phone"),
  v.literal("no_channel_identity"),
  v.literal("no_email"),
  v.literal("unsubscribed"),
  v.literal("topic_opt_out"),
  v.literal("marketing_opt_out"),
  v.literal("missing_variables"),
  v.literal("contact_deleted"),
  v.literal("window_closed")
)
export const whatsappStatsValue = v.object({
  recipients: v.number(),
  sent: v.number(),
  delivered: v.number(),
  read: v.number(),
  failed: v.number(),
  skipped: v.number(),
})

export const BROADCAST_STATUSES = [
  "draft",
  "scheduled",
  "queued",
  "sent",
  "failed",
  "canceled",
] as const
export const broadcastStatusValue = v.union(
  ...BROADCAST_STATUSES.map((s) => v.literal(s))
)
export const broadcastStatsValue = v.object({
  recipients: v.number(),
  delivered: v.number(),
  opened: v.number(),
  clicked: v.number(),
  bounced: v.number(),
  suppressed: v.number(),
  complained: v.number(),
  unsubscribed: v.number(),
})
