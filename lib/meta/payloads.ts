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
