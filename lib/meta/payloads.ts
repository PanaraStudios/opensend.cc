import { fromWaId, normalizePhone, toWaId } from "../dashboard/phone"
import { CHANNELS, type MessagingChannel, type PageChannel } from "../channels"
import { object as record } from "./parse"

/** Cloud API wire shapes, checked against Meta's Messages Object and examples:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview#parameter-formats
 */
import {
  WHATSAPP_SEND_TYPES,
  type WhatsAppSendType,
} from "../../packages/sdk/src/whatsapp/catalog"
import { validateWhatsAppBody } from "../../packages/sdk/src/whatsapp/validation"
export { WHATSAPP_SEND_TYPES }
export type { WhatsAppSendType }
export type WhatsAppBody = {
  to?: string
  recipient?: string
  type?: WhatsAppSendType
  reply_to?: string
  context?: { message_id: string }
  biz_opaque_callback_data?: string
} & Partial<Record<WhatsAppSendType, unknown>>

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`The \`${field}\` field must be an object.`)
  return value as Record<string, unknown>
}
function text(
  value: unknown,
  field: string,
  max = 4096,
  empty = false
): string {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > max
  )
    throw new Error(
      `The \`${field}\` field must be ${empty ? "a" : "a nonempty"} string of at most ${max} characters.`
    )
  return value
}
/** A template name and language, with Meta components or plain variables.
 * Stored templates are resolved first in convex/channels/messages.ts. */
export function templatePayload(value: unknown) {
  const template = object(value, "template")
  const name = text(template.name, "template.name", 512)
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Invalid template name.")
  const language =
    typeof template.language === "string"
      ? text(template.language, "template.language", 32)
      : text(
          object(template.language, "template.language").code,
          "template.language.code",
          32
        )
  if (template.components !== undefined && template.variables !== undefined)
    throw new Error("Provide template components or variables, not both.")
  let components: unknown[] | undefined
  if (template.components !== undefined) {
    if (!Array.isArray(template.components) || template.components.length > 20)
      throw new Error(
        "Template components must be an array of at most 20 components."
      )
    validateWhatsAppBody({ template })
    components = template.components
  } else if (template.variables !== undefined) {
    const variables = object(template.variables, "template.variables")
    const keys = Object.keys(variables)
    const positional = keys.every((key) => /^[1-9]\d*$/.test(key))
    const ordered = positional
      ? keys.sort((a, b) => Number(a) - Number(b))
      : keys
    if (positional && ordered.some((key, i) => Number(key) !== i + 1))
      throw new Error(
        "Positional template variables must be consecutive, starting at 1."
      )
    components = ordered.length
      ? [
          {
            type: "body",
            parameters: ordered.map((key) => {
              const value = variables[key]
              if (!(
                typeof value === "string" ||
                (typeof value === "number" && Number.isFinite(value))
              ))
                throw new Error(
                  "Template variables must be strings or finite numbers."
                )
              if (!positional && !/^[a-z][a-z0-9_]*$/.test(key))
                throw new Error("Invalid named template variable.")
              return {
                type: "text",
                text: text(String(value), "template variable", 32768),
                ...(!positional ? { parameter_name: key } : {}),
              }
            }),
          },
        ]
      : undefined
  }
  return {
    name,
    language: { code: language },
    ...(components ? { components } : {}),
  }
}
/** Validate before enqueueing and build only Cloud API fields. */
export function whatsappPayload(input: WhatsAppBody): Record<
  string,
  unknown
> & {
  messaging_product: "whatsapp"
  recipient_type: "individual"
  to?: string
  recipient?: string
  type: WhatsAppSendType
} {
  if (
    input.to !== undefined &&
    (typeof input.to !== "string" || !normalizePhone(fromWaId(input.to)))
  )
    throw new Error("The `to` field must be an E.164 phone number or wa_id.")
  if (input.to === undefined && !input.recipient)
    throw new Error("Provide to or recipient (BSUID).")
  if (input.recipient !== undefined) text(input.recipient, "recipient")
  const type = validateWhatsAppBody(input)
  const reply = input.reply_to ?? input.context?.message_id
  if (reply !== undefined && ["reaction", "template"].includes(type))
    throw new Error(
      "Reply context is not supported for reactions or templates."
    )
  const body =
    type === "template"
      ? templatePayload(input.template)
      : type === "text" && typeof input.text === "string"
        ? { body: input.text }
        : input[type]
  return {
    messaging_product: "whatsapp" as const,
    recipient_type: "individual" as const,
    ...(input.to !== undefined
      ? { to: toWaId(normalizePhone(fromWaId(input.to))!) }
      : {}),
    ...(input.recipient !== undefined ? { recipient: input.recipient } : {}),
    type,
    [type]: body,
    ...(reply !== undefined
      ? { context: { message_id: text(reply, "context.message_id") } }
      : {}),
    ...(input.biz_opaque_callback_data !== undefined
      ? {
          biz_opaque_callback_data: text(
            input.biz_opaque_callback_data,
            "biz_opaque_callback_data",
            512
          ),
        }
      : {}),
  }
}

