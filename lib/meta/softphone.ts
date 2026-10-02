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
  ending: { ended: "idle" },
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
  const actions = Array.isArray(data.actions) ? data.actions : []
  const explicit = actions.find(
    (a) => a && typeof a === "object" && a.action_name === action
  )
  if (explicit) return explicit.can_perform_action === true
  if (action !== "start_call") return false
  const permission = data.permission as
    { status?: string; expiration_time?: number | string } | undefined
  return (
    !!permission &&
    ["granted", "temporary", "permanent"].includes(permission.status ?? "") &&
    (!permission.expiration_time ||
      Number(permission.expiration_time) * 1000 > now)
  )
}
export function isDtmf(value: string) {
  return /^[0-9*#]$/.test(value)
}
