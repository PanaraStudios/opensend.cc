import { test } from "node:test"
import assert from "node:assert/strict"
import {
  newIvr,
  newIvrMenu,
  ivrFormPayload,
  ivrActionLabel,
  ivrPathSummary,
} from "./voice-playground"
test("IVR form strips metadata and preserves every action and business-hours field", () => {
  const d = newIvr()
  d.name = "Reception"
  d.menus[0].prompt = { kind: "audio", fileId: "file" }
  d.menus[0].options = {
    "1": { kind: "submenu", menuId: "support" },
    "#": { kind: "webhook", url: "https://example.com/decide" },
  }
  const support = newIvrMenu("support")
  support.prompt = { kind: "tts", text: "Support", voice: "shubh" }
  support.options = {
    "2": { kind: "bot", botId: "bot" },
    "3": { kind: "playAndHangup", prompt: { kind: "audio", fileId: "bye" } },
  }
  d.menus.push(support)
  d.businessHours = {
    status: "ENABLED",
    timezone_id: "Asia/Kolkata",
    weekly_operating_hours: [
      { day_of_week: "MONDAY", open_time: "0900", close_time: "1700" },
    ],
    holiday_schedule: [
      { date: "2026-12-25", start_time: "0000", end_time: "0000" },
    ],
    closedAction: { kind: "voicemail" },
  }
  assert.deepEqual(
    ivrFormPayload({
      ...d,
      id: "resource",
      prompt_status: "ready",
    } as typeof d),
    d
  )
})
test("invalid forms fail through the same API validator", () => {
  assert.throws(() => ivrFormPayload(newIvr()), /Invalid TTS text/)
  const d = newIvr()
  d.name = "Example"
  d.menus[0].prompt = { kind: "tts", text: "Welcome" }
  d.menus[0].options = { "1": { kind: "submenu", menuId: "missing" } }
  assert.throws(() => ivrFormPayload(d), /Dangling menu/)
})
test("call outcomes describe routing and preserve timeout/invalid evidence", () => {
  assert.equal(
    ivrPathSummary([
      { menuId: "main", digits: "1" },
      { menuId: "support", digits: "timeout" },
    ]),
    "main: 1 → support: timeout"
  )
  assert.equal(ivrActionLabel({ kind: "agents" }), "Transfer to agents")
  assert.equal(
    ivrActionLabel({ kind: "bot", botId: "support" }),
    "Bot: support"
  )
})

test("clearing optional IVR settings emits explicit PATCH nulls", async () => {
  const { ivrFormPatch } = await import("./voice-playground")
  const d = newIvr()
  d.name = "Reception"
  d.menus[0].prompt = { kind: "tts", text: "Hello" }
  const patch = ivrFormPatch(d)
  assert.equal(patch.businessHours, null)
  assert.equal(patch.promptVoice, null)
})
