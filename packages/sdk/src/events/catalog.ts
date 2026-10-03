import {
  whatsappNormalizedSchema,
  whatsappReceiveContentSchemas,
  type WhatsAppSchema,
} from "../whatsapp/schema"
export const SYSTEM_EVENT_NAMES = [
  "call.data_collected",
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
  "email.received",
  "email.failed",
  "email.scheduled",
  "email.suppressed",
  "whatsapp.call.ivr_completed",
  "whatsapp.call.ringing",
  "whatsapp.call.connected",
  "whatsapp.call.completed",
  "whatsapp.call.failed",
  "whatsapp.call.missed",
  "whatsapp.call.permission_updated",
  "whatsapp.call.recording_ready",
  "whatsapp.call.transcription_ready",
  "whatsapp.call.bot_completed",
  "whatsapp.call.transferred",
  "whatsapp.message.sent",
  "whatsapp.message.delivered",
  "whatsapp.message.read",
  "whatsapp.message.played",
  "whatsapp.message.payment_updated",
  "whatsapp.message.failed",
  "whatsapp.message.received",
  "messenger.message.sent",
  "messenger.message.delivered",
  "messenger.message.read",
  "messenger.message.failed",
  "messenger.message.received",
  "instagram.message.sent",
  "instagram.message.read",
  "instagram.message.failed",
  "instagram.message.received",
  "whatsapp.message.read_receipt_sent",
  "whatsapp.message.read_receipt_failed",
  "whatsapp.message.typing_failed",
  "messenger.message.read_receipt_sent",
  "messenger.message.read_receipt_failed",
  "messenger.message.typing_failed",
  "instagram.message.read_receipt_sent",
  "instagram.message.read_receipt_failed",
  "instagram.message.typing_failed",
  "whatsapp.template.status_updated",
  "whatsapp.phone_number.updated",
  "contact.created",
  "contact.note_created",
  "contact.updated",
  "contact.deleted",
  "domain.created",
  "domain.updated",
  "domain.deleted",
  "suppression.added",
  "suppression.removed",
] as const

export type SystemEventName = (typeof SYSTEM_EVENT_NAMES)[number]
/** Events whose automation trigger is their own name, without the `opensend:` prefix. */
const UNPREFIXED_TRIGGERS = ["contact.note_created", "call.data_collected"] as const
type UnprefixedTrigger = (typeof UNPREFIXED_TRIGGERS)[number]
export type SystemTriggerName =
  | `opensend:${Exclude<SystemEventName, UnprefixedTrigger>}`
  | UnprefixedTrigger
export type CallDataCollected = {
  call_id: string
  contact_id: string | null
  collected: Record<
    string,
    { value: string | number | boolean; inferred: boolean }
  >
  missing: string[]
}
export type EventField = {
  type: "string" | "number" | "boolean" | "date" | "enum" | "object" | "array"
  description: string
  example: unknown
  nullable?: boolean
  optional?: boolean
  values?: readonly string[]
  fields?: Record<string, EventField>
  items?: EventField
  additionalProperties?: EventField
  /** Provider-defined JSON: leaves may be scalars, objects or arrays. */
  dynamic?: boolean
  valueTypes?: EventField["type"][]
}
export type CatalogEvent = {
  name: string
  trigger: SystemTriggerName | (string & {})
  label: string
  group: string
  description: string
  schema: EventField
}
const label = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ")
export const field = (
  type: EventField["type"],
  description: string,
  example: unknown,
  extra: Partial<EventField> = {}
): EventField => ({ type, description, example, ...extra })
const str = (key: string, example = "example") =>
  field("string", label(key), example, { nullable: true, optional: true })
const num = (key: string) =>
  field("number", label(key), 1, { nullable: true, optional: true })
const date = (key: string) =>
  field("date", label(key), "2026-10-02T12:00:00.000Z", {
    nullable: true,
    optional: true,
  })
export const object = (
  fields: Record<string, EventField>,
  description = "Payload"
): EventField =>
  field("object", description, {}, { fields, optional: true, nullable: true })
const arr = (items: EventField, description: string) =>
  field("array", description, [], { items, optional: true })
const strings = (...keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, str(key)]))
const numbers = (...keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, num(key)]))
const dates = (...keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, date(key)]))
const dynamic = (description: string) =>
  field(
    "object",
    description,
    {},
    {
      optional: true,
      nullable: true,
      dynamic: true,
    }
  )
