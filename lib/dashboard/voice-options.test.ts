import { test } from "node:test"
import assert from "node:assert/strict"
import { newVoiceBot, voiceBotFormPayload } from "./voice-bot-form"
import { ivrFormPayload, newIvr } from "./voice-playground"
import {
  promptStatusBadge,
  ttsLanguageItems,
  sttLanguageItems,
  SARVAM_PROMPT_LANGUAGE_ITEMS,
  voiceItems,
  voiceLanguageLabel,
} from "./voice-options"

test("provider language and voice choices round-trip through both editor payloads", () => {
  for (const language of SARVAM_PROMPT_LANGUAGE_ITEMS) {
    const draft = newIvr()
    draft.name = "Reception"
    draft.menus[0].prompt = { kind: "tts", text: "Welcome" }
    draft.promptVoice = {
      provider: "sarvam",
      credentialId: "key",
      voice: "shubh",
      language: language.value,
    }
    assert.equal(ivrFormPayload(draft).promptVoice?.language, language.value)
    assert.notEqual(language.label, language.value)
  }
  const bot = newVoiceBot("cascade")
  bot.name = "Support"
  bot.credentialId =
    bot.stt!.credentialId =
    bot.llm!.credentialId =
    bot.tts!.credentialId =
      "key"
  for (const language of ttsLanguageItems("sarvam", "bulbul:v3")) {
    bot.language = language.value
    for (const voice of voiceItems("sarvam")) {
      bot.tts!.voice = voice.value
      assert.equal(voiceBotFormPayload(bot).voice, voice.value)
    }
  }
  assert.equal(voiceLanguageLabel("en"), "English")
  assert.equal(voiceLanguageLabel("en-US"), "American English")
  assert.equal(voiceLanguageLabel("od-IN"), voiceLanguageLabel("or-IN"))
})

test("language options respect model restrictions and speech detection", () => {
  const multilingual = ttsLanguageItems("elevenlabs", "eleven_multilingual_v2")
  assert.ok(multilingual.some((item) => item.value === "en"))
  assert.ok(!multilingual.some((item) => item.value === "bn"))
  assert.ok(
    ttsLanguageItems("elevenlabs", "eleven_v3_conversational").some(
      (item) => item.value === "bn"
    )
  )
  assert.ok(sttLanguageItems("sarvam").some((item) => item.value === "auto"))
  assert.ok(sttLanguageItems("sarvam").some((item) => item.value === "hi-IN"))
  assert.ok(!sttLanguageItems("sarvam").some((item) => item.value === "fr-IN"))
})

test("prompt readiness distinguishes missing voice, rendering, success and failure", () => {
  assert.equal(promptStatusBadge("pending_render").label, "Needs a voice")
  assert.equal(promptStatusBadge("pending_render", true).label, "Rendering")
  assert.equal(promptStatusBadge("ready", true).label, "Ready")
  assert.equal(promptStatusBadge("failed", true).label, "Failed")
})
