import { afterEach, expect, it, vi } from "vitest"
import { Opensend } from "../resend"
const client = new Opensend("os_voice", { baseUrl: "https://api.example.test" })
afterEach(() => vi.unstubAllGlobals())
it("voice resources preserve stage credentials, pagination, escaped IDs and routing", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () => Response.json({ id: "bot" }))
  vi.stubGlobal("fetch", fetch)
  await client.voiceProviders.create(
    { provider: "elevenlabs", label: "Voice", key: "write-only" },
    { idempotencyKey: "credential-once" }
  )
  expect(
    new Headers(fetch.mock.calls[0][1].headers).get("Idempotency-Key")
  ).toBe("credential-once")
  const config = {
    name: "Support",
    engine: "cascade" as const,
    provider: "sarvam" as const,
    credentialId: "sarvam",
    language: "hi-IN",
    tts: {
      provider: "elevenlabs" as const,
      model: "eleven_v4_turbo",
      credentialId: "eleven",
      voice: "voice-id",
    },
  }
  await client.voiceBots.create(config, { idempotencyKey: "bot-once" })
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(config)
  await client.voiceBots.get("bot/1")
  await client.voiceBots.update("bot/1", { maxDurationSeconds: 120 })
  await client.voiceBots.remove("bot/1")
  expect(
    fetch.mock.calls
      .slice(2, 5)
      .map(([url, init]) => [url, init?.method ?? "GET"])
  ).toEqual([
    ["https://api.example.test/voice-bots/bot%2F1", "GET"],
    ["https://api.example.test/voice-bots/bot%2F1", "PATCH"],
    ["https://api.example.test/voice-bots/bot%2F1", "DELETE"],
  ])
  await client.voiceBots.list({ after: "bot 1", limit: 7 })
  expect(new URL(fetch.mock.calls.at(-1)![0]).searchParams.get("after")).toBe(
    "bot 1"
  )
  await client.voiceProviders.list({ limit: 3 })
  await client.voiceProviders.remove("key/1")
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "https://api.example.test/voice-providers/key%2F1"
  )
  await client.whatsapp.calls.transcript("call/1", {
    after: "line 1",
    limit: 5,
  })
  const url = new URL(fetch.mock.calls.at(-1)![0])
  expect(url.pathname).toBe("/whatsapp/calls/call%2F1/transcript")
  expect(url.searchParams.get("after")).toBe("line 1")
  await client.whatsapp.phoneNumbers.patchCalling("number/1", {
    routing: { kind: "bot", botId: "bot" },
    handling_mode: "gateway",
  })
  expect(fetch.mock.calls.at(-1)![1].method).toBe("PATCH")
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).routing).toEqual({
    kind: "bot",
    botId: "bot",
  })
})
