import { test } from "node:test"
import assert from "node:assert/strict"
import { EslFrames, parseHeaders } from "../src/esl.js"
import { validateRoute } from "../src/controller.js"

test("ESL parses byte lengths across fragmented and coalesced TCP frames", () => {
  const parser = new EslFrames(),
    body = "é"
  const wire = Buffer.from(
    `Content-Type: api/response\nContent-Length: ${Buffer.byteLength(body)}\n\n${body}Content-Type: command/reply\r\nReply-Text: +OK\r\n\r\n`
  )
  assert.deepEqual(parser.push(wire.subarray(0, 25)), [])
  const frames = parser.push(wire.subarray(25))
  assert.equal(frames.length, 2)
  assert.equal(frames[0].body, body)
  assert.equal(frames[1].headers["Reply-Text"], "+OK")
  assert.deepEqual(
    parseHeaders(
      "variable_opensend_call_id: wacid%3Aabc\nEvent-Name: CHANNEL_PARK\n"
    ),
    { variable_opensend_call_id: "wacid:abc", "Event-Name": "CHANNEL_PARK" }
  )
})
test("routing allows local browser agents/IVR and refuses command injection and deferred routes", () => {
  validateRoute({ callId: "x", target: "ivr", record: true })
  validateRoute({ callId: "x", target: "agent", extension: "2000" })
  for (const extension of [
    "1000",
    "sip:external.example",
    "2000,execute=hangup",
    "2000\napi status",
  ])
    assert.throws(() =>
      validateRoute({ callId: "x", target: "agent", extension })
    )
  for (const target of ["queue", "bot"] as const)
    assert.throws(() => validateRoute({ callId: "x", target }))
})
