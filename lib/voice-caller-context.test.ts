import assert from "node:assert/strict"
import { test } from "node:test"
import {
  CALLER_CONTEXT_HEADER,
  CALLER_CONTEXT_LIMIT,
  CallerContextTimeout,
  assembleCallerContext,
  callerContextEnabled,
  formatCallerContext,
  type CallerLookup,
} from "./voice-caller-context"

const known: CallerLookup = {
  found: true,
  name: "Ada",
  email: null,
  phone: "+15555550123",
  properties: { plan: "Pro" },
  tags: ["VIP"],
  channelIdentities: [
    {
      channel: "whatsapp",
      externalId: "15555550123",
      scopeId: "whatsapp",
      phone: "+15555550123",
      userId: "US.caller",
      parentUserId: null,
      username: null,
      profileName: null,
    },
  ],
  recentMessageSummary: "Customer (2h ago): Yes please",
}

test("caller lookup defaults on and can be turned off", () => {
  assert.equal(callerContextEnabled(undefined), true)
  assert.equal(callerContextEnabled(true), true)
  assert.equal(callerContextEnabled(false), false)
})

test("known callers are quoted from the lookup and unknown callers are not invented", () => {
  const block = formatCallerContext(known)
  assert.ok(block.startsWith(CALLER_CONTEXT_HEADER))
  assert.match(block, /name: Ada/)
  assert.match(block, /phone: \+15555550123/)
  assert.match(block, /plan/)
  assert.match(block, /VIP/)
  assert.match(block, /Yes please/)
  assert.equal(block.includes("email:"), false)
  assert.equal(
    formatCallerContext({ found: false, phone: "+15555550123" }),
    `${CALLER_CONTEXT_HEADER} Caller not found in CRM; phone +15555550123`
  )
  assert.equal(
    formatCallerContext({ found: false, phone: null }),
    `${CALLER_CONTEXT_HEADER} Caller not found in CRM; phone unknown`
  )
  assert.equal(
    formatCallerContext({ found: false, phone: "   " }),
    `${CALLER_CONTEXT_HEADER} Caller not found in CRM; phone unknown`
  )
})

test("caller context is capped at 2000 characters", () => {
  const block = formatCallerContext({
    ...known,
    properties: { note: "n".repeat(5000) },
  })
  assert.equal(block.length, CALLER_CONTEXT_LIMIT)
  assert.ok(block.startsWith(CALLER_CONTEXT_HEADER))
  assert.equal(block.includes("n".repeat(5000)), false)
})

test("a late or failed lookup starts the session without caller context", async () => {
  let now = 0
  const reasons: string[] = []
  const late = await assembleCallerContext(
    async () => {
      now = 5_000
      return { found: false, phone: "+15555550123" }
    },
    {
      now: () => now,
      onDiagnostic: (reason) => reasons.push(reason),
    }
  )
  assert.equal(late, undefined)
  assert.deepEqual(reasons, ["timeout"])
  reasons.length = 0
  const failed = await assembleCallerContext(
    async () => {
      throw new Error("database unavailable")
    },
    { onDiagnostic: (reason) => reasons.push(reason) }
  )
  assert.equal(failed, undefined)
  assert.deepEqual(reasons, ["failed"])
  reasons.length = 0
  const timedOut = await assembleCallerContext(
    async () => {
      throw new CallerContextTimeout()
    },
    { onDiagnostic: (reason) => reasons.push(reason) }
  )
  assert.equal(timedOut, undefined)
  assert.deepEqual(reasons, ["timeout"])
  const ready = await assembleCallerContext(async () => known)
  assert.match(ready ?? "", /name: Ada/)
})
