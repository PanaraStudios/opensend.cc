import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { CALL_TERMINAL } from "../../lib/meta/calling"

export const ACTIVITY_INTERVAL_MS = 30_000
export const INACTIVE_CALL_MS = 120_000
// Older gateways do not report periodic activity. Allow long live calls when
// the backend is upgraded first; lack of a heartbeat is not evidence of media loss.
export const LEGACY_INACTIVE_CALL_MS = 2 * 60 * 60 * 1000

export function inactivityTimeout(call: Doc<"calls">) {
  return call.supportsHeartbeats ? INACTIVE_CALL_MS : LEGACY_INACTIVE_CALL_MS
}

export function inactivityReason(call: Doc<"calls">) {
  return call.supportsHeartbeats
    ? "Ended: no audio for 2 minutes"
    : "Ended: no recorded activity for 2 hours"
}

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

export async function recordActivity(
  ctx: MutationCtx,
  call: Doc<"calls">,
  heartbeat = false
) {
  const now = Date.now()
  const firstHeartbeat = heartbeat && !call.supportsHeartbeats
  const refreshActivity = now >= (call.lastActivityAt ?? 0)
  if (CALL_TERMINAL.has(call.status) || (!refreshActivity && !firstHeartbeat))
    return
  // This upper bound covers callbacks suppressed during the next write interval.
  // Without that allowance, activity just before expiry could be lost to throttling.
  // Use receipt time so gateway clock skew cannot expire or pin a live call.
  await ctx.db.patch("calls", call._id, {
    ...(refreshActivity ? { lastActivityAt: now + ACTIVITY_INTERVAL_MS } : {}),
    ...(firstHeartbeat ? { supportsHeartbeats: true } : {}),
  })
}
