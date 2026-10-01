import type { McpServer } from "@modelcontextprotocol/server"
import type { Opensend, SendWhatsAppMessageOptions } from "@opensendcc/sdk"
import { z } from "zod"
import {
  channelPagination as pagination,
  channelPageCheck as pageCheck,
  channelOutput,
} from "./channelMessaging.js"
const media = z.object({
  id: z.string().optional(),
  link: z.string().url().optional(),
})
const captionedMedia = media.extend({
  caption: z.string().max(1024).optional(),
})
const record = z.record(z.string(), z.unknown())
const bodyKeys = [
  "text",
  "template",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "interactive",
  "reaction",
] as const
const output = (result: { data: unknown; error: unknown }) =>
  channelOutput("WhatsApp", result)
export function addWhatsAppTools(server: McpServer, opensend: Opensend) {
  server.registerTool(
    "send-whatsapp-message",
    {
      title: "Send WhatsApp Message",
      description:
        "Send one WhatsApp message. Free-form messages require an open 24-hour customer service window; approved templates can start conversations. Supply exactly one body. from is required for teams with multiple numbers. Returns the queued message id; use get-whatsapp-message for delivery status.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      inputSchema: {
        from: z.string().optional(),
        to: z.string(),
        type: z.enum(bodyKeys).optional(),
        text: z
          .union([
            z.string(),
            z.object({
              body: z.string().max(4096),
              preview_url: z.boolean().optional(),
            }),
          ])
          .optional(),
        template: z
          .object({
            name: z.string(),
            language: z.union([z.string(), z.object({ code: z.string() })]),
            components: z.array(record).optional(),
            variables: z
              .record(z.string(), z.union([z.string(), z.number()]))
              .optional(),
          })
          .optional(),
        image: captionedMedia.optional(),
        video: captionedMedia.optional(),
        audio: media.optional(),
        sticker: media.optional(),
        document: captionedMedia
          .extend({ filename: z.string().optional() })
          .optional(),
        location: z
          .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            name: z.string().optional(),
            address: z.string().optional(),
          })
          .optional(),
        interactive: record.optional(),
        reaction: z
          .object({ message_id: z.string(), emoji: z.string() })
          .optional(),
        replyTo: z.string().optional(),
        tags: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional(),
        idempotencyKey: z.string().optional(),
      },
    },
    async ({ idempotencyKey, ...body }) => {
      const present = bodyKeys.filter((key) => body[key] !== undefined)
      if (present.length !== 1 || (body.type && body.type !== present[0]))
        throw new Error("Supply exactly one body matching type.")
      return output(
        await opensend.whatsapp.messages.send(
          body as SendWhatsAppMessageOptions,
          idempotencyKey ? { idempotencyKey } : undefined
        )
      )
    }
  )
  server.registerTool(
    "list-whatsapp-messages",
    {
      title: "List WhatsApp Messages",
      description:
        "List team WhatsApp messages with cursor pagination and optional status, direction and phone number filters.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        ...pagination,
        status: z
          .enum(["queued", "sent", "delivered", "read", "failed", "received"])
          .optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
        phoneNumberId: z.string().optional(),
      },
    },
    async (input) => {
      pageCheck(input)
      return output(
        await opensend.whatsapp.messages.list(
          input as Parameters<typeof opensend.whatsapp.messages.list>[0]
        )
      )
    }
  )
  server.registerTool(
    "get-whatsapp-message",
    {
      title: "Get WhatsApp Message",
      description:
        "Retrieve one WhatsApp message, its delivery status, event timeline and signed media download URLs.",
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string() },
    },
    async ({ id }) => output(await opensend.whatsapp.messages.get(id))
  )
  server.registerTool(
    "list-whatsapp-phone-numbers",
    {
      title: "List WhatsApp Phone Numbers",
      description:
        "List connected WhatsApp phone numbers, quality, throughput and registration status.",
      annotations: { readOnlyHint: true },
      inputSchema: pagination,
    },
    async (input) => {
      pageCheck(input)
      return output(
        await opensend.whatsapp.phoneNumbers.list(
          input as Parameters<typeof opensend.whatsapp.phoneNumbers.list>[0]
        )
      )
    }
  )
}
