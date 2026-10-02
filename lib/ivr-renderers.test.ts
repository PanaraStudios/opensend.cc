import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ElevenLabsPromptRenderer,
  SarvamPromptRenderer,
  PromptProviderError,
  pcmWav,
  renderWithBackoff,
} from "./ivr-renderers"
test("ElevenLabs requests raw 44.1 kHz PCM and wraps mono signed 16-bit audio in WAV", async () => {
  const request: typeof fetch = async (url, init) => {
    assert.equal(
      String(url),
      "https://api.elevenlabs.io/v1/text-to-speech/voice%2Fid?output_format=pcm_44100"
    )
    assert.equal(
      (init!.headers as Record<string, string>)["xi-api-key"],
      "secret"
    )
    assert.deepEqual(JSON.parse(init!.body as string), {
      text: "Hello",
      model_id: "eleven_multilingual_v2",
      language_code: "en",
    })
    return new Response(new Uint8Array([1, 0, 2, 0]))
  }
  const result = await new ElevenLabsPromptRenderer("secret", request).render(
    "Hello",
    "en-US",
    "voice/id"
  )
  const bytes = await result.audio.arrayBuffer(),
    view = new DataView(bytes)
  assert.equal(bytes.byteLength, 48)
  assert.equal(view.getUint32(24, true), 44100)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint16(34, true), 16)
})
test("Sarvam explicitly requests Bulbul v3 WAV and refuses a mismatched sample rate", async () => {
  const wav = new Uint8Array(
    await pcmWav(new Uint8Array([1, 0]), 24000).arrayBuffer()
  )
  const request: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://api.sarvam.ai/text-to-speech")
    assert.equal(
      (init!.headers as Record<string, string>)["api-subscription-key"],
      "secret"
    )
    assert.deepEqual(JSON.parse(init!.body as string), {
      text: "नमस्ते",
      language_code: "hi-IN",
      speaker: "shubh",
      model: "bulbul:v3",
      speech_sample_rate: 24000,
      output_audio_codec: "wav",
    })
    return Response.json({ audios: [Buffer.from(wav).toString("base64")] })
  }
  assert.equal(
    (
      await new SarvamPromptRenderer("secret", request).render(
        "नमस्ते",
        "hi-IN",
        "shubh"
      )
    ).audio.type,
    "audio/wav"
  )
  new DataView(wav.buffer).setUint32(24, 16000, true)
  await assert.rejects(
    new SarvamPromptRenderer("secret", request).render(
      "नमस्ते",
      "hi-IN",
      "shubh"
    ),
    /24 kHz/
  )
})
test("ElevenLabs lower-tier credentials fall back to 24k PCM rather than failing prompt generation", async () => {
  const urls: string[] = []
  const renderer = new ElevenLabsPromptRenderer("secret", async (url) => {
    urls.push(String(url))
    return urls.length === 1
      ? new Response("Format requires Pro", { status: 403 })
      : new Response(new Uint8Array([1, 0, 2, 0]))
  })
  const result = await renderer.render("Hello", "en-US", "voice")
  assert.ok(urls[0].endsWith("pcm_44100"))
  assert.ok(urls[1].endsWith("pcm_24000"))
  assert.equal(
    new DataView(await result.audio.arrayBuffer()).getUint32(24, true),
    24000
  )
})
test("retries are bounded with backoff and provider errors never expose keys or response bodies", async () => {
  const sleeps: number[] = []
  let calls = 0
  const renderer = new ElevenLabsPromptRenderer("secret", async () => {
    calls++
    return new Response("secret private body", { status: 429 })
  })
  await assert.rejects(
    renderWithBackoff(renderer, "hello", "en", "voice", async (ms) => {
      sleeps.push(ms)
    }),
    (e) => e instanceof PromptProviderError && !e.message.includes("secret")
  )
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [250, 1000])
  calls = 0
  await assert.rejects(
    renderWithBackoff(
      new ElevenLabsPromptRenderer("secret", async () => {
        calls++
        return new Response("secret", { status: 401 })
      }),
      "hello",
      "en",
      "voice",
      async () => undefined
    )
  )
  assert.equal(calls, 1)
})
