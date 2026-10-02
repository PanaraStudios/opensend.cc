import assert from "node:assert/strict"
import { test } from "node:test"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import { createHmac } from "node:crypto"
import { WebSocketServer } from "ws"
import { PipecatAdapter, sessionToken } from "../src/voice/pipecat.js"
const secret = "s".repeat(64)
const session = { callId: "call", organizationId: "team", botId: "bot" }
async function wait(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await delay(10)
  }
  throw new Error("Timed out")
}
test("Pipecat tokens bind call/team/bot with a short expiry and fresh nonce", () => {
  const [payload, signature] = sessionToken(secret, session, 1000).split(".")
  assert.equal(
    signature,
    createHmac("sha256", secret).update(payload).digest("base64url")
  )
  assert.deepEqual(
    {
      ...JSON.parse(Buffer.from(payload, "base64url").toString()),
      nonce: null,
    },
    { version: 1, ...session, expiresAt: 46000, nonce: null }
  )
  assert.notEqual(sessionToken(secret, session), sessionToken(secret, session))
  assert.throws(() => sessionToken("short", session))
})
test("Pipecat adapter bridges PCM, tools, transcripts, cancellation epochs and final summary", async () => {
  const server = createServer(),
    ws = new WebSocketServer({ server })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const received: Record<string, unknown>[] = [],
    audio: string[] = [],
    transcripts: string[] = []
  const done: string[] = [],
    observed: unknown[] = []
  let peer: import("ws").WebSocket | undefined,
    binaryBytes = 0,
    barge = 0
  ws.on("connection", (socket) => {
    peer = socket
    socket.on("message", (raw, binary) => {
      if (binary) {
        binaryBytes += raw.toString().length
        return
      }
      const message = JSON.parse(raw.toString())
      received.push(message)
      if (message.type === "start") {
        assert.equal(message.callId, "call")
        assert.ok(message.sessionToken)
        socket.send(JSON.stringify({ type: "ready" }))
      }
      if (message.type === "end")
        socket.send(
          JSON.stringify({
            type: "end",
            reason: "Call ended",
            summary: "Caller requested help",
            usage: { inputTokens: 1 },
          })
        )
    })
  })
  const adapter = new PipecatAdapter(session, {
    secret,
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
  })
  adapter.onAudio((frame) => {
    assert.equal(frame.sampleRate, 16000)
    audio.push(frame.turnId)
  })
  adapter.onPlaybackDone((turnId) => done.push(turnId))
  adapter.onToolObserved((event) => observed.push(event))
  adapter.onBargeIn(() => {
    barge++
    adapter.interrupt(40)
  })
  adapter.onTranscript((line) => transcripts.push(line.text))
  adapter.onToolCall((call) =>
    adapter.sendToolResult(call.id, {
      ok: true,
      result: { action: "end_call" },
    })
  )
  try {
    await adapter.start()
    adapter.pushAudio({
      pcm: Buffer.alloc(640),
      sampleRate: 16000,
      timestampMs: 0,
      turnId: "caller",
    })
    await wait(() => binaryBytes > 0)
    const send = (value: unknown) => peer!.send(JSON.stringify(value))
    send({ type: "mark", turnId: "old" })
    peer!.send(Buffer.alloc(640))
    await wait(() => audio.length === 1)
    send({ type: "clear", turnId: "old" })
    peer!.send(Buffer.alloc(640))
    send({ type: "mark", turnId: "old" })
    peer!.send(Buffer.alloc(640))
    await wait(() => barge === 1)
    await delay(20)
    assert.equal(audio.length, 1)
    send({ type: "mark", turnId: "new" })
    peer!.send(Buffer.alloc(640))
    await wait(() => audio.length === 2)
    assert.deepEqual(audio, ["old", "new"])
    send({ type: "playback_done", turnId: "old" })
    send({ type: "playback_done", turnId: "new" })
    send({
      type: "tool_observed",
      id: "fail-1",
      name: "transfer_to_agent",
      status: "failed",
      latencyMs: 12,
      error: "No agent available",
    })
    await wait(() => done.length === 1 && observed.length === 1)
    assert.deepEqual(done, ["new"])
    assert.deepEqual(observed[0], {
      type: "tool_call",
      toolId: "fail-1",
      toolName: "transfer_to_agent",
      status: "failed",
      latencyMs: 12,
      error: "No agent available",
    })
    send({
      type: "transcript",
      role: "caller",
      text: "hello",
      final: true,
      timestampMs: 100,
    })
    send({ type: "tool_call", id: "end-1", name: "end_call", arguments: {} })
    await wait(() => received.some((m) => m.type === "tool_result"))
    assert.deepEqual(transcripts, ["hello"])
    assert.ok(received.some((m) => m.type === "played_ms" && m.playedMs === 40))
    assert.equal(await adapter.summarize(""), "Caller requested help")
    assert.deepEqual(adapter.usage, { inputTokens: 1 })
  } finally {
    await adapter.stop()
    for (const socket of ws.clients) socket.terminate()
    await new Promise<void>((resolve) => ws.close(() => resolve()))
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
