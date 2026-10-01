import type { McpServer } from "@modelcontextprotocol/server"
import type {
  Opensend,
  SendMessengerMessageOptions,
  SendInstagramMessageOptions,
} from "@opensendcc/sdk"
import { z } from "zod"

import {
  channelPagination as pagination,
  channelPageCheck as pageCheck,
  channelOutput as output,
} from "./channelMessaging.js"

const attachment = z
  .object({
    type: z.enum(["image", "video", "audio", "file"]),
    url: z.string().url().optional(),
    id: z.string().optional(),
  })
  .refine(
    (value) =>
      Number(value.url !== undefined) + Number(value.id !== undefined) === 1,
    "Supply exactly one attachment url or id."
  )
const template = z
  .object({
    id: z.string().optional(),
    alias: z.string().optional(),
    variables: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .optional(),
  })
  .refine(
    (value) =>
      Number(value.id !== undefined) + Number(value.alias !== undefined) === 1,
    "Supply exactly one template id or alias."
  )

/** Both Page-token channels share the same REST contract, with stricter IG tags and quick replies. */
export function addPageMessagingTools(
  server: McpServer,
  opensend: Opensend,
  channel: "messenger" | "instagram"
) {
  const label = channel === "messenger" ? "Messenger" : "Instagram"
  const resource = opensend[channel]
  server.registerTool(
    `send-${channel}-message`,
    {
      title: `Send ${label} Message`,
      description: `Send one ${label} message with exactly one text, attachment or stored template. from is required with multiple accounts. Outside the 24-hour window a message tag is required; HUMAN_AGENT works only within 7 days. Returns the queued id; use get-${channel}-message for status.`,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      inputSchema: {
        from: z.string().optional(),
        to: z.string(),
        text: z.string().optional(),
        attachment: attachment.optional(),
        template: template.optional(),
        quick_replies: z
          .array(z.object({ title: z.string(), payload: z.string() }))
          .max(13)
          .optional(),
        tag: (channel === "instagram"
          ? z.enum(["HUMAN_AGENT"])
          : z.enum([
              "HUMAN_AGENT",
              "CONFIRMED_EVENT_UPDATE",
              "POST_PURCHASE_UPDATE",
              "ACCOUNT_UPDATE",
            ])
        ).optional(),
        replyTo: z.string().optional(),
        tags: z
          .array(z.object({ name: z.string(), value: z.string() }))
          .optional(),
        idempotencyKey: z.string().optional(),
      },
    },
    async ({ idempotencyKey, ...body }) => {
      if (
        [body.text, body.attachment, body.template].filter(
          (value) => value !== undefined
        ).length !== 1
      )
        throw new Error("Supply exactly one text, attachment or template.")
      if (
        channel === "instagram" &&
        body.quick_replies !== undefined &&
        body.text === undefined
      )
        throw new Error("Instagram quick replies require a text message.")
      const options = idempotencyKey ? { idempotencyKey } : undefined
      const result =
        channel === "messenger"
          ? await opensend.messenger.messages.send(
              body as SendMessengerMessageOptions,
              options
            )
          : await opensend.instagram.messages.send(
              body as SendInstagramMessageOptions,
              options
            )
      return output(label, result)
    }
  )
  server.registerTool(
    `list-${channel}-messages`,
    {
      title: `List ${label} Messages`,
      description: `List team ${label} messages with cursors and optional status, direction and account filters.`,
      annotations: { readOnlyHint: true },
      inputSchema: {
        ...pagination,
        status: z
          .enum(["queued", "sent", "delivered", "read", "failed", "received"])
          .optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
        accountId: z.string().optional(),
      },
    },
    async (input) => {
      pageCheck(input)
      return output(
        label,
        await resource.messages.list(
          input as Parameters<typeof resource.messages.list>[0]
        )
      )
    }
  )
  server.registerTool(
    `get-${channel}-message`,
    {
      title: `Get ${label} Message`,
      description: `Retrieve one ${label} message with its status, events and media.`,
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string() },
    },
    async ({ id }) => output(label, await resource.messages.get(id))
  )
  const accountName = channel === "messenger" ? "pages" : "accounts"
  server.registerTool(
    `list-${channel}-${accountName}`,
    {
      title: `List ${label} ${channel === "messenger" ? "Pages" : "Accounts"}`,
      description: `List connected ${label} sending accounts with cursor pagination.`,
      annotations: { readOnlyHint: true },
      inputSchema: pagination,
    },
    async (input) => {
      pageCheck(input)
      const accounts =
        channel === "messenger"
          ? opensend.messenger.pages
          : opensend.instagram.accounts
      return output(
        label,
        await accounts.list(input as Parameters<typeof accounts.list>[0])
      )
    }
  )
}
