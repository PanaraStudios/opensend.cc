/** Away controls follow saved team routing; transport readiness gates going online. */
export function hasAgentRoute(
  numbers: readonly { mode: string; routing: string | null }[] | undefined
) {
  return !!numbers?.some(
    (number) => number.mode === "gateway" && number.routing === "agents"
  )
}

export type SoftphonePhase =
  | "away"
  | "registering"
  | "idle"
  | "ringing"
  | "claiming"
  | "connecting"
  | "active"
  | "held"
  | "ending"
  | "error"
export type SoftphoneEvent =
  | "online"
  | "registered"
  | "incoming"
  | "answer"
  | "claimed"
  | "connected"
  | "hold"
  | "resume"
  | "hangup"
  | "hangupFailed"
  | "ended"
  | "fail"
  | "away"
const transitions: Partial<
  Record<SoftphonePhase, Partial<Record<SoftphoneEvent, SoftphonePhase>>>
> = {
  away: { online: "registering" },
  registering: { registered: "idle" },
  idle: { incoming: "ringing", answer: "connecting", connected: "active" },
  ringing: { answer: "claiming", ended: "idle" },
  claiming: { claimed: "connecting", ended: "idle" },
  connecting: { connected: "active", hangup: "ending", ended: "idle" },
  active: { hold: "held", hangup: "ending", ended: "idle" },
  held: { resume: "active", hangup: "ending", ended: "idle" },
  ending: { ended: "idle", hangupFailed: "active" },
  error: { online: "registering", ended: "idle" },
}
export function softphoneTransition(
  phase: SoftphonePhase,
  event: SoftphoneEvent
): SoftphonePhase {
  if (event === "away") return "away"
  if (event === "fail") return "error"
  return transitions[phase]?.[event] ?? phase
}
export function callElapsed(start: number | null | undefined, now: number) {
  return Math.max(0, Math.floor((now - (start ?? now)) / 1000))
}

/** A queued offer is ringable only after the clock is known and still inside the window.
    `now` of 0 is the unset clock, not the epoch, so it must not match every call. */
export function offerIsFresh(
  offeredAt: number,
  now: number,
  windowMs = 60_000
) {
  return now > 0 && offeredAt + windowMs > now
}

/** Presence is current only once the clock is known and the lease has not expired. */
export function presenceIsCurrent(availableUntil: number, now: number) {
  return now > 0 && availableUntil > now
}

/** Online/away for a roster row. An unset clock shows the stored status. */
export function agentPresenceLabel(
  status: string,
  availableUntil: number,
  now: number
) {
  const current = now > 0 && availableUntil <= now ? "away" : status || "away"
  if (current === "online") return "Online"
  if (current === "away") return "Away"
  return current
}
export function callTimer(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`
}
export function callEventLabel(status: string, duration?: number | null) {
  return ["missed", "rejected", "failed"].includes(status)
    ? "Missed voice call"
    : `Voice call${duration == null ? "" : ` ${Math.max(0, Math.floor(duration))} sec`}`
}
export function permissionAllows(
  data: Record<string, unknown>,
  action: "start_call" | "send_call_permission_request",
  now = Date.now()
) {
  const permission = data.permission as
    | {
        status?: string
        expiration_time?: number | string
        expiration?: number | string
      }
    | undefined
  if (action === "start_call") {
    if (
      !permission ||
      !["granted", "temporary", "permanent"].includes(permission.status ?? "")
    )
      return false
    const expires = permission.expiration_time ?? permission.expiration
    if (
      permission.status !== "permanent" &&
      expires != null &&
      (!Number.isFinite(Number(expires)) || Number(expires) * 1000 <= now)
    )
      return false
  }
  const actions = Array.isArray(data.actions) ? data.actions : []
  const explicit = actions.find(
    (a) => a && typeof a === "object" && a.action_name === action
  )
  if (explicit) {
    const limits: Record<string, unknown>[] = Array.isArray(explicit.limits)
      ? explicit.limits
      : []
    if (
      limits.some(
        (limit) =>
          limit &&
          typeof limit === "object" &&
          typeof limit.max_allowed === "number" &&
          typeof limit.current_usage === "number" &&
          limit.current_usage >= limit.max_allowed &&
          (limit.limit_expiration_time == null ||
            Number(limit.limit_expiration_time) * 1000 > now)
      )
    )
      return false
    return explicit.can_perform_action === true
  }
  return action === "start_call"
}
export function isDtmf(value: string) {
  return /^[0-9*#]$/.test(value)
}
