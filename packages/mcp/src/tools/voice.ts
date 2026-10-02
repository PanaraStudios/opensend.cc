import { collectSchema } from "./botToolkit.js"
import type { McpServer } from "@modelcontextprotocol/server"
import type { Opensend } from "@opensendcc/sdk"
import { z } from "zod"
import {
  channelOutput,
  channelPagination,
  channelPageCheck,
} from "./channelMessaging.js"
const fields = {
  collect: z.array(collectSchema).max(32).optional(),
  knowledgeBaseIds: z.array(z.string()).max(16).optional(),
  customToolIds: z.array(z.string()).max(16).optional(),
  name: z.string().min(1).max(2000),
  provider: z.enum(["gemini", "sarvam", "elevenlabs"]),
  credentialId: z.string(),
  model: z.string().optional(),
  engine: z.enum(["gemini_live", "cascade"]).optional(),
  stt: z
    .object({
      provider: z.enum(["sarvam", "elevenlabs"]),
      model: z.string().optional(),
      credentialId: z.string(),
      language: z.string().optional(),
    })
    .optional(),
  llm: z
    .object({
      provider: z.enum(["sarvam", "gemini"]),
      model: z.string().optional(),
      credentialId: z.string(),
    })
    .optional(),
  tts: z
    .object({
      provider: z.enum(["sarvam", "elevenlabs"]),
      model: z.string().optional(),
      credentialId: z.string(),
      voice: z.string(),
    })
    .optional(),
  voice: z.string().optional(),
  language: z.string().optional(),
  systemPrompt: z.string().max(16000).optional(),
  greeting: z.string().max(2000).optional(),
  disclosure: z.string().min(1).max(2000).optional(),
  recording: z.boolean().optional(),
  maxDurationSeconds: z.number().int().min(1).max(3600).optional(),
  silenceTimeoutSeconds: z.number().int().min(1).max(300).optional(),
  monthlyMinuteBudget: z.number().min(0).optional(),
  maxConcurrentCalls: z.number().int().min(1).max(100).optional(),
  tools: z
    .array(
      z.enum([
        "lookup_contact",
        "create_note",
        "send_whatsapp_message",
        "transfer_to_agent",
        "transfer_to_ivr",
        "end_call",
      ])
    )
    .max(6)
    .optional(),
  handoff: z
    .object({ agents: z.boolean(), ivrId: z.string().optional() })
    .optional(),
}
export function addVoiceTools(server: McpServer, opensend: Opensend) {
  const output = (result: { data: unknown; error: unknown }) =>
    channelOutput("Voice bots", result)
  server.registerTool(
    "create-voice-bot",
    {
      title: "Create Voice Bot",
      description:
        "Create a team voice bot using existing write-only provider credentials. Pipecat runs Gemini Live or configurable STT/LLM/TTS stages; Indian-language defaults use Sarvam STT/LLM and ElevenLabs TTS. Inbound gateway calls only.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: { ...fields, idempotencyKey: z.string().optional() },
    },
    async ({ idempotencyKey, ...input }) =>
      output(await opensend.voiceBots.create(input, { idempotencyKey }))
  )
  server.registerTool(
    "list-voice-bots",
    {
      title: "List Voice Bots",
      description: "List this team's voice bot configurations with ID cursors.",
      annotations: { readOnlyHint: true },
      inputSchema: channelPagination,
    },
    async (input) => {
      channelPageCheck(input)
      return output(
        await opensend.voiceBots.list(
          input as Parameters<typeof opensend.voiceBots.list>[0]
        )
      )
    }
  )
  server.registerTool(
    "get-voice-bot",
    {
      title: "Get Voice Bot",
      description:
        "Retrieve a team voice bot. Provider keys are never returned.",
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string() },
    },
    async ({ id }) => output(await opensend.voiceBots.get(id))
  )
  server.registerTool(
    "update-voice-bot",
    {
      title: "Update Voice Bot",
      description:
        "Patch a bot configuration. Active calls retain their configuration snapshot.",
      annotations: { readOnlyHint: false },
      inputSchema: { ...z.object(fields).partial().shape, id: z.string() },
    },
    async ({ id, ...input }) =>
      output(await opensend.voiceBots.update(id, input))
  )
  server.registerTool(
    "remove-voice-bot",
    {
      title: "Remove Voice Bot",
      description: "Delete a bot after removing its number routing.",
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: { id: z.string() },
    },
    async ({ id }) => output(await opensend.voiceBots.remove(id))
  )
  server.registerTool(
    "get-whatsapp-call-transcript",
    {
      title: "Get Call Transcript",
      description:
        "Read paginated caller/assistant transcript lines, notes and tool calls. Requires whatsapp:read.",
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string(), ...channelPagination },
    },
    async ({ id, ...input }) => {
      channelPageCheck(input)
      return output(
        await opensend.whatsapp.calls.transcript(
          id,
          input as Parameters<typeof opensend.whatsapp.calls.transcript>[1]
        )
      )
    }
  )
  server.registerTool(
    "list-elevenlabs-voices",
    {
      title: "List ElevenLabs Voices",
      description:
        "List voices available to this team's ElevenLabs key. Names, gender, accent and category only. The key is never returned. Pass refresh to fetch again before the one-hour cache expires.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        credentialId: z.string().optional(),
        refresh: z.boolean().optional(),
      },
    },
    async ({ credentialId, refresh }) =>
      channelOutput(
        "Voice providers",
        await opensend.voiceProviders.listVoices({ credentialId, refresh })
      )
  )
}
