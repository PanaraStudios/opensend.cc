import assert from "node:assert/strict"
import { test } from "node:test"
import { permissionAllows } from "./softphone"
import {
  outboundInstructions,
  callContext,
  outboundRoute,
} from "../calling/outbound"

test("expiry and denied quotas block outbound calls even when an action claims they are permitted", () => {
  for (const status of ["temporary", "granted"])
    for (const expiration of ["expiration_time", "expiration"]) {
      const data = {
        permission: { status, [expiration]: "50" },
        actions: [{ action_name: "start_call", can_perform_action: true }],
      }
      assert.equal(permissionAllows(data, "start_call", 49000), true)
      assert.equal(permissionAllows(data, "start_call", 50000), false)
    }
  assert.equal(
    permissionAllows(
      {
        permission: { status: "denied" },
        actions: [{ action_name: "start_call", can_perform_action: true }],
      },
      "start_call"
    ),
    false
  )
  assert.equal(
    permissionAllows(
      { permission: { status: "permanent", expiration_time: 1 } },
      "start_call"
    ),
    true
  )
  assert.equal(
    permissionAllows(
      {
        permission: { status: "permanent" },
        actions: [
          {
            action_name: "start_call",
            can_perform_action: false,
            limits: [{ max_allowed: 100, current_usage: 100 }],
          },
        ],
      },
      "start_call"
    ),
    false
  )
})
test("bot purpose and variables remain structured instructions and invalid payloads fail before dialing", () => {
  assert.deepEqual(outboundRoute("bot:coach"), { kind: "bot", botId: "coach" })
  assert.deepEqual(outboundRoute("ivr:followup"), {
    kind: "ivr",
    ivrId: "followup",
  })
  assert.throws(() => outboundRoute("agent:2000"))
  assert.throws(() => callContext({ variables: { name: 42 } }))
  assert.throws(() => callContext({ context: "x".repeat(4001) }))
  const prompt = outboundInstructions(
    "Coach instructions",
    "Seminar follow-up",
    { seminar: "Saturday", name: "Ada" }
  )
  assert.match(prompt, /Coach instructions/)
  assert.match(prompt, /Start with your configured greeting/)
  assert.match(prompt, /"seminar":"Saturday"/)
  assert.equal(outboundInstructions("Coach instructions"), "Coach instructions")
  assert.throws(() => outboundInstructions("x".repeat(16000), "Extra purpose"))
})

test("daily and weekly action counters fence requests and calls until their reset time", () => {
  for (const action of ["start_call", "send_call_permission_request"] as const)
    for (const max of [1, 2, 100]) {
      const data = {
        permission: { status: "permanent" },
        actions: [
          {
            action_name: action,
            can_perform_action: true,
            limits: [
              {
                max_allowed: max,
                current_usage: max,
                limit_expiration_time: 50,
              },
            ],
          },
        ],
      }
      assert.equal(permissionAllows(data, action, 49000), false)
      assert.equal(permissionAllows(data, action, 50000), true)
    }
})