export const CONTACT_SCHEMA = object(
  {
    ...strings("id", "email", "phone", "first_name", "last_name"),
    ...dates("created_at", "updated_at"),
    unsubscribed: field("boolean", "Whether the contact opted out", false),
    segment_ids: arr(str("Segment id"), "Contact segments"),
    properties: object({}, "Team contact properties"),
  },
  "Contact"
)
const media = object({
  ...strings(
    "id",
    "mime_type",
    "sha256",
    "caption",
    "filename",
    "url",
    "download_url",
    "content_type",
    "error",
    "content_disposition",
    "content_id",
    "fileId",
    "storageId",
    "contentType"
  ),
  ...numbers("size"),
  voice: field("boolean", "Voice note", false, { optional: true }),
  animated: field("boolean", "Animated media", false, { optional: true }),
  ...dates("expires_at"),
})
/** Derive the nested WhatsApp fields from its existing wire contract. Union
 * alternatives stay typed; the picker also sees their combined field tree. */
function groupFields(entries: [string, EventField][]) {
  const grouped = new Map<string, [string, EventField][]>()
  for (const entry of entries)
    grouped.set(entry[0], [...(grouped.get(entry[0]) ?? []), entry])
  return grouped
}
function fromWireSchema(
  schema: WhatsAppSchema,
  description: string
): EventField {
  const variants = (schema.oneOf ?? schema.anyOf ?? []).map((variant) =>
    fromWireSchema(variant, description)
  )
  const ownFields = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, child]) => [
      name,
      fromWireSchema(child, label(name)),
    ])
  )
  const types = new Set(variants.map((variant) => variant.type))
  const type = schema.type ?? (types.size === 1 ? variants[0]?.type : undefined)
  const values = schema.enum?.filter(
    (value): value is string => typeof value === "string"
  )
  const result = field(
    values?.length
      ? "enum"
      : type === "integer"
        ? "number"
        : ["string", "number", "boolean", "array", "object", "enum"].includes(
              type ?? ""
            )
          ? (type as EventField["type"])
          : "object",
    description,
    values?.[0] ??
      (type === "number" || type === "integer"
        ? 1
        : type === "boolean"
          ? false
          : type === "array"
            ? []
            : type === "string"
              ? "example"
              : {}),
    {
      optional: true,
      nullable: true,
      ...(values?.length ? { values } : {}),
      ...(types.size > 1 ? { valueTypes: [...types] } : {}),
      ...(schema.items
        ? { items: fromWireSchema(schema.items, `${description} item`) }
        : {}),
    }
  )
  const entries = [
    ...variants.flatMap((variant) => Object.entries(variant.fields ?? {})),
    ...Object.entries(ownFields),
  ]
  const grouped = groupFields(entries)
  const fields = Object.fromEntries(
    [...grouped].map(([key, entries]) => {
      if (entries.length === 1) return [key, entries[0][1]]
      const alternatives = entries.map((entry) => entry[1])
      return [key, mergeAlternatives(alternatives, label(key))]
    })
  )
  if (Object.keys(fields).length) result.fields = fields
  const variantItems = variants.find((variant) => variant.items)?.items
  if (!result.items && variantItems) result.items = variantItems
  if (!type || (type === "object" && !Object.keys(fields).length))
    result.dynamic = true
  return result
}
function mergeAlternatives(
  variants: EventField[],
  description: string
): EventField {
  const fields = Object.fromEntries(
    [
      ...groupFields(
        variants.flatMap((variant) => Object.entries(variant.fields ?? {}))
      ),
    ].map(([key, entries]) => [
      key,
      entries.length === 1
        ? entries[0][1]
        : mergeAlternatives(
            entries.map((entry) => entry[1]),
            label(key)
          ),
    ])
  )
  const types = new Set(variants.map((variant) => variant.type))
  const merged: EventField = {
    ...variants[0],
    description,
    ...(types.size > 1 ? { valueTypes: [...types] } : {}),
    ...(types.size > 1 || variants.some((variant) => variant.dynamic)
      ? { dynamic: true }
      : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(variants.find((variant) => variant.items)?.items
      ? { items: variants.find((variant) => variant.items)!.items }
      : {}),
    ...(types.has("enum") && types.has("string") && types.size === 2
      ? { type: "string", dynamic: false }
      : {}),
    ...(variants.every((variant) => variant.type === "enum")
      ? {
          values: [
            ...new Set(variants.flatMap((variant) => variant.values ?? [])),
          ],
        }
      : {}),
  }
  if (merged.type === "string") delete merged.values
  return merged
}
const whatsappFields = Object.fromEntries(
  Object.entries(whatsappReceiveContentSchemas).map(([name, schema]) => [
    name,
    fromWireSchema(schema, label(name)),
  ])
)
const normalizedFields =
  fromWireSchema(whatsappNormalizedSchema, "Normalized WhatsApp message")
    .fields ?? {}
/** The base shape every message event shares across channels (the unified /messages object). */
const messageBase = {
  ...strings("id", "object", "contact_id", "channel", "status", "preview"),
  direction: field("enum", "Message direction", "inbound", {
    values: ["inbound", "outbound"],
  }),
}
const message = object({
  ...messageBase,
  ...strings(
    "account_id",
    "conversation_id",
    "from",
    "to",
    "type",
    "external_id",
    "text",
    "biz_opaque_callback_data",
    "reaction_target_id"
  ),
  status: field("enum", "Message status", "received", {
    values: [
      "queued",
      "sent",
      "delivered",
      "read",
      "played",
      "failed",
      "received",
    ],
    optional: true,
  }),
  ...dates("created_at", "read_receipt_sent_at", "revoked_at"),
  content: {
    ...object(
      {
        ...strings(
          "body",
          "text",
          "payload",
          "id",
          "caption",
          "filename",
          "url",
          "emoji",
          "message_id"
        ),
        ...numbers("latitude", "longitude"),
      },
      "Normalized message content"
    ),
    dynamic: true,
  },
  context: dynamic("Reply context"),
  referral: dynamic("Message referral"),
  identity: object(
    strings(
      "wa_id",
      "user_id",
      "parent_user_id",
      "username",
      "identity_key_hash"
    )
  ),
  media,
  ...Object.fromEntries(
    ["image", "audio", "video", "document", "sticker"].map((key) => [
      key,
      media,
    ])
  ),
  attachments: arr(media, "Attachments"),
  tags: arr(object(strings("name", "value")), "Message tags"),
  reactions: arr(
    object({
      ...strings("id", "external_id", "from", "emoji"),
      ...dates("created_at"),
    }),
    "Reactions"
  ),
  error: object({ ...strings("message", "title"), code: num("code") }),
  errors: arr(
    object({ ...strings("message", "title"), code: num("code") }),
    "Provider errors"
  ),
  location: object({
    ...numbers("latitude", "longitude"),
    ...strings("name", "address"),
  }),
  reaction: object(strings("emoji", "message_id")),
  button: object(strings("text", "payload")),
  quick_reply: object(strings("payload")),
  quick_replies: arr(
    object(strings("content_type", "title", "payload")),
    "Quick replies"
  ),
  contacts: arr(dynamic("Shared contact"), "Shared contacts"),
  rendered: object({
    ...strings("header", "body", "footer"),
    buttons: arr(dynamic("Button"), "Rendered buttons"),
  }),
  ...Object.fromEntries(
    [
      "raw",
      "send_response",
      "status_raw",
      "payment",
      "pricing",
      "conversation",
      "template",
      "interactive",
      "order",
      "system",
      "unsupported",
      "edit",
      "revoke",
    ].map((key) => [key, dynamic(label(key))])
  ),
})
const call = object({
  ...strings(
    "object",
    "id",
    "account_id",
    "wacid",
    "direction",
    "status",
    "handling_mode",
    "user_id",
    "from",
    "to",
    "contact_id",
    "contact_name",
    "contact_phone",
    "conversation_id",
    "biz_opaque_callback_data",
    "cta_payload",
    "deeplink_payload",
    "error",
    "assigned_agent",
    "ivr_id",
    "bot_id",
    "bot_name",
    "bot_outcome",
    "bot_summary",
    "bot_fallback_reason"
  ),
  ...numbers(
    "observed_at",
    "connected_at",
    "ended_at",
    "duration",
    "error_code",
    "bot_duration"
  ),
  ...dates("created_at"),
  test: field("boolean", "Test call", false),
  session: object(strings("sdp", "sdp_type")),
  recording: media,
  transcription: media,
  ivr_path: arr(
    object({
      ...strings("menuId", "digits"),
      at: num("at"),
      action: dynamic("IVR action"),
    }),
    "IVR path"
  ),
  ivr_outcome: dynamic("IVR outcome"),
  bot_usage: {
    ...object(
      numbers("inputTokens", "outputTokens", "audioSeconds", "ttsCharacters")
    ),
    nullable: true,
  },
})
const email = object({
  ...messageBase,
  ...strings(
    "email_id",
    "broadcast_id",
    "from",
    "subject",
    "template_id",
    "message_id"
  ),
  ...dates("created_at", "scheduled_at"),
  ...Object.fromEntries(
    ["to", "cc", "bcc", "received_for"].map((key) => [
      key,
      arr(str("Email address", "ada@example.com"), label(key)),
    ])
  ),
  tags: dynamic("Email tags"),
  attachments: arr(media, "Attachments"),
  click: object({
    ...strings("link", "ipAddress", "userAgent"),
    ...dates("timestamp"),
  }),
  ...Object.fromEntries(
    ["bounce", "complaint", "delivery_delayed", "suppressed", "failed"].map(
      (key) => [key, dynamic(label(key))]
    )
  ),
})
function schemaFor(name: SystemEventName): EventField {
  if (name.startsWith("email.")) return email
  if (name.endsWith("ivr_completed"))
    return object({
      ...strings("id", "account_id", "ivr_id", "contact_id"),
      path: call.fields!.ivr_path,
      final_action: dynamic("Final IVR action"),
    })
  if (name.endsWith("permission_updated"))
    return object({
      ...strings("account_id", "user_id", "response_source", "context_id"),
      permission: object({
        ...strings("status"),
        expiration_time: num("expiration_time"),
      }),
    })
  if (name.includes(".call.")) return call
  if (/read_receipt|typing_failed/.test(name))
    return object({
      ...strings("id", "conversation_id", "error"),
      ...dates("read_receipt_sent_at"),
    })
  if (name.includes(".message."))
    return name.startsWith("whatsapp.")
      ? object({
          ...message.fields,
          ...whatsappFields,
          ...normalizedFields,
          text: message.fields!.text,
          raw: dynamic("Original provider message"),
        })
      : message
  if (name === "call.data_collected")
    return object({
      ...strings("call_id", "contact_id"),
      collected: field("object", "Collected fields by key", {}, {
        optional: true,
        additionalProperties: object(
          {
            value: field("string", "Collected value", "example", {
              valueTypes: ["string", "number", "boolean"],
            }),
            inferred: field("boolean", "Whether the bot inferred the value", false),
          },
          "Collected field"
        ),
      }),
      missing: arr(str("key"), "Required fields the caller did not provide"),
    })
  if (name === "contact.note_created")
    return object({
      ...strings("object", "id", "contact_id", "body"),
      author: object({
        kind: field("enum", "Note author kind", "api", {
          values: ["user", "bot", "api"],
        }),
        ...strings("id", "name"),
      }),
      source: {
        ...object(strings("call_id", "conversation_id", "message_id")),
        nullable: true,
      },
      ...dates("created_at", "updated_at"),
      contact: { ...CONTACT_SCHEMA, optional: true, nullable: true },
    })
  if (name.startsWith("contact.")) return CONTACT_SCHEMA
  if (name.startsWith("domain."))
    return object({
      ...strings("id", "name", "status", "region"),
      ...dates("created_at"),
      capabilities: object(strings("sending", "receiving")),
      records: arr(
        object({
          ...strings("record", "name", "type", "value", "status"),
          ttl: str("ttl", "300"),
          ...numbers("priority"),
        }),
        "DNS records"
      ),
    })
  if (name.startsWith("suppression."))
    return object({
      ...strings("id", "email", "origin", "source_id"),
      ...dates("created_at"),
    })
  return object({
    ...strings(
      "id",
      "contact_id",
      "channel",
      "account_id",
      "waba_id",
      "field",
      "template_id",
      "event",
      "message_template_name",
      "message_template_language",
      "reason",
      "display_phone_number",
      "quality_rating",
      "handling_mode"
    ),
    ...numbers("message_template_id"),
    ...Object.fromEntries(
      ["ban_info", "decision", "phone_number", "restriction_info"].map(
        (key) => [key, dynamic(label(key))]
      )
    ),
    calling: dynamic("Calling settings"),
    routing: dynamic("Call routing"),
  })
}
export const SYSTEM_EVENT_CATALOG: readonly CatalogEvent[] =
  SYSTEM_EVENT_NAMES.map((name) => ({
    name,
    trigger: (UNPREFIXED_TRIGGERS as readonly string[]).includes(name)
      ? name
      : `opensend:${name}`,
    group:
      name.startsWith("whatsapp.call.") || name.startsWith("call.")
        ? "WhatsApp calls"
      : (
          {
            email: "Email",
            whatsapp: "WhatsApp messages",
            messenger: "Messenger",
            instagram: "Instagram",
            contact: "Contacts",
            domain: "Domains",
            suppression: "Suppressions",
          } as Record<string, string>
        )[name.split(".")[0]],
    label: `${({ email: "Email", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", contact: "Contact", call: "Call", domain: "Domain", suppression: "Suppression" } as Record<string, string>)[name.split(".")[0]]} ${label(name.split(".").slice(1).join(" "))}`,
    description: `Emitted when ${label(name.replace(/\./g, " "))}.`,
    schema: object({
      ...schemaFor(name).fields,
      ...(name.includes(".message.") ||
      name.includes(".call.") ||
      name.startsWith("call.") ||
      name.startsWith("email.") ||
      name.startsWith("contact.")
        ? {
            contact: { ...CONTACT_SCHEMA, nullable: true, optional: true },
            ...(name.includes(".message.") || name.startsWith("email.")
              ? { message: schemaFor(name) }
              : {}),
          }
        : {}),
    }),
  }))
