import type { McpServer } from "@modelcontextprotocol/server"
import type { Opensend, IvrDefinition, IvrPatch } from "@opensendcc/sdk"
import { z } from "zod"
import {
  channelOutput,
  channelPagination,
  channelPageCheck,
} from "./channelMessaging.js"
const prompt = z.union([
  z.object({ kind: z.literal("audio"), fileId: z.string() }),
  z.object({
    kind: z.literal("tts"),
    text: z.string().min(1).max(2000),
    voice: z.string().optional(),
  }),
])
const action = z.union([
  z.object({ kind: z.literal("submenu"), menuId: z.string() }),
  z.object({ kind: z.literal("agents") }),
  z.object({ kind: z.literal("bot"), botId: z.string() }),
  z.object({ kind: z.literal("voicemail") }),
  z.object({ kind: z.literal("playAndHangup"), prompt }),
  z.object({
    kind: z.literal("webhook"),
    url: z.string().url(),
    secretId: z.string().optional(),
  }),
  z.object({ kind: z.literal("hangup") }),
])
const definition = {
  promptVoice: z
    .object({
      provider: z.enum(["elevenlabs", "sarvam"]),
      voice: z.string(),
      language: z.string(),
      credentialId: z.string(),
    })
    .optional(),
  name: z.string().min(1).max(256),
  language: z.string(),
  entryMenuId: z.string(),
  menus: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        prompt,
        invalidPrompt: prompt.optional(),
        timeoutSeconds: z.number().int().min(1).max(30).default(5),
        retries: z.number().int().min(0).max(5).default(2),
        maxDigits: z.number().int().min(1).max(12).default(1),
        options: z.record(z.string().regex(/^[0-9*#]$/), action),
        noInputAction: action,
        failureAction: action,
      })
    )
    .min(1)
    .max(50),
  businessHours: z
    .object({
      status: z.enum(["ENABLED", "DISABLED"]),
      timezone_id: z.string().optional(),
      weekly_operating_hours: z
        .array(
          z.object({
            day_of_week: z.enum([
              "MONDAY",
              "TUESDAY",
              "WEDNESDAY",
              "THURSDAY",
              "FRIDAY",
              "SATURDAY",
              "SUNDAY",
            ]),
            open_time: z.string(),
            close_time: z.string(),
          })
        )
        .max(14)
        .optional(),
      holiday_schedule: z
        .array(
          z.object({
            date: z.string(),
            start_time: z.string(),
            end_time: z.string(),
          })
        )
        .max(20)
        .optional(),
      closedAction: action,
    })
    .optional(),
}
export function addIvrTools(server: McpServer, opensend: Opensend) {
  const read = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    write = {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    }
  server.registerTool(
    "create-ivr",
    {
      title: "Create IVR",
      description:
        "Create a team IVR menu tree. Configure promptVoice with a team provider credential to render typed prompts.",
      inputSchema: { ...definition, idempotencyKey: z.string().optional() },
      annotations: write,
    },
    async ({ idempotencyKey, ...input }) =>
      channelOutput(
        "IVR",
        await opensend.ivrs.create(input as IvrDefinition, { idempotencyKey })
      )
  )
  server.registerTool(
    "list-ivrs",
    {
      title: "List IVRs",
      description: "List team IVRs with cursor pagination.",
      inputSchema: channelPagination,
      annotations: read,
    },
    async (input) => {
      channelPageCheck(input)
      return channelOutput(
        "IVR",
        await opensend.ivrs.list(
          input as Parameters<typeof opensend.ivrs.list>[0]
        )
      )
    }
  )
  server.registerTool(
    "get-ivr",
    {
      title: "Get IVR",
      description: "Read a team IVR definition and prompt readiness.",
      inputSchema: { id: z.string() },
      annotations: read,
    },
    async ({ id }) => channelOutput("IVR", await opensend.ivrs.get(id))
  )
  const optionalFields = Object.fromEntries(
    Object.entries(definition).map(([k, v]) => [k, v.optional()])
  )
  const partial = {
    ...optionalFields,
    promptVoice: definition.promptVoice.nullable(),
    businessHours: definition.businessHours.nullable(),
  }
  server.registerTool(
    "update-ivr",
    {
      title: "Update IVR",
      description: "Patch an IVR; menus replace the whole bounded menu array.",
      inputSchema: { id: z.string(), ...partial },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ id, ...input }) =>
      channelOutput("IVR", await opensend.ivrs.update(id, input as IvrPatch))
  )
  server.registerTool(
    "remove-ivr",
    {
      title: "Remove IVR",
      description: "Delete an IVR after removing number routing assignments.",
      inputSchema: { id: z.string() },
      annotations: { ...write, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => channelOutput("IVR", await opensend.ivrs.remove(id))
  )
  server.registerTool(
    "validate-ivr",
    {
      title: "Validate IVR",
      description: "Dry-run shared menu validation without modifying the IVR.",
      inputSchema: {
        id: z.string(),
        ...partial,
        idempotencyKey: z.string().optional(),
      },
      annotations: read,
    },
    async ({ id, idempotencyKey, ...input }) =>
      channelOutput(
        "IVR",
        await opensend.ivrs.validate(id, input as IvrPatch, { idempotencyKey })
      )
  )
  server.registerTool(
    "render-ivr",
    {
      title: "Render IVR prompts",
      description:
        "Retry failed IVR prompts using the saved team provider key. Returns per-prompt render statuses.",
      inputSchema: { id: z.string(), idempotencyKey: z.string().optional() },
      annotations: write,
    },
    async ({ id, idempotencyKey }) =>
      channelOutput("IVR", await opensend.ivrs.render(id, { idempotencyKey }))
  )
  server.registerTool(
    "rotate-ivr-signing-secret",
    {
      title: "Rotate IVR signing secret",
      description:
        "Replace an IVR signing credential and reveal the new secret once. Save it now; subsequent reads are redacted. Requires ivrs:write.",
      inputSchema: { id: z.string(), idempotencyKey: z.string().optional() },
      annotations: write,
    },
    async ({ id, idempotencyKey }) =>
      channelOutput(
        "IVR",
        await opensend.ivrs.rotateSigningSecret(id, { idempotencyKey })
      )
  )
}
