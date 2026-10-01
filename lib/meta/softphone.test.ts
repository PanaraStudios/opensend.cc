import { agentQueues } from "../../services/call-gateway/src/queues"
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  callElapsed,
  callEventLabel,
  callTimer,
  isDtmf,
  permissionAllows,
  softphoneTransition as step,
  type SoftphonePhase,
} from "./softphone"
test("registration, claim, connect, hold, resume and hangup obey the softphone lifecycle", () => {
  let phase: SoftphonePhase = "away"
  for (const [event, expected] of [
    ["online", "registering"],
    ["registered", "idle"],
    ["incoming", "ringing"],
    ["answer", "claiming"],
    ["claimed", "connecting"],
    ["connected", "active"],
    ["hold", "held"],
    ["resume", "active"],
    ["hangup", "ending"],
    ["ended", "idle"],
  ] as const) {
    phase = step(phase, event)
    assert.equal(phase, expected)
  }
})
test("stale UI events cannot answer twice or revive a hung-up call", () => {
  assert.equal(step("active", "answer"), "active")
  assert.equal(step("ending", "connected"), "ending")
  assert.equal(step("away", "incoming"), "away")
  assert.equal(step("idle", "hold"), "idle")
  assert.equal(step("idle", "connected"), "active") // transferred browser leg
  assert.equal(step("connecting", "ended"), "idle")
  assert.equal(step("claiming", "fail"), "error")
  assert.equal(step("error", "online"), "registering")
  assert.equal(step("held", "away"), "away")
})
test("timer and thread call labels handle missing time, future time and missed calls", () => {
  assert.equal(callElapsed(null, 1234), 0)
  assert.equal(callElapsed(5000, 1000), 0)
  assert.equal(callElapsed(1000, 39999), 38)
  assert.equal(callTimer(123), "2:03")
  assert.equal(callTimer(-12), "0:00")
  assert.equal(callEventLabel("completed", 38), "Voice call 38 sec")
  assert.equal(callEventLabel("missed", 0), "Missed voice call")
  assert.equal(callEventLabel("ringing"), "Voice call")
})
test("Meta action denial overrides granted permission, both permission vocabularies work, expiry is checked", () => {
  const granted = { permission: { status: "granted" } }
  assert.equal(permissionAllows(granted, "start_call"), true)
  assert.equal(
    permissionAllows(
      {
        ...granted,
        actions: [{ action_name: "start_call", can_perform_action: false }],
      },
      "start_call"
    ),
    false
  )
  for (const status of ["temporary", "permanent"])
    assert.equal(
      permissionAllows({ permission: { status } }, "start_call"),
      true
    )
  for (const status of ["pending", "denied", "expired", "no_permission"])
    assert.equal(
      permissionAllows({ permission: { status } }, "start_call"),
      false
    )
  assert.equal(
    permissionAllows(
      { permission: { status: "temporary", expiration_time: 50 } },
      "start_call",
      50001
    ),
    false
  )
  assert.equal(permissionAllows({}, "send_call_permission_request"), false)
  assert.equal(
    permissionAllows(
      {
        actions: [
          {
            action_name: "send_call_permission_request",
            can_perform_action: true,
          },
        ],
      },
      "send_call_permission_request"
    ),
    true
  )
})
test("DTMF only accepts one telephone digit", () => {
  for (const digit of "1234567890*#") assert.equal(isDtmf(digit), true)
  for (const digit of ["", "12", "a", "\n"]) assert.equal(isDtmf(digit), false)
})

test("queue choices are scoped to the team and reject unsafe or malformed operator configuration", () => {
  const config = JSON.stringify({
    "team-a": ["support", "support", "bad;api status"],
    "team-b": ["sales"],
  })
  assert.deepEqual(agentQueues(config, "team-a"), ["support"])
  assert.deepEqual(agentQueues(config, "team-b"), ["sales"])
  assert.deepEqual(agentQueues(config, "team-c"), [])
  assert.deepEqual(agentQueues("broken", "team-a"), [])
  assert.deepEqual(agentQueues(config, "team-a;api status"), [])
})
