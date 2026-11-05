/* Validators the schema and the apps share. The schema (convex/tables)
   uses them for its fields; lib/ derives its types from them. */
import { v } from "convex/values"

/** `EmailStatus` in lib/dashboard/types.ts; also Resend's `last_event`. */
export const EMAIL_STATUSES = [
  "queued",
  "scheduled",
  "sent",
  "delivered",
  "delivery_delayed",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "failed",
  "canceled",
  "suppressed",
] as const
export const emailStatusValue = v.union(
  ...EMAIL_STATUSES.map((status) => v.literal(status))
)
export const SUPPRESSION_REASONS = ["bounced", "complained", "manual"] as const
export const suppressionReasonValue = v.union(
  ...SUPPRESSION_REASONS.map((reason) => v.literal(reason))
)
