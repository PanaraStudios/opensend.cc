import { test } from "node:test"
import assert from "node:assert/strict"
import {
  callCardTransition as step,
  emptyCallCard,
  ownsSoftphone,
} from "./call-card"
test("incoming → connecting → active → ended, without revival from stale events", () => {
  let state = step(emptyCallCard, { type: "incoming", id: "a" })
  assert.equal(state.phase, "incoming")
  state = step(state, { type: "connecting", id: "a" })
  state = step(state, { type: "connected", id: "a" })
  assert.equal(state.phase, "active")
  assert.equal(step(state, { type: "connecting", id: "a" }), state)
  assert.equal(step(state, { type: "incoming", id: "a" }).phase, "active")
  state = step(state, { type: "ended", id: "a" })
  assert.equal(state.phase, "ended")
  assert.equal(step(state, { type: "connected", id: "a" }), state)
  assert.equal(step(state, { type: "dismiss" }), emptyCallCard)
})
test("declined and missed calls remain terminal; new calls expand the pill", () => {
  for (const type of ["declined", "missed"] as const) {
    let state = step(emptyCallCard, { type: "incoming", id: "a" })
    state = step(state, { type: "minimize" })
    assert.equal(state.minimized, true)
    state = step(state, { type, id: "a" })
    assert.equal(state.phase, type)
    assert.equal(step(state, { type: "incoming", id: "a" }), state)
    state = step(state, { type: "incoming", id: "b" })
    assert.equal(state.minimized, false)
    assert.equal(step(state, { type: "ended", id: "a" }), state)
  }
})
test("only the tab with the current online lease rings or claims", () => {
  const me = {
    browserId: "tab-a",
    leaseId: "lease-a",
    status: "online" as const,
  }
  assert.equal(ownsSoftphone(true, "tab-a", "lease-a", me), true)
  assert.equal(ownsSoftphone(true, "tab-b", "lease-a", me), false)
  assert.equal(ownsSoftphone(true, "tab-a", "old-lease", me), false)
  assert.equal(ownsSoftphone(false, "tab-a", "lease-a", me), false)
  assert.equal(
    ownsSoftphone(true, "tab-a", "lease-a", { ...me, status: "away" }),
    false
  )
  assert.equal(ownsSoftphone(true, "tab-a", "lease-a", undefined), false)
})

test("failed acceptance restores controls, while a stale retry cannot revive a terminal call", () => {
  const connecting = step(emptyCallCard, { type: "connecting", id: "a" })
  assert.equal(step(connecting, { type: "retry", id: "a" }).phase, "incoming")
  const ended = step(connecting, { type: "ended", id: "a" })
  assert.equal(step(ended, { type: "retry", id: "a" }), ended)
})
