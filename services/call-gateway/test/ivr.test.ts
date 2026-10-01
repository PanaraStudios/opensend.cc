import assert from "node:assert/strict"
import { test } from "node:test"
import {
  IvrRunner,
  digitArguments,
  cachedPrompt,
  type IvrSocket,
} from "../src/ivr-runner.js"
import type { IvrDecision } from "../src/ivr-contracts.js"
const menu = {
  id: "main",
  promptUrl: "https://backend.example/prompt.wav?signature=abc",
  timeoutSeconds: 5,
  retries: 2,
  maxDigits: 1,
  digits: ["1", "*", "#"],
}
const start: IvrDecision = {
  step: 0,
  organizationId: "team",
  action: { kind: "submenu", menuId: "main" },
  menu,
}
function socket(events: Record<string, string>[]) {
  const commands: string[] = []
  const s: IvrSocket = {
    uuid: "uuid",
    api: async (text) => {
      commands.push(text)
      return "_undef_"
    },
    execute: async (app, args) => {
      commands.push(`${app} ${args}`)
      return events.shift() ?? {}
    },
    play: async (p) => {
      commands.push(`play ${p}`)
      return {}
    },
  }
  return { s, commands }
}
test("runner prefetches, clears variables, follows submenu and hands off once", async () => {
  const f = socket([
      { variable_ivr_digits: "1" },
      { variable_ivr_digits: "#" },
    ]),
    requests: unknown[] = []
  const final: IvrDecision = {
    step: 2,
    organizationId: "team",
    action: { kind: "voicemail" },
  }
  const handoffs: IvrDecision[] = []
  const runner = new IvrRunner({
    start: async () => start,
    next: async (...args) => {
      requests.push(args.slice(0, 5))
      return requests.length === 1
        ? {
            ...start,
            step: 1,
            action: { kind: "submenu", menuId: "second" },
            menu: { ...menu, id: "second" },
          }
        : final
    },
  })
  await runner.run({
    callId: "call",
    ivrId: "ivr",
    socket: f.s,
    signal: new AbortController().signal,
    handoff: async (d) => {
      handoffs.push(d)
    },
  })
  assert.deepEqual(requests, [
    ["call", "ivr", "main", "1", 0],
    ["call", "ivr", "second", "#", 1],
  ])
  assert.deepEqual(handoffs, [final])
  assert.equal(
    f.commands.filter((c) => c.startsWith("http_prefetch")).length,
    1
  )
  assert.equal(
    f.commands.filter((c) => c === "uuid_setvar uuid ivr_digits_invalid")
      .length,
    2
  )
  assert.match(
    f.commands.find((c) => c.startsWith("play_and_get_digits"))!,
    /1 1 3 5000 none 'http_cache:\/\/https:\/\//
  )
})
test("runner distinguishes timeout and invalid digits and cancels after remote hangup", async () => {
  for (const [event, result] of [
    [{}, "timeout"],
    [{ variable_ivr_digits_invalid: "9" }, "invalid"],
    [{ variable_ivr_digits: "9" }, "invalid"],
    [{ variable_ivr_digits: "*" }, "*"],
  ] as const) {
    const f = socket([event]),
      seen: string[] = []
    const runner = new IvrRunner({
      start: async () => start,
      next: async (_c, _i, _m, d) => {
        seen.push(d)
        return { step: 1, organizationId: "team", action: { kind: "hangup" } }
      },
    })
    await runner.run({
      callId: "c",
      ivrId: "i",
      socket: f.s,
      signal: new AbortController().signal,
      handoff: async () => {},
    })
    assert.deepEqual(seen, [result])
  }
  const abort = new AbortController(),
    f = socket([])
  f.s.execute = async () => {
    abort.abort()
    return { variable_ivr_digits: "1" }
  }
  let called = false
  await new IvrRunner({
    start: async () => start,
    next: async () => {
      called = true
      return start
    },
  }).run({
    callId: "c",
    ivrId: "i",
    socket: f.s,
    signal: abort.signal,
    handoff: async () => {},
  })
  assert.equal(called, false)
})
test("wire validation rejects commands, injection, invalid menu bounds and destinations", async () => {
  for (const url of [
    "https://example.com/a\nb",
    "https://example.com/a b",
    "https://example.com/a'bad",
    "file:///etc/passwd",
    "https://user:pass@example.com/a",
  ])
    assert.throws(() => cachedPrompt(url))
  assert.throws(() => digitArguments({ ...menu, retries: 99 }))
  assert.throws(() => digitArguments({ ...menu, digits: ["1", "1"] }))
  const f = socket([])
  await assert.rejects(() =>
    new IvrRunner({
      start: async () => ({
        ...start,
        action: { kind: "agents" },
        extension: "bad;command",
      }),
      next: async () => start,
    }).run({
      callId: "c",
      ivrId: "i",
      socket: f.s,
      signal: new AbortController().signal,
      handoff: async () => {},
    })
  )
})

test("runner executes the terminal decision at the 100-step boundary", async () => {
  const f = socket([])
  f.s.execute = async () => ({ variable_ivr_digits: "1" })
  let count = 0,
    ended = false
  await new IvrRunner({
    start: async () => start,
    next: async () => {
      count++
      return count === 100
        ? { step: 100, organizationId: "team", action: { kind: "hangup" } }
        : { ...start, step: count }
    },
  }).run({
    callId: "c",
    ivrId: "i",
    socket: f.s,
    signal: new AbortController().signal,
    handoff: async () => {
      ended = true
    },
  })
  assert.equal(count, 100)
  assert.equal(ended, true)
})
