export type CallCardState = {
  id: string | null
  phase:
    | "hidden"
    | "incoming"
    | "connecting"
    | "active"
    | "ended"
    | "declined"
    | "missed"
  minimized: boolean
}
export type CallCardEvent =
  | { type: "incoming" | "connecting" | "connected" | "retry"; id: string }
  | { type: "ended" | "declined" | "missed"; id: string }
  | { type: "minimize" }
  | { type: "expand" }
  | { type: "dismiss" }
export const emptyCallCard: CallCardState = {
  id: null,
  phase: "hidden",
  minimized: false,
}
export function callCardTransition(
  state: CallCardState,
  event: CallCardEvent
): CallCardState {
  if (event.type === "dismiss") return emptyCallCard
  if (event.type === "minimize" || event.type === "expand")
    return { ...state, minimized: event.type === "minimize" }
  if (event.type === "retry")
    return state.id === event.id &&
      ["incoming", "connecting"].includes(state.phase)
      ? { ...state, phase: "incoming" }
      : state
  if (["ended", "declined", "missed"].includes(event.type)) {
    if (
      state.id !== event.id ||
      !["incoming", "connecting", "active"].includes(state.phase)
    )
      return state
    return { ...state, phase: event.type as "ended" | "declined" | "missed" }
  }
  if (
    state.id === event.id &&
    ["ended", "declined", "missed"].includes(state.phase)
  )
    return state
  if (
    event.type === "connecting" &&
    state.id === event.id &&
    state.phase === "active"
  )
    return state
  if (
    event.type === "incoming" &&
    state.id === event.id &&
    state.phase !== "incoming"
  )
    return state
  return {
    id: event.id,
    phase:
      event.type === "connected"
        ? "active"
        : (event.type as "incoming" | "connecting"),
    minimized: state.id === event.id ? state.minimized : false,
  }
}
/** The server grants exactly one browser lease per agent. Never ring on a stale local flag. */
export function ownsSoftphone(
  online: boolean,
  browserId: string,
  leaseId: string,
  me:
    | { browserId: string; leaseId: string; status: "online" | "away" }
    | null
    | undefined
) {
  return (
    online &&
    !!leaseId &&
    me?.browserId === browserId &&
    me.leaseId === leaseId &&
    me.status === "online"
  )
}
