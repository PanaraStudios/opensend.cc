import type { VoiceTranscript } from "../voice-adapter.js"

/** Milliseconds from answer until this bot media session's own clock started. */
export function sessionOffsetMs(answeredAt: number, now = Date.now()) {
  if (!Number.isFinite(answeredAt) || !Number.isFinite(now)) return 0
  return Math.max(0, Math.round(now - answeredAt))
}

/** Session-relative media time plus the session's offset from answer. */
export function callRelativeTimestamp(
  offsetMs: number,
  sessionTimestampMs: number
) {
  const offset = Number.isFinite(offsetMs) ? offsetMs : 0
  const session = Number.isFinite(sessionTimestampMs) ? sessionTimestampMs : 0
  return Math.max(0, Math.round(offset + session))
}

export function stampTranscript<T extends { timestampMs: number }>(
  offsetMs: number,
  transcript: T
): T {
  return {
    ...transcript,
    timestampMs: callRelativeTimestamp(offsetMs, transcript.timestampMs),
  }
}

/**
 * Keep a late flush (barge-in, transfer, hangup) on the session that spoke it.
 * Silence tracking stops once the call is stopped; the line is still returned.
 */
export function recordTranscript(
  call: {
    stopped: boolean
    sessionOffsetMs?: number
    transcript?: string
    lastActivity?: number
  },
  transcript: VoiceTranscript,
  now = Date.now()
) {
  const stamped = stampTranscript(call.sessionOffsetMs ?? 0, transcript)
  if (stamped.final)
    call.transcript = (
      (call.transcript ?? "") + `\n${stamped.role}: ${stamped.text}`
    ).slice(-24000)
  if (!call.stopped) call.lastActivity = now
  return stamped
}
