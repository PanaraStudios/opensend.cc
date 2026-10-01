import assert from "node:assert/strict"
import { test } from "node:test"
import {
  createServer,
  createConnection,
  type AddressInfo,
  type Socket,
} from "node:net"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { Resampler, PlaybackQueue, JitterBuffer } from "../src/audio.js"
import { OutboundCall } from "../src/outbound-esl.js"
import { CallStateMachine } from "../src/call-state.js"
import { FakeEchoAdapter, type SampleRate } from "../src/voice-adapter.js"

function tone(rate: number, frequency: number, ms = 1000) {
  const result = Buffer.alloc(((rate * ms) / 1000) * 2)
  for (let i = 0; i < result.length / 2; i++)
    result.writeInt16LE(
      Math.round(12000 * Math.sin((2 * Math.PI * frequency * i) / rate)),
      i * 2
    )
  return result
}
function rms(pcm: Buffer) {
  let sum = 0
  for (let i = 0; i < pcm.length; i += 2) sum += pcm.readInt16LE(i) ** 2
  return Math.sqrt(sum / (pcm.length / 2))
}

test("streaming resampling preserves duration and phase across arbitrary chunks at all six rate pairs", () => {
  const rates: SampleRate[] = [8000, 16000, 24000]
  for (const from of rates)
    for (const to of rates) {
      const pcm = tone(from, 440)
      const whole = new Resampler(from, to).push(pcm)
      const streaming = new Resampler(from, to)
      const chunks = []
      for (let i = 0; i < pcm.length; i += 74)
        chunks.push(streaming.push(pcm.subarray(i, i + 74)))
      assert.deepEqual(Buffer.concat(chunks), whole)
      assert.equal(whole.length, to * 2)
      assert.ok(rms(whole.subarray(200)) > 8000)
    }
  assert.ok(
    rms(new Resampler(24000, 8000).push(tone(24000, 9000))) < 300,
    "Downsampling must suppress out-of-band aliasing"
  )
})

test("jitter buffer reorders wrapped sequences, conceals loss, and bounds late/duplicate/foreign packets", () => {
  const jitter = new JitterBuffer()
  const packet = (n: number) => Buffer.from([n])
  jitter.push(65535, 1, packet(2))
  jitter.push(65534, 1, packet(1))
  jitter.push(0, 1, packet(3))
  jitter.push(0, 1, packet(3))
  jitter.push(1, 2, packet(99))
  jitter.push(1000, 1, packet(99))
  assert.equal(jitter.take(), undefined)
  assert.equal(jitter.take(), undefined)
  assert.deepEqual(jitter.take(), packet(1))
  assert.deepEqual(jitter.take(), packet(2))
  assert.deepEqual(jitter.take(), packet(3))
  jitter.push(2, 1, packet(4))
  assert.equal(jitter.take(), undefined)
  jitter.push(0, 1, packet(99))
  assert.deepEqual(jitter.take(), packet(4))
  assert.deepEqual(jitter.stats, { received: 4, late: 1, lost: 1, rejected: 2 })
})

test("jitter underflow conceals without permanently discarding a slower or paused sender", () => {
  const jitter = new JitterBuffer()
  jitter.push(10, 1, Buffer.from([10]))
  jitter.take()
  jitter.take()
  assert.deepEqual(jitter.take(), Buffer.from([10]))
  for (let i = 0; i < 100; i++) assert.equal(jitter.take(), undefined)
  jitter.push(11, 1, Buffer.from([11]))
  assert.deepEqual(jitter.take(), Buffer.from([11]))
  assert.equal(jitter.stats.late, 0)
})

test("barge-in counts only handed-off audio, removes partial frames and refuses late chunks of cancelled turns", () => {
  const queue = new PlaybackQueue(16000)
  queue.push(tone(24000, 880, 100), 24000, "old", 0)
  queue.markSent(queue.take()!)
  queue.markSent(queue.take()!)
  assert.deepEqual(queue.flush(), {
    playedMs: 40,
    flushedMs: 60,
    turnId: "old",
  })
  queue.push(tone(24000, 880, 20), 24000, "old", 100)
  assert.equal(queue.queuedMs, 0)
  queue.push(tone(8000, 440, 20), 8000, "new", 120)
  const frame = queue.take()!
  assert.equal(frame.turnId, "new")
  queue.markSent(frame)
  assert.equal(queue.playedMs, 20)
  const partial = new PlaybackQueue(8000)
  partial.push(Buffer.alloc(2), 8000, "partial", 0)
  partial.flush()
  partial.push(tone(8000, 440, 20), 8000, "next", 20)
  assert.equal(partial.take()!.pcm.length, 320)
})

