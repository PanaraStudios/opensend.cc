/** Cloud API wire shapes, checked against Meta's Messages Object and examples:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview#parameter-formats
 */
export const WHATSAPP_SEND_TYPES = [
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
export type WhatsAppSendType = (typeof WHATSAPP_SEND_TYPES)[number]
export type WhatsAppBody = {
  to: string
  type?: WhatsAppSendType
  reply_to?: string
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
function optionalText(
  source: Record<string, unknown>,
  key: string,
  max: number
) {
  return source[key] === undefined ? {} : { [key]: text(source[key], key, max) }
}
function media(value: unknown, type: string) {
  const body = object(value, type)
  if ((body.id === undefined) === (body.link === undefined))
    throw new Error(
      `Provide exactly one of \`${type}.id\` or \`${type}.link\`.`
    )
  const result: Record<string, unknown> =
    body.id !== undefined
      ? { id: text(body.id, `${type}.id`, 256) }
      : { link: text(body.link, `${type}.link`, 4096) }
  if (result.link) {
    const url = new URL(result.link as string)
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Media links must use HTTP or HTTPS without credentials.")
  }
  if (
    body.caption !== undefined &&
    !["image", "video", "document"].includes(type)
  )
    throw new Error(`\`${type}\` does not support captions.`)
  if (body.filename !== undefined && type !== "document")
    throw new Error("Only documents support filename.")
  return {
    ...result,
    ...optionalText(body, "caption", 1024),
    ...optionalText(body, "filename", 255),
  }
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
    components = template.components.map((raw) => {
      const component = object(raw, "template component")
      if (!["header", "body", "button"].includes(String(component.type)))
        throw new Error("Invalid template component type.")
      if (!Array.isArray(component.parameters))
        throw new Error("Template parameters must be an array.")
      for (const rawParameter of component.parameters) {
        const parameter = object(rawParameter, "template parameter")
        if (
          ![
            "text",
            "currency",
            "date_time",
            "image",
            "document",
            "video",
            "payload",
            "action",
          ].includes(String(parameter.type))
        )
          throw new Error("Invalid template parameter type.")
        if (parameter.type === "text")
          text(parameter.text, "parameter.text", 32768)
      }
      return component
    })
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
function interactive(value: unknown) {
  const body = object(value, "interactive")
  if (body.type !== "button" && body.type !== "list")
    throw new Error("Interactive type must be button or list.")
  const content = {
    text: text(
      object(body.body, "interactive.body").text,
      "interactive.body.text",
      body.type === "list" ? 4096 : 1024
    ),
  }
  const action = object(body.action, "interactive.action")
  let output: Record<string, unknown>
  if (body.type === "button") {
    if (
      !Array.isArray(action.buttons) ||
      action.buttons.length < 1 ||
      action.buttons.length > 3
    )
      throw new Error("Interactive buttons must contain 1 to 3 replies.")
    const ids = new Set<string>()
    output = {
      buttons: action.buttons.map((raw) => {
        const button = object(raw, "button"),
          reply = object(button.reply, "button.reply")
        if (button.type !== "reply")
          throw new Error("Interactive buttons must be reply buttons.")
        const id = text(reply.id, "reply.id", 256)
        if (ids.has(id)) throw new Error("Reply ids must be unique.")
        ids.add(id)
        return {
          type: "reply",
          reply: { id, title: text(reply.title, "reply.title", 20) },
        }
      }),
    }
  } else {
    if (
      !Array.isArray(action.sections) ||
      action.sections.length < 1 ||
      action.sections.length > 10
    )
      throw new Error("Interactive lists must contain 1 to 10 sections.")
    let count = 0
    const ids = new Set<string>()
    output = {
      button: text(action.button, "list.button", 20),
      sections: action.sections.map((raw) => {
        const section = object(raw, "section")
        if (!Array.isArray(section.rows) || !section.rows.length)
          throw new Error("List sections need rows.")
        count += section.rows.length
        if (count > 10)
          throw new Error("Interactive lists allow at most 10 rows.")
        return {
          ...optionalText(section, "title", 24),
          rows: section.rows.map((raw) => {
            const row = object(raw, "row"),
              id = text(row.id, "row.id", 200)
            if (ids.has(id)) throw new Error("List row ids must be unique.")
            ids.add(id)
            return {
              id,
              title: text(row.title, "row.title", 24),
              ...optionalText(row, "description", 72),
            }
          }),
        }
      }),
    }
  }
  let header
  if (body.header !== undefined) {
    const source = object(body.header, "interactive.header")
    if (source.type === "text")
      header = { type: "text", text: text(source.text, "header.text", 60) }
    else if (
      body.type === "button" &&
      ["image", "video", "document"].includes(String(source.type))
    )
      header = {
        type: source.type,
        [String(source.type)]: media(
          source[String(source.type)],
          String(source.type)
        ),
      }
    else throw new Error("Unsupported interactive header.")
  }
  return {
    type: body.type,
    body: content,
    action: output,
    ...(header ? { header } : {}),
    ...(body.footer !== undefined
      ? {
          footer: {
            text: text(object(body.footer, "footer").text, "footer.text", 60),
          },
        }
      : {}),
  }
}

/** Validate before enqueueing and build only Cloud API fields. */
export function whatsappPayload(input: WhatsAppBody): Record<
  string,
  unknown
> & {
  messaging_product: "whatsapp"
  recipient_type: "individual"
  to: string
  type: WhatsAppSendType
  context?: { message_id: string }
} {
  if (typeof input.to !== "string" || !/^\+?[1-9]\d{6,14}$/.test(input.to))
    throw new Error("The `to` field must be an E.164 phone number or wa_id.")
  const present = WHATSAPP_SEND_TYPES.filter(
    (type) => input[type] !== undefined
  )
  if (
    present.length !== 1 ||
    (input.type !== undefined && input.type !== present[0])
  )
    throw new Error(
      "Provide exactly one message body, matching `type` when specified."
    )
  const type = present[0]
  let body: unknown
  if (type === "text") {
    const source =
      typeof input.text === "string"
        ? { body: input.text }
        : object(input.text, "text")
    if (
      source.preview_url !== undefined &&
      typeof source.preview_url !== "boolean"
    )
      throw new Error("text.preview_url must be a boolean.")
    body = {
      body: text(source.body, "text.body"),
      ...(source.preview_url !== undefined
        ? { preview_url: source.preview_url }
        : {}),
    }
  } else if (type === "template") body = templatePayload(input.template)
  else if (["image", "video", "audio", "document", "sticker"].includes(type))
    body = media(input[type], type)
  else if (type === "interactive") body = interactive(input.interactive)
  else if (type === "location") {
    const source = object(input.location, "location")
    for (const [key, max] of [
      ["latitude", 90],
      ["longitude", 180],
    ] as const)
      if (
        typeof source[key] !== "number" ||
        !Number.isFinite(source[key]) ||
        Math.abs(source[key]) > max
      )
        throw new Error(`Invalid location ${key}.`)
    body = {
      latitude: source.latitude,
      longitude: source.longitude,
      ...optionalText(source, "name", 1000),
      ...optionalText(source, "address", 1000),
    }
  } else {
    const source = object(input.reaction, "reaction")
    body = {
      message_id: text(source.message_id, "reaction.message_id", 1024),
      emoji: text(source.emoji, "reaction.emoji", 16, true),
    }
  }
  return {
    messaging_product: "whatsapp" as const,
    recipient_type: "individual" as const,
    to: input.to.replace(/^\+/, ""),
    type,
    [type]: body,
    ...(input.reply_to !== undefined
      ? { context: { message_id: text(input.reply_to, "reply_to", 1024) } }
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
  channel: "messenger" | "instagram"
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
    message.quick_replies = quickReplies(input.quick_replies).map((reply) => ({
      content_type: "text",
      ...reply,
    }))
  }
  return message
}
function pagePayload(input: PageBody, channel: "messenger" | "instagram") {
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
  build: (body: Record<string, unknown> & { to: string }) => PreparedMessage
  assertWindow: (
    payload: Record<string, unknown>,
    windowExpiresAt: number | undefined,
    now: number
  ) => void
  endpoint: (account: { externalId: string; pageId?: string }) => string
  windowErrorCode: number
}
function pageStrategy(build: typeof messengerPayload): ChannelStrategy {
  return {
    build: (body) => {
      const payload = build(body),
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
  }
}
/** Keep channel-specific wire shape, window rules and endpoints behind one adapter. */
export const channelStrategies: Record<
  "whatsapp" | "messenger" | "instagram",
  ChannelStrategy
> = {
  whatsapp: {
    build: (body) => {
      const payload = whatsappPayload(body as WhatsAppBody),
        data = payload[payload.type] as Record<string, unknown>
      return {
        payload,
        to: payload.to,
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
  },
  messenger: pageStrategy(messengerPayload),
  instagram: pageStrategy(instagramPayload),
}
