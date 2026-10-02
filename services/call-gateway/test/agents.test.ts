import { test } from "node:test"
import assert from "node:assert/strict"
import { AgentSessions, directoryAuthorized } from "../src/agents.js"
test("session passwords are isolated, expire, and slots are quarantined beyond registration expiry", () => {
  let now = 1000
  const sessions = new AgentSessions(() => now)
  const first = sessions.issue("team-a-session"),
    second = sessions.issue("team-b-session")
  assert.notEqual(first.extension, second.extension)
  assert.notEqual(first.password, second.password)
  assert.equal(sessions.issue("team-a-session").password, first.password)
  assert.match(
    sessions.directory(first.extension, "a".repeat(64)),
    new RegExp(first.password)
  )
  assert.match(
    sessions.directory(first.extension, "a".repeat(64)),
    /softphone-deny/
  )
  sessions.revoke("team-a-session")
  assert.match(sessions.directory(first.extension, "a".repeat(64)), /not found/)
  const third = sessions.issue("team-c-session")
  assert.notEqual(third.extension, first.extension)
  now += 120001
  assert.equal(sessions.active(second.extension), false)
  assert.match(
    sessions.directory(second.extension, "a".repeat(64)),
    /not found/
  )
  assert.match(sessions.directory("1000", "a".repeat(64)), /calling/)
  assert.match(sessions.directory('2000"/>', "a".repeat(64)), /not found/)
})
test("directory requires its separate Basic credential and rejects disabled configuration", () => {
  const secret = "b".repeat(64)
  assert.equal(
    directoryAuthorized(
      `Basic ${Buffer.from(`directory:${secret}`).toString("base64")}`,
      secret
    ),
    true
  )
  assert.equal(directoryAuthorized("Basic bad", secret), false)
  assert.equal(directoryAuthorized(undefined, secret), false)
  assert.equal(directoryAuthorized("", ""), false)
})
test("all 100 agent slots are bounded independently of Janus media slots", () => {
  const sessions = new AgentSessions()
  for (let i = 0; i < 100; i++)
    assert.match(sessions.issue(`session-${i}`).extension, /^20\d{2}$/)
  assert.throws(() => sessions.issue("overflow"), /All browser agent slots/)
})
