import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { CALL_TERMINAL } from "../../lib/meta/calling"

export const ACTIVITY_INTERVAL_MS = 30_000
export const INACTIVE_CALL_MS = 120_000

/** Legacy rows use the newest known activity, never an older setup timestamp. */
export function lastActivity(call: Doc<"calls">) {
  return (
    Math.max(
      call.lastActivityAt ?? 0,
      call.gatewayAt ?? 0,
      call.mediaUpAt ?? 0,
      call.connectedAt ?? 0,
      call.observedAt
    ) || call._creationTime
  )
}

export async function recordActivity(ctx: MutationCtx, call: Doc<"calls">) {
  const now = Date.now()
  if (CALL_TERMINAL.has(call.status) || now < (call.lastActivityAt ?? 0)) return
  // This upper bound covers callbacks suppressed during the next write interval.
  // Without that allowance, activity just before expiry could be lost to throttling.
  // Use receipt time so gateway clock skew cannot expire or pin a live call.
  await ctx.db.patch("calls", call._id, {
    lastActivityAt: now + ACTIVITY_INTERVAL_MS,
  })
}
