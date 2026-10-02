import {
  validateBot,
  type VoiceBotConfig,
  type VoiceEngine,
} from "../voice-bots"
import { voiceBotDefaults } from "../voice-bot-defaults"
export function newVoiceBot(
  engine: VoiceEngine = "gemini_live",
  language = engine === "gemini_live" ? "en-US" : "en-IN"
): VoiceBotConfig {
  const config = validateBot({
    name: "New bot",
    engine,
    provider: engine === "gemini_live" ? "gemini" : "sarvam",
    credentialId: "unset",
    language,
    ...voiceBotDefaults(language, engine === "gemini_live" ? "female" : "male"),
    ...(engine === "cascade"
      ? {
          tts: {
            provider: "sarvam",
            model: "bulbul:v3",
            credentialId: "unset",
            voice: "shubh",
          },
        }
      : {}),
  })
  return {
    ...config,
    name: "",
    credentialId: "",
    ...(config.stt ? { stt: { ...config.stt, credentialId: "" } } : {}),
    ...(config.llm ? { llm: { ...config.llm, credentialId: "" } } : {}),
    ...(config.tts ? { tts: { ...config.tts, credentialId: "" } } : {}),
  }
}
/** Explicit whitelist prevents resource metadata from becoming saved config. */
export function voiceBotFormPayload(value: VoiceBotConfig): VoiceBotConfig {
  const {
    name,
    engine,
    provider,
    credentialId,
    model,
    voice,
    language,
    systemPrompt,
    greeting,
    disclosure,
    tools,
    handoff,
    maxDurationSeconds,
    silenceTimeoutSeconds,
    recording,
    monthlyMinuteBudget,
    maxConcurrentCalls,
    stt,
    llm,
    tts,
  } = value
  return validateBot({
    name,
    engine,
    provider,
    credentialId,
    model,
    voice,
    language,
    systemPrompt,
    greeting,
    disclosure,
    tools,
    handoff,
    maxDurationSeconds,
    silenceTimeoutSeconds,
    recording,
    ...(monthlyMinuteBudget !== undefined ? { monthlyMinuteBudget } : {}),
    ...(maxConcurrentCalls !== undefined ? { maxConcurrentCalls } : {}),
    ...(engine === "cascade" ? { stt, llm, tts } : {}),
  })
}
export type VoiceProviderResource = {
  id: string
  provider: "gemini" | "sarvam" | "elevenlabs"
  label: string
  lastFour: string
  createdAt: number
  updatedAt: number
}
export type VoiceBotResource = VoiceBotConfig & {
  lastTestAt?: number | null
  id: string
  createdAt: number
  updatedAt: number
}

export function voiceDiagnostic(line: { kind: string; text?: string }) {
  if (line.kind !== "media" || !line.text) return null
  try {
    const v: unknown = JSON.parse(line.text)
    if (!v || typeof v !== "object" || !("type" in v)) return null
    if (
      v.type === "latency" &&
      "latencyMs" in v &&
      typeof v.latencyMs === "number"
    )
      return {
        label: "Turn latency",
        detail: `${v.latencyMs} ms${"turnId" in v && typeof v.turnId === "string" ? ` · ${v.turnId}` : ""}`,
      }
    if (
      v.type === "barge_in" &&
      "playedMs" in v &&
      typeof v.playedMs === "number"
    )
      return {
        label: "Interrupted",
        detail: `Caller interrupted after ${v.playedMs} ms of playback`,
      }
    if (v.type === "hangup" && "reason" in v && typeof v.reason === "string")
      return { label: "Call ended", detail: v.reason }
    if (v.type === "tool_call" && "toolName" in v && "status" in v)
      return {
        label: "Tool call",
        detail: `${String(v.toolName)} · ${String(v.status)}${"latencyMs" in v && typeof v.latencyMs === "number" ? ` · ${v.latencyMs} ms` : ""}`,
      }
    if (v.type === "bot_completed")
      return {
        label: "Bot finished",
        detail: "See the final outcome and summary above.",
      }
    if (v.type === "usage")
      return {
        label: "Usage updated",
        detail: "Provider usage is shown above.",
      }
    return { label: String(v.type), detail: line.text }
  } catch {
    return null
  }
}
