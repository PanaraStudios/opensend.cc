import assert from "node:assert/strict"
import { test } from "node:test"
import { VOICE_CATALOG } from "../services/call-gateway/src/voice/voices"
import {
  ELEVENLABS_FALLBACK_VOICE_ID,
  ELEVENLABS_VOICE_CACHE_MS,
  defaultElevenLabsVoice,
  elevenLabsVoiceDetail,
  fetchElevenLabsVoices,
  formatProviderError,
  loadElevenLabsVoiceCatalog,
  mapElevenLabsVoice,
  voiceCacheFresh,
} from "./elevenlabs-voices"

const secret = "sk_fixture_not_a_real_key_000000"
function page(
  voices: unknown[],
  next?: string | null
): { voices: unknown[]; has_more: boolean; next_page_token?: string | null } {
  return {
    voices,
    has_more: !!next,
    next_page_token: next,
  }
}
const bella = {
  voice_id: "bellaVoiceId00000001",
  name: "Bella",
  category: "premade",
  labels: { gender: "Female", accent: "American", language: "en" },
  description: "Clear and warm",
}
const adam = {
  voice_id: "adamVoiceId000000001",
  name: "Adam",
  category: "premade",
  labels: { gender: "male", accent: "American" },
}

test("maps ElevenLabs voices and skips rows without an id", () => {
  const mapped = mapElevenLabsVoice(bella)
  assert.deepEqual(mapped, {
    value: "bellaVoiceId00000001",
    label: "Bella",
    gender: "female",
    accent: "American",
    language: "en",
    description: "Clear and warm",
    category: "premade",
  })
  assert.equal(mapElevenLabsVoice({ name: "No id" }), null)
  assert.equal(mapElevenLabsVoice({ voice_id: "x y" })?.value, undefined)
  const unknown = mapElevenLabsVoice({
    voice_id: "clone1",
    name: "  ",
    category: "workshop",
    labels: { description: "A private clone" },
  })
  assert.equal(unknown?.label, "Unnamed voice")
  assert.equal(unknown?.gender, "unknown")
  assert.equal(unknown?.category, "unknown")
  assert.equal(unknown?.description, "A private clone")
  assert.equal(
    elevenLabsVoiceDetail(mapped!),
    "Female · American · en · Premade"
  )
})

test("paginates with next_page_token and stops at the page cap", async () => {
  const urls: string[] = []
  const request: typeof fetch = async (url, init) => {
    const href = String(url)
    urls.push(href)
    assert.equal(
      (init?.headers as Record<string, string>)["xi-api-key"],
      secret
    )
    assert.equal(href.includes(secret), false)
    const token = new URL(href).searchParams.get("next_page_token")
    assert.equal(new URL(href).searchParams.get("page_size"), "2")
    assert.equal(new URL(href).searchParams.get("include_total_count"), "false")
    if (!token)
      return Response.json(
        page(
          [bella, adam, { voice_id: bella.voice_id, name: "Duplicate" }],
          "two"
        )
      )
    if (token === "two")
      return Response.json(
        page(
          [
            {
              voice_id: "cloneVoiceId0000001",
              name: "Mina",
              category: "cloned",
              labels: { gender: "female", accent: "British" },
            },
          ],
          "three"
        )
      )
    return Response.json(
      page([{ voice_id: "later", name: "Later", category: "premade" }])
    )
  }
  const result = await fetchElevenLabsVoices(request, secret, {
    pageSize: 2,
    maxPages: 2,
  })
  assert.equal(urls.length, 2)
  assert.deepEqual(
    result.voices.map((voice) => voice.value),
    ["bellaVoiceId00000001", "adamVoiceId000000001", "cloneVoiceId0000001"]
  )
  assert.equal(result.hasMore, true)
})

test("a rejected voice list keeps the provider message and drops the key", async () => {
  const request: typeof fetch = async () =>
    Response.json(
      {
        detail: {
          status: "voice_not_found",
          message: `A voice with the voice_id abc was not found. ${secret}`,
        },
      },
      { status: 400 }
    )
  await assert.rejects(
    fetchElevenLabsVoices(request, secret),
    (error) =>
      error instanceof Error &&
      error.message ===
        "ElevenLabs: voice_not_found — A voice with the voice_id abc was not found. [redacted]" &&
      !error.message.includes(secret)
  )
  const sarvam = formatProviderError(
    "Sarvam",
    422,
    JSON.stringify({
      error: { code: "invalid_speaker", message: "Unknown speaker" },
    }),
    [secret]
  )
  assert.equal(sarvam, "Sarvam: invalid_speaker — Unknown speaker")
  const huge = formatProviderError(
    "ElevenLabs",
    500,
    "Voice failed. ".repeat(40),
    []
  )
  assert.equal(huge.length, 200)
  assert.equal(huge.endsWith("…"), true)
  const voiceId = "bellaVoiceId00000001"
  const redacted = formatProviderError(
    "ElevenLabs",
    400,
    `voice ${voiceId} token ${"a".repeat(40)}`,
    []
  )
  assert.equal(redacted.includes(voiceId), true)
  assert.equal(redacted.includes("a".repeat(40)), false)
  assert.equal(
    formatProviderError("ElevenLabs", 401, "not-json", []).includes("not-json"),
    true
  )
})

test("a fresh catalog is reused until it expires or a refresh is forced", async () => {
  let calls = 0
  const request: typeof fetch = async () => {
    calls++
    return Response.json(page([bella]))
  }
  const first = await loadElevenLabsVoiceCatalog({
    request,
    apiKey: secret,
    now: 1_000,
  })
  assert.equal(calls, 1)
  assert.equal(first.fromCache, false)
  assert.equal(voiceCacheFresh(first.refreshedAt, 1_000 + 60_000), true)
  const cached = await loadElevenLabsVoiceCatalog({
    request,
    apiKey: secret,
    now: 1_000 + 60_000,
    cache: first,
  })
  assert.equal(calls, 1)
  assert.equal(cached.fromCache, true)
  assert.equal(cached.voices[0]?.label, "Bella")
  await loadElevenLabsVoiceCatalog({
    request,
    apiKey: secret,
    now: first.refreshedAt + ELEVENLABS_VOICE_CACHE_MS,
    cache: first,
  })
  assert.equal(calls, 2)
  await loadElevenLabsVoiceCatalog({
    request,
    apiKey: secret,
    now: 2_000,
    force: true,
    cache: first,
  })
  assert.equal(calls, 3)
})

test("the default ElevenLabs voice is the first female premade, otherwise Sarah", () => {
  assert.equal(
    defaultElevenLabsVoice([
      { value: "male", gender: "male", category: "premade" },
      { value: "clone", gender: "female", category: "cloned" },
      { value: "bella", gender: "female", category: "premade" },
      { value: "later", gender: "female", category: "premade" },
    ]),
    "bella"
  )
  assert.equal(defaultElevenLabsVoice([]), ELEVENLABS_FALLBACK_VOICE_ID)
  assert.equal(ELEVENLABS_FALLBACK_VOICE_ID, "EXAVITQu4vr4xnSDxMaL")
  const catalogIds: string[] = VOICE_CATALOG.elevenlabs.map(
    (voice) => voice.value
  )
  const catalogLabels: string[] = VOICE_CATALOG.elevenlabs.map(
    (voice) => voice.label
  )
  assert.equal(catalogIds.includes("21m00Tcm4TlvDq8ikWAM"), false)
  assert.equal(catalogLabels.includes("Rachel"), false)
})
