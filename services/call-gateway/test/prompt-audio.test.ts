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

test("WAV, MP3 and OGG uploads become 48 kHz mono PCM16 with preserved duration", async () => {
  for (const format of ["wav", "mp3", "ogg"]) {
    const wav = await normalizePrompt(encoded(format))
    assert.equal(wav.toString("ascii", 0, 4), "RIFF")
    assert.equal(wav.readUInt32LE(4), wav.length - 8)
    assert.equal(wav.readUInt16LE(20), 1)
    assert.equal(wav.readUInt16LE(22), 1)
    assert.equal(wav.readUInt32LE(24), 48000)
    assert.equal(wav.readUInt16LE(34), 16)
    assert.ok(wav.length > 23000 && wav.length < 30000)
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
