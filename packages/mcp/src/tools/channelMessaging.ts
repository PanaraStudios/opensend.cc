import type { McpServer } from "@modelcontextprotocol/server"
import type {
  Opensend,
  MessagingChannel,
  SendWhatsAppMessageOptions,
  SendMessengerMessageOptions,
  SendInstagramMessageOptions,
  ChannelRequestOptions,
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
    content: [
      { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
    ],
  }
}

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
  reaction: z.object({ message_id: z.string(), emoji: z.string() }).optional(),
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
        ? "Send one WhatsApp message. Free-form messages require an open 24-hour customer service window; approved templates can start conversations. Supply exactly one body. from is required for teams with multiple numbers. Returns the queued message id; use get-whatsapp-message for delivery status."
        : `Send one ${label} message with exactly one text, attachment or stored template. from is required with multiple accounts. Outside the 24-hour window a message tag is required; HUMAN_AGENT works only within 7 days. Returns the queued id; use get-${channel}-message for status.`,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      inputSchema: sendSchema,
    },
    async ({ idempotencyKey, ...body }) => {
      if (whatsapp) {
        const present = bodyKeys.filter((key) => body[key] !== undefined)
        if (present.length !== 1 || (body.type && body.type !== present[0]))
          throw new Error("Supply exactly one body matching type.")
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
      description: whatsapp
        ? "List team WhatsApp messages with cursor pagination and optional status, direction and phone number filters."
        : `List team ${label} messages with cursors and optional status, direction and account filters.`,
      annotations: { readOnlyHint: true },
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
