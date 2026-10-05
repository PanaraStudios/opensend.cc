import { test } from "node:test"
import assert from "node:assert/strict"
import {
  newIvr,
  newIvrMenu,
  renameIvrMenu,
  ivrFormPayload,
  ivrActionLabel,
  ivrPathSummary,
  ivrReferencedBotIds,
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
  assert.equal(ivrActionLabel({ kind: "bot", botId: "support" }), "Voice bot")
  assert.equal(
    ivrActionLabel({ kind: "submenu", menuId: "after-hours" }),
    "Submenu"
  )
  assert.equal(
    ivrActionLabel({ kind: "submenu", menuId: "after-hours" }, [
      { id: "after-hours", name: "After hours" },
    ]),
    "Menu: After hours"
  )
})

test("IVR bot name lookups stay inside the picker point-read cap", () => {
  const definition = newIvr()
  definition.menus[0].options = {
    "1": { kind: "bot", botId: "bot-a" },
    "2": { kind: "hangup" },
  }
  definition.menus[0].noInputAction = { kind: "bot", botId: "bot-a" }
  definition.businessHours = {
    status: "DISABLED",
    closedAction: { kind: "bot", botId: "bot-b" },
  }
  assert.deepEqual(ivrReferencedBotIds(definition), ["bot-a", "bot-b"])
  definition.menus[0].options = Object.fromEntries(
    Array.from({ length: 80 }, (_, index) => [
      String(index),
      { kind: "bot" as const, botId: `bot-${index}` },
    ])
  )
  assert.equal(ivrReferencedBotIds(definition).length, 64)
  assert.equal(ivrReferencedBotIds(definition)[0], "bot-0")
})

test("call and permission labels stay readable", async () => {
  const {
    callOutcomeLabel,
    callPermissionLabel,
    callPermissionReplyLabel,
    callRouteLabel,
  } = await import("./voice-playground")
  assert.equal(callOutcomeLabel("answered"), "Answered")
  assert.equal(callOutcomeLabel("no_answer"), "No answer")
  assert.equal(callOutcomeLabel(null), "In progress")
  assert.equal(callPermissionLabel(undefined), "Not checked")
  assert.equal(callPermissionLabel("unknown"), "Not checked")
  assert.equal(callPermissionLabel("no_permission"), "No permission")
  assert.equal(callPermissionLabel("permanent"), "Permanent")
  assert.equal(callPermissionReplyLabel("accept"), "Accepted")
  assert.equal(callPermissionReplyLabel("reject"), "Declined")
  assert.equal(callPermissionReplyLabel("maybe_later"), "Maybe later")
  assert.equal(callRouteLabel({ bot_id: "bot", bot_name: "Ada" }), "Bot Ada")
  assert.equal(callRouteLabel({ bot_id: "bot", bot_name: "" }), "Voice bot")
  assert.equal(
    callRouteLabel({ ivr_id: "ivr" }, [{ id: "ivr", name: "Front desk" }]),
    "IVR Front desk"
  )
  assert.equal(callRouteLabel({ ivr_id: "missing" }), "IVR")
  assert.equal(callRouteLabel({ handling_mode: "api" }), "API")
  assert.equal(callRouteLabel({}), "Agent")
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

test("menu names generate collision-safe IDs and keep all routing references", () => {
  const definition = newIvr()
  definition.menus.push(newIvrMenu("support"))
  definition.menus[0].options["1"] = { kind: "submenu", menuId: "support" }
  definition.menus[0].failureAction = { kind: "submenu", menuId: "support" }
  const renamed = renameIvrMenu(definition, "support", "Main")
  assert.equal(renamed.menus[1].id, "main-2")
  assert.deepEqual(renamed.menus[0].options["1"], {
    kind: "submenu",
    menuId: "main-2",
  })
  assert.deepEqual(renamed.menus[0].failureAction, {
    kind: "submenu",
    menuId: "main-2",
  })
  assert.equal(
    renameIvrMenu(renamed, "main", "Reception").entryMenuId,
    "reception"
  )
})
