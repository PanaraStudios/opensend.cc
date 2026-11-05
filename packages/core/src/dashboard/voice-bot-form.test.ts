import { test } from "node:test"
import assert from "node:assert/strict"
import {
  newVoiceBot,
  orderCallTranscript,
  voiceBotFormPayload,
  voiceDiagnostic,
} from "./voice-bot-form"
test("bot form whitelists REST config and roundtrips independent cascade credentials and limits", () => {
  const b = newVoiceBot("cascade")
  b.name = "Support"
  b.credentialId = "primary"
  b.stt!.credentialId = "speech"
  b.llm!.credentialId = "text"
  b.tts = {
    provider: "elevenlabs",
    model: "eleven_v4_turbo",
    credentialId: "voice",
    voice: "custom-voice",
  }
  b.tools = ["lookup_contact", "end_call"]
  b.handoff = { agents: false, ivrId: "reception" }
  b.monthlyMinuteBudget = 0
  b.maxConcurrentCalls = 2
  const result = voiceBotFormPayload({
    ...b,
    id: "resource",
    updatedAt: 123,
  } as typeof b)
  assert.equal(result.tts?.credentialId, "voice")
  assert.equal(result.monthlyMinuteBudget, 0)
  assert.deepEqual(result.handoff, b.handoff)
  assert.ok(!("id" in result))
  assert.ok(!("updatedAt" in result))
})
test("call transcript order uses one clock and falls back for older rows", () => {
  const firstOffset = 10_000
  const secondOffset = 300_000
  const lines = [
    {
      id: "second",
      timestampMs: secondOffset + 7412,
      timeline: "call" as const,
      createdAt: 3,
    },
    {
      id: "tool",
      timestampMs: 294356,
      timeline: "call" as const,
      createdAt: 2,
    },
    {
      id: "first",
      timestampMs: firstOffset + 156194,
      timeline: "call" as const,
      createdAt: 1,
    },
    {
      id: "tie-later",
      timestampMs: 294356,
      timeline: "call" as const,
      createdAt: 4,
    },
  ]
  assert.deepEqual(
    orderCallTranscript(lines).map((line) => line.id),
    ["first", "tool", "tie-later", "second"]
  )
  const legacy = [
    { id: "created-first", timestampMs: 180_000, createdAt: 1 },
    { id: "created-second", timestampMs: 1000, createdAt: 2 },
  ]
  assert.deepEqual(
    orderCallTranscript(legacy).map((line) => line.id),
    ["created-first", "created-second"]
  )
  assert.deepEqual(
    orderCallTranscript([
      ...lines.slice(0, 1),
      { id: "old", timestampMs: 1, createdAt: 9 },
    ]).map((line) => line.id),
    ["second", "old"]
  )
})
test("bot defaults require a key and diagnostics preserve real timing and interruption evidence", () => {
  assert.throws(() => voiceBotFormPayload(newVoiceBot()), /credentialId|name/)
  assert.deepEqual(
    voiceDiagnostic({
      kind: "media",
      text: '{"type":"latency","latencyMs":125,"turnId":"turn-1"}',
    }),
    { label: "Turn latency", detail: "125 ms · turn-1" }
  )
  assert.equal(
    voiceDiagnostic({
      kind: "media",
      text: '{"type":"barge_in","playedMs":400}',
    })?.label,
    "Interrupted"
  )
  assert.equal(voiceDiagnostic({ kind: "media", text: "bad json" }), null)
})

test("call detail diagnostics explain tool outcome, latency and hangup reason", () => {
  assert.equal(
    voiceDiagnostic({
      kind: "media",
      text: JSON.stringify({
        type: "tool_call",
        toolName: "transfer_to_agent",
        status: "failed",
        latencyMs: 20,
        error: "No agent available",
      }),
    })?.detail,
    "transfer_to_agent · failed · 20 ms · No agent available"
  )
  assert.deepEqual(
    voiceDiagnostic({
      kind: "media",
      text: JSON.stringify({
        type: "tool_call",
        toolName: "end_call",
        status: "succeeded",
        latencyMs: 42,
      }),
    }),
    { label: "Tool call", detail: "end_call · succeeded · 42 ms" }
  )
  assert.deepEqual(
    voiceDiagnostic({
      kind: "media",
      text: JSON.stringify({ type: "hangup", reason: "Ended by bot" }),
    }),
    { label: "Call ended", detail: "Ended by bot" }
  )
})