/** Meta rejects the legacy Messenger tags (CONFIRMED_EVENT_UPDATE,
    POST_PURCHASE_UPDATE, ACCOUNT_UPDATE) with error 100 since April 27,
    2026, so only HUMAN_AGENT is accepted. */
export const MESSAGE_TAGS = ["HUMAN_AGENT"] as const
export type MessageTag = (typeof MESSAGE_TAGS)[number]
export type PageBody = {
  to: string
  text?: unknown
  attachment?: unknown
  quick_replies?: unknown
  tag?: unknown
  reply_to?: string
}
export const PAGE_WINDOW_CLOSED =
  "The 24-hour messaging window is closed. Pass a message tag such as HUMAN_AGENT."

/** HUMAN_AGENT is for human replies, only within seven days of inbound. */
export function pageMessagingType(
  windowExpiresAt: number | undefined,
  tag: unknown,
  now: number
) {
  if ((windowExpiresAt ?? 0) > now) return "RESPONSE" as const
  if (!tag) throw new Error(PAGE_WINDOW_CLOSED)
  if (tag === "HUMAN_AGENT" && (windowExpiresAt ?? 0) + 6 * 86400_000 <= now)
    throw new Error("The 7-day HUMAN_AGENT messaging window is closed.")
  return "MESSAGE_TAG" as const
}
export function quickReplies(value: unknown) {
  if (!Array.isArray(value) || value.length > 13)
    throw new Error("quick_replies must be an array of at most 13 replies.")
  return value.map((raw) => {
    const reply = object(raw, "quick reply")
    return {
      title: text(reply.title, "title", 20),
      payload: text(reply.payload, "payload", 1000),
    }
  })
}

/** Page-backed Send API. Stored text templates are resolved before this adapter.
 * https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages
 * https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/quick-replies
 */
