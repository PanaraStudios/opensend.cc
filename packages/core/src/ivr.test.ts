import assert from "node:assert/strict"
import { test } from "node:test"
import { parseIvr, validateIvr, isIvrOpen, type IvrDefinition } from "./ivr"
import {
  promptHash,
  signPrompt,
  verifyPrompt,
  IVR_RENDERER,
} from "./ivr-prompts"
const hangup = { kind: "hangup" as const }
const menu = {
  id: "main",
  name: "Main",
  prompt: { kind: "tts" as const, text: "Press one" },
  options: { "1": hangup, "#": hangup, "*": hangup },
  noInputAction: hangup,
  failureAction: hangup,
}
const input = {
  name: "Reception",
  language: "en",
  entryMenuId: "main",
  menus: [menu],
}
test("IVR defaults and keyed digits; cycles with caller input are legal", () => {
  const d = parseIvr(input)
  assert.deepEqual(
    [d.menus[0].timeoutSeconds, d.menus[0].retries, d.menus[0].maxDigits],
    [5, 2, 1]
  )
  assert.equal(
    validateIvr({
      ...input,
      menus: [
        { ...menu, options: { "1": { kind: "submenu", menuId: "main" } } },
      ],
    }).valid,
    true
  )
  assert.equal(
    validateIvr({
      ...input,
      menus: [{ ...menu, noInputAction: { kind: "submenu", menuId: "main" } }],
    }).valid,
    false
  )
  assert.equal(
    validateIvr({
      ...input,
      menus: [{ ...menu, failureAction: { kind: "submenu", menuId: "main" } }],
    }).valid,
    false
  )
})
test("IVR rejects dangling/duplicate/unreachable menus, unknown actions, digit keys, limits and automatic cycles", () => {
  for (const menus of [
    [],
    Array.from({ length: 51 }, () => menu),
    [menu, { ...menu, id: "unreachable" }],
    [menu, menu],
    [{ ...menu, options: { "1": { kind: "submenu", menuId: "missing" } } }],
    [{ ...menu, options: { "11": hangup } }],
    [
      {
        ...menu,
        options: [
          { digit: "1", action: hangup },
          { digit: "1", action: hangup },
        ],
      },
    ],
    [{ ...menu, retries: 6 }],
    [{ ...menu, maxDigits: 0 }],
    [{ ...menu, timeoutSeconds: NaN }],
    [{ ...menu, options: { "1": { kind: "execute", command: "bad" } } }],
    [{ ...menu, prompt: { kind: "tts", text: "x".repeat(2001) } }],
  ])
    assert.equal(validateIvr({ ...input, menus }).valid, false)
  assert.equal(
    validateIvr({
      ...input,
      menus: [
        { ...menu, noInputAction: { kind: "submenu", menuId: "second" } },
        {
          ...menu,
          id: "second",
          failureAction: { kind: "submenu", menuId: "main" },
        },
      ],
    }).valid,
    false
  )
})
test("IVR hours reuse calling schedule, respect timezone, exclusive close, holidays and DST", () => {
  const h: IvrDefinition["businessHours"] = {
    status: "ENABLED",
    timezone_id: "America/New_York",
    weekly_operating_hours: [
      { day_of_week: "MONDAY", open_time: "0900", close_time: "1700" },
    ],
    closedAction: hangup,
  }
  assert.equal(isIvrOpen(h, Date.parse("2026-01-05T14:00:00Z")), true)
  assert.equal(isIvrOpen(h, Date.parse("2026-07-06T13:00:00Z")), true)
  assert.equal(isIvrOpen(h, Date.parse("2026-07-06T21:00:00Z")), false)
  assert.equal(
    isIvrOpen(
      {
        ...h,
        holiday_schedule: [
          { date: "2026-07-06", start_time: "0000", end_time: "0000" },
        ],
      },
      Date.parse("2026-07-06T13:00:00Z")
    ),
    false
  )
  assert.equal(isIvrOpen(undefined, Date.now()), true)
})
test("content hashes and prompt signatures bind content, renderer, call, file and expiry", async () => {
  const hash = await promptHash("Hello", "en", undefined, IVR_RENDERER)
  assert.equal(hash, await promptHash("Hello", "en", undefined, IVR_RENDERER))
  for (const args of [
    ["Hello", "hi", undefined, IVR_RENDERER],
    ["Hello", "en", "voice", IVR_RENDERER],
    ["Hi", "en", undefined, IVR_RENDERER],
    ["Hello", "en", undefined, "new"],
  ] as const)
    assert.notEqual(hash, await promptHash(args[0], args[1], args[2], args[3]))
  const secret = "s".repeat(64),
    now = Date.now(),
    expiry = now + 60_000,
    sig = await signPrompt(secret, "call", "file", expiry)
  assert.equal(
    await verifyPrompt(secret, "call", "file", expiry, sig, now),
    true
  )
  assert.equal(
    await verifyPrompt(secret, "other", "file", expiry, sig, now),
    false
  )
  assert.equal(
    await verifyPrompt(secret, "call", "other", expiry, sig, now),
    false
  )
  assert.equal(
    await verifyPrompt(secret, "call", "file", expiry, sig, expiry),
    false
  )
})
