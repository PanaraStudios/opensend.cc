import type { McpServer } from "@modelcontextprotocol/server"
import type { Opensend, SendMessageOptions } from "@opensendcc/sdk"
import { z } from "zod"
import { channelOutput } from "./channelMessaging.js"

export function addMessageTools(server: McpServer, opensend: Opensend) {
  const channel = z.enum(["email", "whatsapp", "messenger", "instagram"])
  server.registerTool(
    "send_message",
    {
      title: "Send Message",
      description:
        "Send email, WhatsApp, Messenger or Instagram through the unified API. Supply text, a stored template, or media; email also supports subject and html. Uses the selected channel's write scope and existing sender validation. Meta free-form sends require an open conversation window.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      inputSchema: {
        channel,
        to: z.union([z.string(), z.array(z.string())]),
        from: z.string().optional(),
        text: z.string().optional(),
        subject: z.string().optional(),
        html: z.string().optional(),
        reply_to: z.union([z.string(), z.array(z.string())]).optional(),
        template: z
          .object({
            id: z.string().optional(),
            alias: z.string().optional(),
            variables: z
              .record(z.string(), z.union([z.string(), z.number()]))
              .optional(),
          })
          .optional(),
        media: z
          .array(
            z.object({
              type: z.enum(["image", "video", "audio", "file"]).optional(),
              id: z.string().optional(),
              url: z.string().optional(),
              filename: z.string().optional(),
              path: z.string().optional(),
              content: z.string().optional(),
              content_type: z.string().optional(),
            })
          )
          .optional(),
        tags: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional(),
        idempotencyKey: z.string().min(1).max(256).optional(),
      },
    },
    async ({ idempotencyKey, ...body }) =>
      channelOutput(
        "Message",
        await opensend.messages.send(body as SendMessageOptions, {
          idempotencyKey,
        })
      )
  )
  server.registerTool(
    "list_messages",
    {
      title: "List Messages",
      description:
        "List messages from readable channels newest first with an opaque cursor. Explicit channel filters require that channel's read scope. Use next_cursor to continue with identical filters.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        channel: channel.optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
        status: z.string().optional(),
        contact_id: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        created_after: z.string().optional(),
        created_before: z.string().optional(),
      },
    },
    async (input) =>
      channelOutput("Messages", await opensend.messages.list(input))
  )
  server.registerTool(
    "get_message",
    {
      title: "Get Message",
      description:
        "Retrieve a message in any channel using its message id. Requires that message's channel read scope.",
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string() },
    },
    async ({ id }) => channelOutput("Message", await opensend.messages.get(id))
  )
}
