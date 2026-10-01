import assert from "node:assert/strict"
import { test } from "node:test"
import {
  validateBot,
  validateTool,
  sarvamLanguage,
  toolDeclarations,
} from "./voice-bots"
test("shared voice catalog applies defaults, limits languages and maps Odia per endpoint", () => {
  const input = {
    name: "Support",
    credentialId: "credential",
    provider: "sarvam",
    engine: "cascade",
    tts: {
      provider: "sarvam",
      model: "bulbul:v3",
      credentialId: "credential",
      voice: "shubh",
    },
  }
  const bot = validateBot(input)
  assert.equal(bot.model, "sarvam-105b-conversations")
  assert.equal(bot.stt?.model, "saaras:v4")
  assert.equal(bot.tts?.model, "bulbul:v3")
  assert.equal(bot.maxDurationSeconds, 600)
  assert.equal(validateBot({ ...input, language: "od-IN" }).language, "or-IN")
  assert.equal(sarvamLanguage("or-IN", "tts"), "od-IN")
  for (const patch of [
    { language: "fr-FR" },
    { maxConcurrentCalls: 0 },
    { monthlyMinuteBudget: NaN },
    { tools: ["create_task"] },
    { handoff: { agents: true, extension: "evil" } },
  ])
    assert.throws(() => validateBot({ ...input, ...patch }))
  assert.equal(
    validateBot({ ...input, language: "auto" }).stt?.language,
    "auto"
  )
  assert.equal(validateBot({ ...input, language: "auto" }).language, "en-IN")
  const eleven = validateBot({
    ...input,
    tts: {
      provider: "elevenlabs",
      model: "eleven_flash_v2_5",
      credentialId: "eleven",
      voice: "voice-id",
    },
  })
  assert.equal(eleven.tts?.provider, "elevenlabs")
  assert.throws(() =>
    validateBot({
      ...input,
      language: "gu-IN",
      tts: {
        provider: "elevenlabs",
        credentialId: "eleven",
        model: "eleven_flash_v2_5",
        voice: "voice-id",
      },
    })
  )
  assert.equal(
    validateBot({
      ...input,
      language: "or-IN",
      tts: {
        provider: "elevenlabs",
        credentialId: "eleven",
        voice: "voice-id",
      },
    }).tts?.model,
    "eleven_v4_turbo"
  )
  assert.deepEqual(
    toolDeclarations(["lookup_contact"])[0].parameters.properties,
    {}
  )
})
test("tool arguments never select authority or destinations", () => {
  for (const [name, arguments_] of [
    ["lookup_contact", { query: "another-team" }],
    ["send_whatsapp_message", { text: "hi", contactId: "other" }],
    ["transfer_to_agent", { extension: "2001" }],
    ["transfer_to_ivr", { ivrId: "arbitrary" }],
    ["create_note", { text: 1 }],
  ] as const)
    assert.throws(() =>
      validateTool({ id: "tool-1", name, arguments: arguments_ })
    )
  assert.doesNotThrow(() =>
    validateTool({
      id: "tool-1",
      name: "create_note",
      arguments: { text: "Support requested" },
    })
  )
})