export function pageMessageContent(
  input: Omit<PageBody, "to" | "reply_to">,
  channel: PageChannel
) {
  if ((input.text === undefined) === (input.attachment === undefined))
    throw new Error(
      "Provide exactly one of text, attachment or a stored template."
    )
  if (input.tag !== undefined && !MESSAGE_TAGS.some((tag) => tag === input.tag))
    throw new Error("The only supported message tag is HUMAN_AGENT.")
  const message: {
    text?: string
    attachment?: { type: string; payload: Record<string, unknown> }
    quick_replies?: { content_type: string; title: string; payload: string }[]
  } = {}
  if (input.text !== undefined)
    message.text = text(
      input.text,
      "text",
      channel === "instagram" ? 1000 : 2000
    )
  else {
    const source = object(input.attachment, "attachment")
    if (!["image", "video", "audio", "file"].includes(String(source.type)))
      throw new Error("Invalid attachment type.")
    if ((source.url === undefined) === (source.id === undefined))
      throw new Error("Provide exactly one attachment url or id.")
    let payload: Record<string, unknown>
    if (source.url !== undefined) {
      const url = text(source.url, "attachment.url", 4096)
      const parsed = new URL(url)
      if (
        !["https:", "http:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        throw new Error(
          "Attachment URLs must use HTTP or HTTPS without credentials."
        )
      payload = { url }
    } else payload = { attachment_id: text(source.id, "attachment.id", 256) }
    message.attachment = { type: String(source.type), payload }
  }
  if (input.quick_replies !== undefined) {
    if (channel === "instagram" && !message.text)
      throw new Error("Instagram quick replies require a text message.")
    const replies = quickReplies(input.quick_replies).map((reply) => ({
      content_type: "text",
      ...reply,
    }))
    if (replies.length) message.quick_replies = replies
  }
  return message
}
function pagePayload(input: PageBody, channel: PageChannel) {
  if (typeof input.to !== "string" || !/^\d{1,32}$/.test(input.to))
    throw new Error("The `to` field must be a scoped recipient ID.")
  const message = pageMessageContent(input, channel)
  return {
    recipient: { id: input.to },
    messaging_type: "RESPONSE" as "RESPONSE" | "MESSAGE_TAG",
    message,
    ...(input.tag !== undefined ? { tag: input.tag as MessageTag } : {}),
    ...(input.reply_to !== undefined
      ? { reply_to: { mid: text(input.reply_to, "reply_to", 1024) } }
      : {}),
  }
}
export const messengerPayload = (input: PageBody) =>
  pagePayload(input, "messenger")
export const instagramPayload = (input: PageBody) =>
  pagePayload(input, "instagram")

export const WHATSAPP_WINDOW_CLOSED =
  "The 24-hour customer service window is closed. Send an approved template instead."
type ChannelMessageType = WhatsAppSendType | "button" | "unsupported"
type PreparedMessage = {
  payload: Record<string, unknown>
  to: string
  type: ChannelMessageType
  preview: string
}
type ChannelStrategy = {
  readReceipt: (
    externalId: string,
    recipient: string
  ) => Record<string, unknown>
  typing: (
    recipient: string,
    on: boolean,
    externalId: string
  ) => Record<string, unknown> | null
  build: (body: Record<string, unknown> & { to?: string }) => PreparedMessage
  assertWindow: (
    payload: Record<string, unknown>,
    windowExpiresAt: number | undefined,
    now: number
  ) => void
  endpoint: (account: { externalId: string; pageId?: string }) => string
  windowErrorCode: number
  notFoundLabel: string
  inactiveLabel: string
  requiresRegistration: boolean
  replyContext: (externalId: string) => Record<string, unknown>
  replyBody: (text: string) => Record<string, unknown>
  mediaData: (
    payload: Record<string, unknown>,
    type: string
  ) => Record<string, unknown>
  identity: (recipient: string) => { phone?: string; userId?: string }
  rate: (account: { pageId?: string; throughputMps: number; _id: string }) => {
    key: string
    rate: number
    mediaRate?: number
  }
}
function pageStrategy(
  channel: PageChannel,
  build: typeof messengerPayload
): ChannelStrategy {
  const definition = CHANNELS[channel]
  const accountLabel = `${definition.label} ${definition.accountNoun.toLowerCase()}`
  return {
    // Meta requires recipient + sender_action only, in separate requests.
    // Official docs verified 2026-10-01:
    // https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/sender-actions.md
    // https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/sender-actions.md
    readReceipt: (_, recipient) => ({
      recipient: { id: recipient },
      sender_action: "mark_seen",
    }),
    typing: (recipient, on) => ({
      recipient: { id: recipient },
      sender_action: on ? "typing_on" : "typing_off",
    }),
    build: (body) => {
      const payload = build(body as PageBody),
        message = payload.message
      const type =
        message.text !== undefined
          ? "text"
          : message.attachment?.type === "file"
            ? "document"
            : (message.attachment?.type as "image" | "audio" | "video")
      return {
        payload,
        to: payload.recipient.id,
        type,
        preview: (message.text ?? `[${type}]`).slice(0, 1000),
      }
    },
    assertWindow: (payload, until, now) => {
      payload.messaging_type = pageMessagingType(until, payload.tag, now)
    },
    endpoint: (account) => account.pageId ?? account.externalId,
    windowErrorCode: 2018278,
    notFoundLabel: accountLabel,
    inactiveLabel: `The ${accountLabel} must have an active Meta connection.`,
    requiresRegistration: definition.supports.registration,
    replyContext: (mid) => ({ reply_to: { mid } }),
    replyBody: (text) => ({ text }),
    mediaData: (payload) =>
      record(record(record(payload.message).attachment).payload),
    identity: () => ({}),
    rate: (account) => ({
      key: account.pageId ? `page:${account.pageId}` : account._id,
      rate: Math.max(
        1,
        account.pageId
          ? Math.min(300, account.throughputMps)
          : account.throughputMps
      ),
      ...(account.pageId ? { mediaRate: 10 } : {}),
    }),
  }
}
/** Keep channel-specific wire shape, window rules and endpoints behind one adapter. */
export const channelStrategies: Record<MessagingChannel, ChannelStrategy> = {
  whatsapp: {
    readReceipt: (message_id) => ({
      messaging_product: "whatsapp",
      status: "read",
      message_id,
    }),
    typing: (_, on, message_id) =>
      on
        ? {
            messaging_product: "whatsapp",
            status: "read",
            message_id,
            typing_indicator: { type: "text" },
          }
        : null,
    build: (body) => {
      const payload = whatsappPayload(body as WhatsAppBody),
        data = payload[payload.type] as Record<string, unknown>
      return {
        payload,
        to: payload.to ?? payload.recipient!,
        type: payload.type,
        preview: (payload.type === "text"
          ? String(data.body)
          : payload.type === "template"
            ? `[template: ${String(data.name)}]`
            : typeof data.caption === "string"
              ? data.caption
              : `[${payload.type}]`
        ).slice(0, 1000),
      }
    },
    assertWindow: (payload, until, now) => {
      if (payload.type !== "template" && (until ?? 0) <= now)
        throw new Error(WHATSAPP_WINDOW_CLOSED)
    },
    endpoint: (account) => account.externalId,
    windowErrorCode: 131047,
    notFoundLabel: `${CHANNELS.whatsapp.label} ${CHANNELS.whatsapp.idLabel.replace(/ ID$/, "").toLowerCase()}`,
    inactiveLabel:
      "The WhatsApp phone number must be active and registered with an active Meta connection.",
    requiresRegistration: CHANNELS.whatsapp.supports.registration,
    replyContext: (message_id) => ({ context: { message_id } }),
    replyBody: (body) => ({ type: "text", text: { body } }),
    mediaData: (payload, type) => record(payload[type]),
    identity: (recipient) => {
      const phone = normalizePhone(fromWaId(recipient))
      return phone ? { phone } : { userId: recipient }
    },
    rate: (account) => ({
      key: account._id,
      rate: Math.max(1, account.throughputMps),
    }),
  },
  messenger: pageStrategy("messenger", messengerPayload),
  instagram: pageStrategy("instagram", instagramPayload),
}
