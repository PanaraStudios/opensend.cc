import { collectField } from "./botToolkit"
import { defineTable } from "convex/server"
import { v } from "convex/values"
export const voiceProvider = v.union(
  v.literal("gemini"),
  v.literal("sarvam"),
  v.literal("elevenlabs")
)
export const botOutcome = v.union(
  ...(
    [
      "completed",
      "transferred_agent",
      "transferred_ivr",
      "ended_by_bot",
      "caller_hangup",
      "failed",
      "budget_exhausted",
    ] as const
  ).map(v.literal)
)
export const voiceStage = v.object({
  provider: voiceProvider,
  model: v.string(),
  credentialId: v.id("voiceProviders"),
  language: v.optional(v.string()),
  voice: v.optional(v.string()),
})
export const botConfig = v.object({
  engine: v.union(v.literal("gemini_live"), v.literal("cascade")),
  stt: v.optional(voiceStage),
  llm: v.optional(voiceStage),
  tts: v.optional(voiceStage),
  name: v.string(),
  provider: voiceProvider,
  credentialId: v.id("voiceProviders"),
  model: v.string(),
  voice: v.string(),
  language: v.string(),
  systemPrompt: v.string(),
  greeting: v.string(),
  tools: v.array(v.string()),
  collect: v.optional(v.array(collectField)),
  knowledgeBaseIds: v.optional(v.array(v.id("knowledgeBases"))),
  customToolIds: v.optional(v.array(v.id("botTools"))),
  handoff: v.object({ agents: v.boolean(), ivrId: v.optional(v.string()) }),
  maxDurationSeconds: v.number(),
  silenceTimeoutSeconds: v.number(),
  recording: v.boolean(),
  // Absent on bots and call snapshots saved before this field: lookup stays on.
  callerContext: v.optional(v.boolean()),
  disclosure: v.string(),
  monthlyMinuteBudget: v.optional(v.number()),
  maxConcurrentCalls: v.optional(v.number()),
})
export const elevenLabsVoiceValue = v.object({
  value: v.string(),
  label: v.string(),
  gender: v.union(v.literal("female"), v.literal("male"), v.literal("unknown")),
  accent: v.optional(v.string()),
  language: v.optional(v.string()),
  description: v.optional(v.string()),
  category: v.union(
    v.literal("premade"),
    v.literal("cloned"),
    v.literal("professional"),
    v.literal("generated"),
    v.literal("famous"),
    v.literal("high_quality"),
    v.literal("unknown")
  ),
})
export const voiceUsage = v.object({
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  audioSeconds: v.optional(v.number()),
  ttsCharacters: v.optional(v.number()),
})
export const voiceTables = {
  voiceProviders: defineTable({
    organizationId: v.string(),
    provider: voiceProvider,
    label: v.string(),
    encryptedKey: v.string(),
    lastFour: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_provider", ["organizationId", "provider"])
    .searchIndex("search_label", {
      searchField: "label",
      filterFields: ["organizationId", "provider"],
    }),
  elevenLabsVoiceCaches: defineTable({
    organizationId: v.string(),
    credentialId: v.id("voiceProviders"),
    refreshedAt: v.number(),
    voices: v.array(elevenLabsVoiceValue),
    error: v.optional(v.string()),
    hasMore: v.optional(v.boolean()),
  })
    .index("by_credentialId", ["credentialId"])
    .index("by_organizationId", ["organizationId"]),
  voiceBots: defineTable({
    organizationId: v.string(),
    ...botConfig.fields,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["organizationId"],
    })
    .index("by_credentialId", ["credentialId"])
    .index("by_stt_credentialId", ["stt.credentialId"])
    .index("by_llm_credentialId", ["llm.credentialId"])
    .index("by_tts_credentialId", ["tts.credentialId"]),
  callTranscripts: defineTable({
    organizationId: v.string(),
    callId: v.id("calls"),
    eventId: v.string(),
    kind: v.union(
      v.literal("transcript"),
      v.literal("tool"),
      v.literal("note"),
      v.literal("media")
    ),
    role: v.optional(v.union(v.literal("caller"), v.literal("agent"))),
    text: v.optional(v.string()),
    final: v.optional(v.boolean()),
    // Milliseconds since the call was answered. Rows written before that
    // clock omit `timeline` and the call view keeps creation order.
    timestampMs: v.number(),
    timeline: v.optional(v.literal("call")),
    toolId: v.optional(v.string()),
    toolName: v.optional(v.string()),
    arguments: v.optional(v.string()),
    result: v.optional(v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_callId", ["callId"])
    .index("by_callId_and_eventId", ["callId", "eventId"])
    .index("by_callId_and_toolId", ["callId", "toolId"]),
}
