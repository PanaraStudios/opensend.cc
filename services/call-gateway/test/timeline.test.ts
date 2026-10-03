import assert from "node:assert/strict"
import { test } from "node:test"
import {
  callRelativeTimestamp,
  recordTranscript,
  sessionOffsetMs,
} from "../src/voice/timeline.js"

test("two bot sessions in one call share milliseconds since answer", () => {
  const answeredAt = 1_700_000_000_000
  // First bot session starts 10s after answer. Its own clock is 10255…156194.
  const firstOffset = sessionOffsetMs(answeredAt, answeredAt + 10_000)
  const firstStart = callRelativeTimestamp(firstOffset, 10255)
  const firstEnd = callRelativeTimestamp(firstOffset, 156194)
  // Tools stay on the call clock (wall time minus answer), not the bot session.
  const tool = 294356
  // After IVR, the second bot session restarts its clock at 0.
  const secondOffset = sessionOffsetMs(answeredAt, answeredAt + 300_000)
  const secondStart = callRelativeTimestamp(secondOffset, 7412)
  const secondLater = callRelativeTimestamp(secondOffset, 140740)
  assert.equal(firstStart, 20255)
  assert.equal(firstEnd, 166194)
  assert.equal(secondStart, 307412)
  assert.equal(secondLater, 440740)
  // Without the offset, 140740 sorts before the tool at 294356.
  assert.ok(firstStart < firstEnd)
  assert.ok(firstEnd < tool)
  assert.ok(tool < secondStart)
  assert.ok(secondStart < secondLater)
})

test("a transcript flushed after stop keeps the session offset", () => {
  const call = {
    stopped: true,
    sessionOffsetMs: 300_000,
    transcript: "agent: hello",
    lastActivity: 5,
  }
  const stamped = recordTranscript(
    call,
    { role: "caller", text: "रुकिए ज़रा", final: true, timestampMs: 7412 },
    99
  )
  assert.equal(stamped.timestampMs, 307412)
  assert.equal(call.lastActivity, 5)
  assert.match(call.transcript ?? "", /caller: रुकिए ज़रा/)
  const quiet: {
    stopped: boolean
    sessionOffsetMs: number
    transcript?: string
    lastActivity: number
  } = {
    stopped: false,
    sessionOffsetMs: 0,
    lastActivity: 1,
  }
  recordTranscript(
    quiet,
    { role: "caller", text: "partial", final: false, timestampMs: 10 },
    40
  )
  assert.equal(quiet.lastActivity, 40)
  assert.equal(quiet.transcript, undefined)
})
