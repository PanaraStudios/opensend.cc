import {
  ELEVENLABS_STT_LANGUAGES,
  GEMINI_LANGUAGE_PREFIXES,
  SARVAM_LANGUAGES,
  validateBot,
  type VoiceProvider,
  type VoiceToolName,
} from "../voice-bots"
import { SARVAM_PROMPT_VOICES } from "../ivr-renderers"

export const VOICE_PROVIDER_LABELS: Record<VoiceProvider, string> = {
  gemini: "Gemini",
  sarvam: "Sarvam",
  elevenlabs: "ElevenLabs",
}
export const VOICE_TOOL_LABELS: Record<VoiceToolName, string> = {
  lookup_contact: "Look up contact",
  create_note: "Add call note",
  send_whatsapp_message: "Send WhatsApp message",
  transfer_to_agent: "Transfer to agent",
  transfer_to_ivr: "Transfer to IVR",
  end_call: "End call",
}
// https://ai.google.dev/gemini-api/docs/live-api/capabilities#change-voice-and-language
export const GEMINI_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
] as const
export function voiceItems(provider: VoiceProvider) {
  if (provider === "elevenlabs")
    return [
      { value: "21m00Tcm4TlvDq8ikWAM", label: "Rachel" },
      { value: "EXAVITQu4vr4xnSDxMaL", label: "Sarah" },
      { value: "pNInz6obpgDQGcFmaJgB", label: "Adam" },
    ]
  return (
    provider === "gemini"
      ? GEMINI_VOICES
      : provider === "sarvam"
        ? SARVAM_PROMPT_VOICES
        : []
  ).map((value) => ({
    value,
    label: value[0].toUpperCase() + value.slice(1),
  }))
}
const languageNames = new Intl.DisplayNames(["en"], { type: "language" })
export function voiceLanguageLabel(value: string) {
  if (value === "auto") return "Detect automatically"
  try {
    // Sarvam's prompt API uses od-IN for Odia; Intl uses or-IN.
    return (
      languageNames.of(value === "od-IN" ? "or-IN" : value) ??
      "Unknown language"
    )
  } catch {
    return "Unknown language"
  }
}
export function languageItems(values: readonly string[]) {
  return values
    .map((value) => ({ value, label: voiceLanguageLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
export const VOICE_LANGUAGE_ITEMS = languageItems([
  ...GEMINI_LANGUAGE_PREFIXES,
  "en-US",
  "en-IN",
  "en-GB",
])
export const SARVAM_LANGUAGE_ITEMS = languageItems(SARVAM_LANGUAGES)
export const SARVAM_PROMPT_LANGUAGE_ITEMS = languageItems(
  SARVAM_LANGUAGES.map((value) => (value === "or-IN" ? "od-IN" : value))
)
// Filter the shared catalog through the API validator so model restrictions
// have one source of truth, including ElevenLabs' different TTS models.
export function ttsLanguageItems(
  provider: "sarvam" | "elevenlabs",
  model: string
) {
  if (provider === "sarvam") return SARVAM_LANGUAGE_ITEMS
  return languageItems(
    ELEVENLABS_STT_LANGUAGES.filter((language) => {
      try {
        validateBot({
          name: "Language options",
          engine: "cascade",
          provider: "sarvam",
          credentialId: "options",
          language,
          stt: {
            provider: "elevenlabs",
            model: "scribe_v2_realtime",
            credentialId: "options",
            language: "auto",
          },
          tts: { provider, model, credentialId: "options", voice: "options" },
        })
        return true
      } catch {
        return false
      }
    })
  )
}
export function sttLanguageItems(provider: VoiceProvider) {
  // Validate candidates using the shared STT rules (which support more Indian
  // languages than TTS) rather than maintaining a second provider allowlist.
  const candidates =
    provider === "elevenlabs"
      ? ELEVENLABS_STT_LANGUAGES
      : [
          ...new Set([
            ...SARVAM_LANGUAGES,
            ...ELEVENLABS_STT_LANGUAGES.map((v) => `${v}-IN`),
          ]),
        ]
  return [
    { value: "auto", label: "Detect automatically" },
    ...languageItems(
      candidates.filter((language) => {
        try {
          validateBot({
            name: "Language options",
            engine: "cascade",
            provider: "sarvam",
            credentialId: "options",
            stt: { provider, credentialId: "options", language },
            tts: {
              provider: "sarvam",
              credentialId: "options",
              voice: "shubh",
            },
          })
          return true
        } catch {
          return false
        }
      })
    ),
  ]
}
export function promptStatusBadge(status: string, hasVoice = false) {
  switch (status) {
    case "ready":
      return { tone: "success", label: "Ready" } as const
    case "failed":
      return { tone: "destructive", label: "Failed" } as const
    case "rendering":
      return { tone: "warning", label: "Rendering" } as const
    case "pending_render":
      return {
        tone: "warning",
        label: hasVoice ? "Rendering" : "Needs a voice",
      } as const
    default:
      return { tone: "secondary", label: "Unknown" } as const
  }
}

export function voiceModelLabel(value: string) {
  return value
    .replace(/^gemini-/, "Gemini ")
    .replace(/^sarvam-/, "Sarvam ")
    .replace(/^eleven_/, "ElevenLabs ")
    .replace(/^scribe_/, "Scribe ")
    .replace(/^saaras:/, "Saaras ")
    .replace(/^bulbul:/, "Bulbul ")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
}
