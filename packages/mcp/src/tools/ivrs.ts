import type { McpServer } from "@modelcontextprotocol/server"
import type { Opensend, IvrDefinition } from "@opensendcc/sdk"
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
        "Create a team IVR menu tree. TTS remains pending_render until a renderer is configured.",
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
  const partial = Object.fromEntries(
    Object.entries(definition).map(([k, v]) => [k, v.optional()])
  )
  server.registerTool(
    "update-ivr",
    {
      title: "Update IVR",
      description: "Patch an IVR; menus replace the whole bounded menu array.",
      inputSchema: { id: z.string(), ...partial },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ id, ...input }) =>
      channelOutput(
        "IVR",
        await opensend.ivrs.update(id, input as Partial<IvrDefinition>)
      )
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
      inputSchema: { id: z.string(), ...partial },
      annotations: read,
    },
    async ({ id, ...input }) =>
      channelOutput(
        "IVR",
        await opensend.ivrs.validate(id, input as Partial<IvrDefinition>)
      )
  )
}
