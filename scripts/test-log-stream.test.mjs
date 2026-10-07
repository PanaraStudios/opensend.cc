import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { test } from "node:test"
import { waitForLogStream } from "./test-log-stream.mjs"

function watcher() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  let output = ""
  child.stdout.on("data", (chunk) => (output += chunk))
  // Convex's first poll returns only the requested history; later polls stream
  // every new execution. Model a slow Docker/CLI startup with a bounded replay.
  const history = []
  let connected = false
  const record = (message) => {
    const entry = {
      identifier: "http:auth",
      logLines: [{ messages: [message] }],
    }
    history.push(entry)
    if (connected) child.stdout.write(JSON.stringify(entry) + "\n")
  }
  return {
    child,
    record,
    output: () => output,
    firstPoll() {
      connected = true
      for (const entry of history.slice(-50))
        child.stdout.write(JSON.stringify(entry) + "\n")
    },
  }
}

test("waiting for the first poll prevents verification links being clipped by initial history", async () => {
  const authEmail = JSON.stringify({
    event: "auth.email",
    actionLink: "fixture-link",
  })
  const racing = watcher()
  racing.record(authEmail)
  for (let i = 0; i < 50; i++) racing.record(`query ${i}`)
  racing.firstPoll()
  assert.ok(
    !racing.output().includes("auth.email"),
    "the old spawn-then-signup sequence can lose the link"
  )

  const gated = watcher()
  const signup = waitForLogStream(gated.child).then(() =>
    gated.record(authEmail)
  )
  for (let i = 0; i < 50; i++) gated.record(`query ${i}`)
  assert.ok(!gated.output().includes("auth.email"))
  gated.firstPoll()
  await signup
  assert.ok(gated.output().includes("auth.email"))
})

test("log readiness waits for a complete JSONL entry across chunks", async () => {
  const { child } = watcher()
  let ready = false
  const waiting = waitForLogStream(child).then(() => (ready = true))
  child.stdout.write('Starting logs\n{"logLines":')
  await Promise.resolve()
  assert.equal(ready, false)
  child.stdout.write("[]}\n")
  await waiting
  assert.equal(ready, true)
  assert.equal(child.listenerCount("exit"), 0)
})

test("log readiness reports exit, child errors and startup timeout", async () => {
  const exited = watcher().child
  const exit = waitForLogStream(exited)
  exited.emit("exit", 1)
  await assert.rejects(exit, /exited before its first JSONL entry \(1\)/)
  const errored = watcher().child
  const error = waitForLogStream(errored)
  errored.emit("error", new Error("fixture spawn failed"))
  await assert.rejects(error, /fixture spawn failed/)
  await assert.rejects(
    waitForLogStream(watcher().child, 1),
    /did not receive its first JSONL entry/
  )
})
