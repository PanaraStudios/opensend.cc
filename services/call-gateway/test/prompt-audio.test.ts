import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { normalizePrompt, PROMPT_BYTES } from "../src/prompt-audio.js"
import { createGatewayServer } from "../src/server.js"
import { CallGatewayClient } from "../src/client.js"
import type { GatewayApi } from "../src/contracts.js"
import type { AddressInfo } from "node:net"

function encoded(format: string, rate = 44100) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=6000:sample_rate=${rate}:duration=0.25`,
    "-ac",
    "2",
    "-f",
    format,
    "pipe:1",
  ])
  assert.equal(
    result.status,
    0,
    "ffmpeg is required for prompt conversion tests"
  )
  return result.stdout
}

test("WAV, MP3 and OGG uploads become 16 kHz mono PCM16 with preserved duration", async () => {
  for (const format of ["wav", "mp3", "ogg"]) {
    const wav = await normalizePrompt(encoded(format))
    assert.equal(wav.toString("ascii", 0, 4), "RIFF")
    assert.equal(wav.readUInt32LE(4), wav.length - 8)
    assert.equal(wav.readUInt16LE(20), 1)
    assert.equal(wav.readUInt16LE(22), 1)
    assert.equal(wav.readUInt32LE(24), 16000)
    assert.equal(wav.readUInt16LE(34), 16)
    assert.ok(wav.length > 7500 && wav.length < 10000)
  }
  await assert.rejects(
    normalizePrompt(Buffer.from("#EXTM3U\nfile:///etc/passwd"))
  )
  await assert.rejects(normalizePrompt(Buffer.from("RIFFbroken")))
  await assert.rejects(normalizePrompt(Buffer.alloc(PROMPT_BYTES + 1)))
})

test("converter authenticates signed requests and does not accept unsigned audio", async () => {
  const server = createGatewayServer({} as GatewayApi, "s".repeat(64))
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const denied = await fetch(`${url}/prompts/normalize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"audio":"UklGRg=="}',
    })
    assert.equal(denied.status, 401)
    const client = new CallGatewayClient(url, "s".repeat(64))
    const result = await client.normalizePrompt(
      new Blob([new Uint8Array(encoded("wav", 24000))])
    )
    assert.equal(result.type, "audio/wav")
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
})

test("normalization controls hot source loudness/peaks and filters above the 16k Nyquist limit", async () => {
  const generated = spawnSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.65*sin(2*PI*1000*t)+0.3*sin(2*PI*12000*t):s=44100:d=2",
    "-f",
    "wav",
    "pipe:1",
  ])
  assert.equal(generated.status, 0)
  const wav = await normalizePrompt(generated.stdout)
  let peak = 0
  for (let at = 44; at < wav.length; at += 2)
    peak = Math.max(peak, Math.abs(wav.readInt16LE(at)))
  assert.ok(peak < 32768 * 10 ** (-1.8 / 20), `Peak too hot: ${peak}`)
  const measured = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      "pipe:0",
      "-af",
      "loudnorm=I=-18:TP=-2:LRA=11:print_format=json",
      "-f",
      "null",
      "-",
    ],
    { input: wav }
  )
  assert.equal(measured.status, 0)
  const loudness = JSON.parse(
    measured.stderr.toString().match(/\{[\s\S]*\}/)![0]
  )
  assert.ok(
    Math.abs(Number(loudness.input_i) + 18) < 1,
    `Loudness: ${loudness.input_i}`
  )
  const power = (hz: number) => {
    let real = 0,
      imaginary = 0
    const count = (wav.length - 44) / 2
    for (let n = 500; n < count - 500; n++) {
      const value = wav.readInt16LE(44 + n * 2)
      real += value * Math.cos((2 * Math.PI * hz * n) / 16000)
      imaginary += value * Math.sin((2 * Math.PI * hz * n) / 16000)
    }
    return real ** 2 + imaginary ** 2
  }
  assert.ok(power(4000) < power(1000) * 0.0001, "12k source aliased into 4k")
})