test("state machine serializes transitions and cannot resurrect a call hung up during an effect", async () => {
  const machine = new CallStateMachine()
  let release!: () => void
  const transition = machine.transition(
    "bot",
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  await delay(0)
  machine.end()
  release()
  await transition
  assert.equal(machine.state, "hangup")
  await assert.rejects(
    machine.transition("ivr", async () => {}),
    /terminal/
  )
})

test("async/full ESL waits for application completion, supports digits/control helpers, and rejects injection", async () => {
  const uuid = randomUUID(),
    commands: string[] = []
  let peer!: Socket
  const server = createServer((socket) => {
    peer = socket
    let buffer = ""
    socket.on("data", (chunk) => {
      buffer += chunk.toString()
      while (buffer.includes("\n\n")) {
        const at = buffer.indexOf("\n\n"),
          command = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        commands.push(command)
        if (command === "connect")
          socket.write(
            `Content-Type: command/reply\nReply-Text: +OK\nUnique-ID: ${uuid}\nSocket-Mode: async\nControl: full\n\n`
          )
        else if (command.startsWith("api "))
          socket.write("Content-Type: api/response\nContent-Length: 3\n\n+OK")
        else {
          socket.write("Content-Type: command/reply\nReply-Text: +OK\n\n")
          if (command.startsWith("sendmsg")) {
            const id = command.match(/Event-UUID: (.*)/)![1]
            const body = `Event-Name: CHANNEL_EXECUTE_COMPLETE\nUnique-ID: ${uuid}\nApplication-UUID: ${id}\nvariable_voice_choice: 1\n`
            setTimeout(
              () =>
                socket.write(
                  `Content-Type: text/event-plain\nContent-Length: ${Buffer.byteLength(body)}\n\n${body}`
                ),
              20
            )
          }
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const socket = createConnection({
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
  })
  const call = new OutboundCall(socket)
  try {
    await call.connect()
    let completed = false
    const play = call.play("silence_stream://100").then(() => {
      completed = true
    })
    await delay(5)
    assert.equal(completed, false)
    await play
    assert.equal(await call.playAndGetDigits("welcome.wav", "invalid.wav"), "1")
    await call.break()
    await call.transfer("agent-route")
    await call.record("start")
    await call.record("stop")
    await call.schedHangup(5)
    assert.ok(
      commands.some(
        (command) => command === `api sched_hangup +5 ${uuid} ALLOTTED_TIMEOUT`
      )
    )
    assert.ok(commands.some((command) => command.includes("event-lock: true")))
    await assert.rejects(call.play("welcome\napi status"), /injection/)
    assert.throws(() => call.transfer("user/evil@remote"), /Invalid/)
    assert.throws(() => call.schedHangup(0), /duration/)
    peer.destroy()
    await delay(0)
  } finally {
    call.close()
    peer?.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("fake adapter emits a queued greeting, interruption, actual input echo and a tool result transcript", async () => {
  const fake = new FakeEchoAdapter(),
    audio: Buffer[] = [],
    transcripts: string[] = []
  let barge = 0,
    tool = ""
  fake.onAudio((frame) => audio.push(frame.pcm))
  fake.onBargeIn(() => {
    barge++
    fake.interrupt(40)
  })
  fake.onToolCall((call) => {
    tool = call.id
    fake.sendToolResult(call.id, { ok: true })
  })
  fake.onTranscript((transcript) => transcripts.push(transcript.text))
  await fake.start()
  const frame = {
    pcm: tone(16000, 440, 20),
    sampleRate: 16000 as const,
    timestampMs: 0,
    turnId: "caller",
  }
  for (let i = 0; i < 20; i++) fake.pushAudio(frame)
  assert.equal(barge, 1)
  assert.equal(tool, "echo-tool-1")
  assert.deepEqual(audio.at(-1), frame.pcm)
  assert.ok(transcripts.includes("interrupted:40"))
  assert.match(transcripts.at(-1)!, /ok/)
  await fake.stop()
  fake.pushAudio(frame)
  assert.equal(barge, 1)
})
