import type { McpServer } from "@modelcontextprotocol/server"
import type {
  Opensend,
  MessagingChannel,
  SendWhatsAppMessageOptions,
  SendMessengerMessageOptions,
  SendInstagramMessageOptions,
  ChannelRequestOptions,
} from "@opensendcc/sdk"
import {
  WHATSAPP_SEND_TYPES,
  whatsappBodySchemas,
  validateWhatsAppBody,
  whatsappNormalizedSchema,
} from "@opensendcc/sdk"
import { z } from "zod"

export const channelPagination = {
  limit: z.number().int().min(1).max(100).optional(),
  after: z.string().optional(),
  before: z.string().optional(),
}
export function channelPageCheck(input: { after?: string; before?: string }) {
  if (input.after && input.before)
    throw new Error("Cannot use both after and before.")
}
export function channelOutput(
  channel: string,
  result: { data: unknown; error: unknown }
) {
  if (result.error)
    throw new Error(
      `${channel} request failed: ${JSON.stringify(result.error)}`
    )
  return {
    ...(result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data)
      ? { structuredContent: result.data as Record<string, unknown> }
      : {}),
    content: [
      { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
    ],
  }
}

const bodyKeys = WHATSAPP_SEND_TYPES

// Existing fields remain usable by clients predating normalized content.
// When type/content are present, their catalog discriminator is validated.
const whatsappOutputSchema = z.fromJSONSchema({
  ...whatsappNormalizedSchema,
  properties: {
    ...whatsappNormalizedSchema.properties,
    id: { type: "string" },
  },
  required: ["id"],
  oneOf: undefined,
  anyOf: whatsappNormalizedSchema.oneOf?.map((branch) => ({
    ...branch,
    required: [],
  })),
} as Parameters<typeof z.fromJSONSchema>[0])
const whatsappListOutputSchema = z
  .object({
    object: z.literal("list").optional(),
    has_more: z.boolean().optional(),
    data: z.array(whatsappOutputSchema).optional(),
  })
  .passthrough()

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

const whatsappSendSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  recipient: z.string().optional(),
  type: z.enum(bodyKeys).optional(),
  ...Object.fromEntries(
    bodyKeys.map((key) => [
      key,
      z
        .fromJSONSchema(
          whatsappBodySchemas[key] as Parameters<typeof z.fromJSONSchema>[0]
        )
        .optional(),
    ])
  ),
  context: z.object({ message_id: z.string() }).optional(),
  biz_opaque_callback_data: z.string().max(512).optional(),
  replyTo: z.string().optional(),
  tags: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  idempotencyKey: z.string().optional(),
})
const pageSendSchema = z.object({
  from: z.string().optional(),
  to: z.string(),
  text: z.string().optional(),
  attachment: attachment.optional(),
  template: template.optional(),
  quick_replies: z
    .array(z.object({ title: z.string(), payload: z.string() }))
    .max(13)
    .optional(),
  tag: z.enum(["HUMAN_AGENT"]).optional(),
  replyTo: z.string().optional(),
  tags: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  idempotencyKey: z.string().optional(),
})

export const channelMessageStatus = z.enum([
  "queued",
  "sent",
  "delivered",
  "read",
  "played",
  "failed",
  "received",
])
export const channelToolOptions = {
  whatsapp: {
    channel: "whatsapp",
    filterKey: "phoneNumberId",
    sendSchema: whatsappSendSchema,
  },
  messenger: {
    channel: "messenger",
    filterKey: "accountId",
    sendSchema: pageSendSchema,
  },
  instagram: {
    channel: "instagram",
    filterKey: "accountId",
    sendSchema: pageSendSchema,
  },
} as const

/** Channel adapters keep SDK input types behind a shared registration pipeline. */
function channelResources(opensend: Opensend) {
  return {
    whatsapp: {
      label: "WhatsApp",
      accountName: "phone-numbers",
      accountTitle: "Phone Numbers",
      get accounts() {
        return opensend.whatsapp.phoneNumbers
      },
      get messages() {
        return opensend.whatsapp.messages
      },
      send: (body: Record<string, unknown>, options?: ChannelRequestOptions) =>
        opensend.whatsapp.messages.send(
          body as SendWhatsAppMessageOptions,
          options
        ),
    },
    messenger: {
      label: "Messenger",
      accountName: "pages",
      accountTitle: "Pages",
      get accounts() {
        return opensend.messenger.pages
      },
      get messages() {
        return opensend.messenger.messages
      },
      send: (body: Record<string, unknown>, options?: ChannelRequestOptions) =>
        opensend.messenger.messages.send(
          body as SendMessengerMessageOptions,
          options
        ),
    },
    instagram: {
      label: "Instagram",
      accountName: "accounts",
      accountTitle: "Accounts",
      get accounts() {
        return opensend.instagram.accounts
      },
      get messages() {
        return opensend.instagram.messages
      },
      send: (body: Record<string, unknown>, options?: ChannelRequestOptions) =>
        opensend.instagram.messages.send(
          body as SendInstagramMessageOptions,
          options
        ),
    },
  }
}

