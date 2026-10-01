export type VoiceProvider = "gemini" | "sarvam" | "elevenlabs"
export type VoiceBotTool =
  | "lookup_contact"
  | "create_note"
  | "send_whatsapp_message"
  | "transfer_to_agent"
  | "transfer_to_ivr"
  | "end_call"
export interface VoiceBotInput {
  name: string
  provider: VoiceProvider
  credentialId: string
  model?: string
  engine?: "gemini_live" | "cascade"
  stt?: {
    provider: "sarvam" | "elevenlabs"
    model?: string
    credentialId: string
    language?: string
  }
  llm?: { provider: "sarvam" | "gemini"; model?: string; credentialId: string }
  tts?: {
    provider: "sarvam" | "elevenlabs"
    model?: string
    credentialId: string
    voice: string
  }
  voice?: string
  language?: string
  systemPrompt?: string
  greeting?: string
  tools?: VoiceBotTool[]
  handoff?: { agents: boolean; ivrId?: string }
  maxDurationSeconds?: number
  silenceTimeoutSeconds?: number
  recording?: boolean
  disclosure?: string
  monthlyMinuteBudget?: number
  maxConcurrentCalls?: number
}
export interface VoiceBot extends Required<
  Omit<
    VoiceBotInput,
    "stt" | "llm" | "tts" | "monthlyMinuteBudget" | "maxConcurrentCalls"
  >
> {
  id: string
  stt?: VoiceBotInput["stt"]
  llm?: VoiceBotInput["llm"]
  tts?: VoiceBotInput["tts"]
  monthlyMinuteBudget?: number
  maxConcurrentCalls?: number
  createdAt: number
  updatedAt: number
}
export interface VoiceProviderCredential {
  id: string
  provider: VoiceProvider
  label: string
  lastFour: string
  createdAt: number
  updatedAt: number
}
export interface CreateVoiceProvider {
  provider: VoiceProvider
  label: string
  key: string
}
export type CallingRouting =
  { kind: "agents" } | { kind: "api" } | { kind: "bot"; botId: string }
export type BotOutcome =
  | "completed"
  | "transferred_agent"
  | "transferred_ivr"
  | "ended_by_bot"
  | "caller_hangup"
  | "failed"
  | "budget_exhausted"
export interface VoiceUsage {
  inputTokens?: number
  outputTokens?: number
  audioSeconds?: number
  ttsCharacters?: number
}
export interface CallTranscriptLine {
  id: string
  callId: string
  eventId: string
  kind: "transcript" | "tool" | "note" | "media"
  role?: "caller" | "agent"
  text?: string
  final?: boolean
  timestampMs: number
  toolId?: string
  toolName?: string
  arguments?: string
  result?: string
}