export function addChannelTools(
  server: McpServer,
  opensend: Opensend,
  {
    channel,
    filterKey,
    sendSchema,
  }: {
    channel: MessagingChannel
    filterKey: "phoneNumberId" | "accountId"
    sendSchema: z.ZodObject
  }
) {
  const resource = channelResources(opensend)[channel]
  const { label } = resource
  const whatsapp = channel === "whatsapp"
  const output = (result: { data: unknown; error: unknown }) =>
    channelOutput(label, result)
  server.registerTool(
    `send-${channel}-message`,
    {
      title: `Send ${label} Message`,
      description: whatsapp
        ? "Send one WhatsApp message. Free-form messages require an open 24-hour customer service window; approved templates can start conversations. Supply exactly one body. from selects a connected sender and is required for teams with multiple numbers. Returns the queued message id; use get-whatsapp-message for delivery status. Use send_message for the shared multichannel API."
        : `Send one ${label} message with exactly one text, attachment or stored template. from selects a connected sender and is required with multiple accounts. Outside the 24-hour window a message tag is required; HUMAN_AGENT works only within 7 days. Returns the queued id; use get-${channel}-message for status. Use send_message for the shared multichannel API.`,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      inputSchema: sendSchema,
    },
    async ({ idempotencyKey, ...body }) => {
      if (whatsapp) {
        if (!body.to && !body.recipient)
          throw new Error("Provide to or recipient (BSUID).")
        validateWhatsAppBody(body)
      } else {
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
      }
      return output(
        await resource.send(
          body,
          typeof idempotencyKey === "string" && idempotencyKey
            ? { idempotencyKey }
            : undefined
        )
      )
    }
  )
  server.registerTool(
    `list-${channel}-messages`,
    {
      title: `List ${label} Messages`,
      description: `List team ${label} messages newest first. Use limit and either after or before (a message id, never both); continue with identical filters. The response contains data and has_more. Filter by status, direction or sender. Use list_messages for a shared multichannel feed with next_cursor.`,
      annotations: { readOnlyHint: true },
      ...(whatsapp ? { outputSchema: whatsappListOutputSchema } : {}),
      inputSchema: {
        ...channelPagination,
        status: channelMessageStatus.optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
        [filterKey]: z.string().optional(),
      },
    },
    async (input) => {
      channelPageCheck(input)
      return output(
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
      description: whatsapp
        ? "Retrieve one WhatsApp message, its delivery status, event timeline and signed media download URLs."
        : `Retrieve one ${label} message with its status, events and media.`,
      annotations: { readOnlyHint: true },
      inputSchema: { id: z.string() },
      ...(whatsapp ? { outputSchema: whatsappOutputSchema } : {}),
    },
    async ({ id }) => output(await resource.messages.get(id))
  )
  server.registerTool(
    `list-${channel}-${resource.accountName}`,
    {
      title: `List ${label} ${resource.accountTitle}`,
      description: whatsapp
        ? "List connected WhatsApp phone numbers, quality, throughput and registration status."
        : `List connected ${label} sending accounts with cursor pagination.`,
      annotations: { readOnlyHint: true },
      inputSchema: channelPagination,
    },
    async (input) => {
      channelPageCheck(input)
      return output(
        await resource.accounts.list(
          input as Parameters<typeof resource.accounts.list>[0]
        )
      )
    }
  )
}

/** Shared controls accept the channel explicitly, matching the REST catalog. */
export function addChannelControlTools(server: McpServer, opensend: Opensend) {
  const channel = z.enum(["whatsapp", "messenger", "instagram"])
  const annotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  }
  server.registerTool(
    "mark_message_read",
    {
      title: "Mark Message Read",
      description:
        "Send a Meta read receipt for a team inbound message received within 30 days. Optionally show typing. Throttled reads are accepted without another Meta call.",
      annotations,
      inputSchema: { channel, id: z.string(), typing: z.boolean().optional() },
    },
    async ({ channel, id, typing }) =>
      channelOutput(
        channel,
        await opensend[channel].messages.markRead(id, { typing })
      )
  )
  server.registerTool(
    "set_typing",
    {
      title: "Set Typing Indicator",
      description:
        "Show typing in a team conversation. Messenger and Instagram support on/off; WhatsApp supports on only, using its latest inbound message and marking it read. Calls are throttled per conversation.",
      annotations,
      inputSchema: { channel, id: z.string(), on: z.boolean() },
    },
    async ({ channel, id, on }) =>
      channelOutput(
        channel,
        await opensend[channel].conversations.typing(id, on)
      )
  )
}
