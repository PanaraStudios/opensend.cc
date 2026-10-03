import { WHATSAPP_SEND_TYPES } from "./catalog"

/** A dependency-free subset of JSON Schema, also consumed by MCP/OpenAPI. */
export type WhatsAppSchema = {
  type?: string
  properties?: Record<string, WhatsAppSchema>
  required?: string[]
  additionalProperties?: boolean | WhatsAppSchema
  items?: WhatsAppSchema
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  enum?: readonly unknown[]
  oneOf?: WhatsAppSchema[]
  anyOf?: WhatsAppSchema[]
  pattern?: string
}
const str = (maxLength?: number): WhatsAppSchema => ({
  type: "string",
  minLength: 1,
  ...(maxLength ? { maxLength } : {}),
})
const obj = (
  properties: Record<string, WhatsAppSchema>,
  required = Object.keys(properties)
): WhatsAppSchema => ({ type: "object", properties, required })
const arr = (
  items: WhatsAppSchema,
  maxItems?: number,
  minItems = 1
): WhatsAppSchema => ({
  type: "array",
  items,
  minItems,
  ...(maxItems ? { maxItems } : {}),
})
const choice = (...values: string[]): WhatsAppSchema => ({
  type: "string",
  enum: values,
})
const num = (minimum?: number, maximum?: number): WhatsAppSchema => ({
  type: "number",
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
})
const integer = (minimum?: number, maximum?: number): WhatsAppSchema => ({
  type: "integer",
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
})
const freeObject: WhatsAppSchema = { type: "object" }
const url = { ...str(), pattern: "^https?://" }
export const whatsappMediaSchema = obj({ id: str(), link: url }, [])
whatsappMediaSchema.oneOf = [
  obj({ id: str(), link: url }, ["id"]),
  obj({ id: str(), link: url }, ["link"]),
]
const media = (extra: Record<string, WhatsAppSchema> = {}) => ({
  ...whatsappMediaSchema,
  properties: { ...whatsappMediaSchema.properties, ...extra },
})
const location = obj(
  {
    latitude: num(-90, 90),
    longitude: num(-180, 180),
    name: str(),
    address: str(),
    url,
  },
  ["latitude", "longitude"]
)
const product = obj({ catalog_id: str(), product_retailer_id: str() })
const productSections = arr(
  obj(
    {
      title: str(24),
      product_items: arr(obj({ product_retailer_id: str() }), 30),
    },
    ["product_items"]
  ),
  10
)
const amount = obj({ value: integer(0), offset: integer(1) })
const orderStatus = obj(
  {
    reference_id: str(60),
    order: obj(
      {
        status: choice(
          "processing",
          "partially_shipped",
          "shipped",
          "completed",
          "canceled"
        ),
        description: str(),
      },
      ["status"]
    ),
    payment: freeObject,
  },
  ["reference_id", "order"]
)
const orderDetails = obj(
  {
    reference_id: str(60),
    type: choice("digital-goods", "physical-goods"),
    payment_type: str(),
    payment_settings: arr(freeObject),
    currency: str(),
    total_amount: amount,
    order: obj(
      {
        status: str(),
        catalog_id: str(),
        expiration: freeObject,
        items: arr(
          obj(
            {
              retailer_id: str(),
              name: str(60),
              amount,
              quantity: integer(1),
              sale_amount: amount,
            },
            ["name", "amount", "quantity"]
          )
        ),
        subtotal: amount,
        tax: amount,
        shipping: amount,
        discount: amount,
      },
      ["status", "items", "subtotal", "tax"]
    ),
  },
  [
    "reference_id",
    "type",
    "payment_type",
    "payment_settings",
    "currency",
    "total_amount",
  ]
)
const contact = obj(
  {
    name: obj(
      {
        formatted_name: str(),
        first_name: str(),
        last_name: str(),
        middle_name: str(),
        suffix: str(),
        prefix: str(),
      },
      ["formatted_name"]
    ),
    phones: arr(obj({ phone: str(), type: str(), wa_id: str() }, [])),
    emails: arr(obj({ email: str(), type: str() }, [])),
    addresses: arr(
      obj(
        Object.fromEntries(
          [
            "street",
            "city",
            "state",
            "zip",
            "country",
            "country_code",
            "type",
          ].map((k) => [k, str()])
        ),
        []
      )
    ),
    org: obj({ company: str(), department: str(), title: str() }, []),
    urls: arr(obj({ url: str(), type: str() }, [])),
    birthday: { ...str(), pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    origin: str(),
    vcard: str(),
  },
  ["name"]
)
const header = (
  types = ["text", "image", "video", "document"],
  maxText: number | null = 60
): WhatsAppSchema => ({
  oneOf: types.map((type) =>
    obj(
      {
        type: choice(type),
        [type]: type === "text" ? str(maxText ?? undefined) : media(),
        sub_text: str(60),
      },
      ["type", type]
    )
  ),
})
const cta = obj({
  name: choice("cta_url"),
  parameters: obj({ display_text: str(20), url }),
})
const reply = (type = "reply") =>
  obj({ type: choice(type), [type]: obj({ id: str(256), title: str(20) }) })
const namedAction = (
  name: string,
  parameters?: WhatsAppSchema,
  required = true
) =>
  obj(
    { name: choice(name), ...(parameters ? { parameters } : {}) },
    parameters && required ? ["name", "parameters"] : ["name"]
  )
export const whatsappInteractiveActions: Record<string, WhatsAppSchema> = {
  button: obj({ buttons: arr(reply(), 3) }),
  list: obj({
    button: str(20),
    sections: arr(
      obj(
        {
          title: str(24),
          rows: arr(
            obj({ id: str(200), title: str(24), description: str(72) }, [
              "id",
              "title",
            ]),
            10
          ),
        },
        ["rows"]
      ),
      10
    ),
  }),
  cta_url: cta,
  carousel: obj({
    cards: arr(
      {
        oneOf: [
          obj({
            card_index: integer(0, 9),
            type: choice("product"),
            action: product,
          }),
          obj(
            {
              card_index: integer(0, 9),
              type: choice("cta_url"),
              header: header(["image", "video"]),
              body: obj({ text: str(160) }),
              action: {
                oneOf: [cta, obj({ buttons: arr(reply("quick_reply"), 2) })],
              },
            },
            ["card_index", "type", "header", "action"]
          ),
        ],
      },
      10,
      2
    ),
  }),
  flow: namedAction(
    "flow",
    obj(
      {
        flow_message_version: choice("3"),
        flow_token: str(),
        flow_id: str(),
        flow_name: str(),
        flow_cta: str(),
        mode: choice("draft", "published"),
        flow_action: choice("navigate", "data_exchange"),
        flow_action_payload: obj({ screen: str(), data: freeObject }, []),
      },
      ["flow_message_version", "flow_token", "flow_cta"]
    )
  ),
  location_request_message: namedAction("send_location"),
  address_message: namedAction(
    "address_message",
    obj(
      {
        country: choice("IN"),
        values: freeObject,
        saved_addresses: arr(freeObject),
        validation_errors: freeObject,
      },
      ["country"]
    )
  ),
  voice_call: namedAction(
    "voice_call",
    obj({ display_text: str(), ttl_minutes: integer(1), payload: str() }, []),
    false
  ),
  call_permission_request: namedAction("call_permission_request"),
  request_contact_info: namedAction("request_contact_info"),
  catalog_message: namedAction(
    "catalog_message",
    obj({ thumbnail_product_retailer_id: str() }, []),
    false
  ),
  product,
  product_list: obj({ catalog_id: str(), sections: productSections }),
  order_details: namedAction("review_and_pay", orderDetails),
  order_status: namedAction("review_order", orderStatus),
}
export const whatsappInteractiveSchema: WhatsAppSchema = {
  oneOf: Object.entries(whatsappInteractiveActions).map(([type, action]) =>
    obj(
      {
        type: choice(type),
        body: obj({ text: str(type === "list" ? 4096 : 1024) }),
        footer: obj({ text: str(60) }),
        header: header(
          type === "list" || type === "product_list"
            ? ["text"]
            : type === "order_details"
              ? ["image"]
              : undefined,
          type === "button" ? null : 60
        ),
        action,
      },
      [
        "type",
        "action",
        ...(["product", "catalog_message", "order_status"].includes(type)
          ? []
          : ["body"]),
        ...(type === "product_list" ? ["header"] : []),
      ]
    )
  ),
}
const parameterBodies: Record<string, WhatsAppSchema> = {
  text: str(),
  currency: obj({
    fallback_value: str(),
    code: str(),
    amount_1000: integer(0),
  }),
  date_time: obj({ fallback_value: str() }),
  image: media(),
  video: media(),
  document: media({ filename: str() }),
  location,
  product,
  payload: str(),
  action: obj(
    {
      flow_token: str(),
      flow_action_data: freeObject,
      thumbnail_product_retailer_id: str(),
      sections: productSections,
      order_details: orderDetails,
    },
    []
  ),
  coupon_code: str(20),
  ttl_minutes: integer(1),
  limited_time_offer: obj({ expiration_time_ms: integer(0) }),
  order_status: orderStatus,
}
export const whatsappTemplateParameterSchema: WhatsAppSchema = {
  oneOf: Object.entries(parameterBodies).map(([type, body]) =>
    obj({ type: choice(type), [type]: body, parameter_name: str() }, [
      "type",
      type,
    ])
  ),
}
const component = obj(
  {
    type: choice(
      "header",
      "body",
      "button",
      "limited_time_offer",
      "call_permission_request",
      "order_status"
    ),
    parameters: arr(whatsappTemplateParameterSchema, undefined, 0),
    sub_type: choice(
      "quick_reply",
      "url",
      "copy_code",
      "flow",
      "CATALOG",
      "catalog",
      "mpm",
      "voice_call",
      "order_details"
    ),
    index: { oneOf: [{ type: "string", pattern: "^[0-9]$" }, integer(0, 9)] },
  },
  ["type", "parameters"]
)
export const whatsappTemplateComponentSchema: WhatsAppSchema = {
  oneOf: [
    component,
    obj({
      type: choice("carousel"),
      cards: arr(
        obj({ card_index: integer(0, 9), components: arr(component) }),
        10,
        2
      ),
    }),
  ],
}
export const whatsappTemplateSchema = obj(
  {
    id: str(),
    alias: str(),
    name: { ...str(512), pattern: "^[a-z0-9_]+$" },
    language: { oneOf: [str(32), obj({ code: str(32) })] },
    components: arr(whatsappTemplateComponentSchema, undefined, 0),
    variables: {
      type: "object",
      additionalProperties: { oneOf: [str(), num()] },
    },
  },
  []
)
whatsappTemplateSchema.anyOf = [
  {
    required: ["name", "language"],
    type: "object",
    properties: { name: str(), language: {} },
  },
  obj({ id: str() }),
  obj({ alias: str() }),
]
export const whatsappBodySchemas: Record<
  (typeof WHATSAPP_SEND_TYPES)[number],
  WhatsAppSchema
> = {
  text: {
    oneOf: [
      str(4096),
      obj({ body: str(4096), preview_url: { type: "boolean" } }, ["body"]),
    ],
  },
  template: whatsappTemplateSchema,
  image: media({ caption: str(1024) }),
  video: media({ caption: str(1024) }),
  audio: media({ voice: { type: "boolean" } }),
  document: media({ caption: str(1024), filename: str() }),
  sticker: media(),
  location,
  contacts: arr(contact, 257),
  interactive: whatsappInteractiveSchema,
  reaction: obj({ message_id: str(), emoji: { type: "string" } }),
}

export function validateWhatsAppSchema(
  schema: WhatsAppSchema,
  value: unknown,
  path: string
): void {
  const fail = (reason: string): never => {
    throw new Error(`${path}: ${reason}`)
  }
  let alternatives = schema.oneOf ?? schema.anyOf
  if (alternatives && value && typeof value === "object" && "type" in value) {
    const discriminator = (value as Record<string, unknown>).type
    const matching = alternatives.filter((s) =>
      s.properties?.type?.enum?.includes(discriminator)
    )
    if (matching.length) alternatives = matching
  }
  if (alternatives) {
    const errors: string[] = []
    const valid = alternatives.filter((s) => {
      try {
        validateWhatsAppSchema(s, value, path)
        return true
      } catch (e) {
        errors.push((e as Error).message)
        return false
      }
    }).length
    if (!valid || (schema.oneOf && valid !== 1))
      fail(errors.join("; ") || "provide exactly one alternative")
  }
  if (schema.enum && !schema.enum.includes(value))
    fail(`must be one of ${schema.enum.join(", ")}`)
  if (schema.type === "string") {
    if (typeof value !== "string") fail("must be a string")
    const text = value as string
    if (schema.minLength && !text.trim()) fail("must be nonempty")
    if (schema.maxLength && [...text].length > schema.maxLength)
      fail(`must be at most ${schema.maxLength} characters`)
    if (schema.pattern && !new RegExp(schema.pattern).test(text))
      fail("invalid format")
  } else if (schema.type === "number" || schema.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isInteger(value))
    )
      fail(`must be a finite ${schema.type}`)
    if (schema.minimum !== undefined && (value as number) < schema.minimum)
      fail(`must be at least ${schema.minimum}`)
    if (schema.maximum !== undefined && (value as number) > schema.maximum)
      fail(`must be at most ${schema.maximum}`)
  } else if (schema.type === "boolean" && typeof value !== "boolean")
    fail("must be a boolean")
  else if (schema.type === "array") {
    if (!Array.isArray(value)) fail("must be an array")
    const list = value as unknown[]
    if (schema.minItems !== undefined && list.length < schema.minItems)
      fail(`must contain at least ${schema.minItems} items`)
    if (schema.maxItems !== undefined && list.length > schema.maxItems)
      fail(`must contain at most ${schema.maxItems} items`)
    if (schema.items)
      list.forEach((v, i) =>
        validateWhatsAppSchema(schema.items!, v, `${path}[${i}]`)
      )
  } else if (schema.type === "object" || schema.required) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail("must be an object")
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? [])
      if (record[key] === undefined) fail(`missing ${key}`)
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      if (record[key] !== undefined)
        validateWhatsAppSchema(child, record[key], `${path}.${key}`)
    for (const [key, child] of Object.entries(record))
      if (!(key in (schema.properties ?? {}))) {
        if (schema.additionalProperties === false)
          fail(`unsupported field ${key}`)
        if (
          schema.additionalProperties &&
          typeof schema.additionalProperties === "object"
        )
          validateWhatsAppSchema(
            schema.additionalProperties,
            child,
            `${path}.${key}`
          )
      }
  }
}

const inboundMedia = obj(
  {
    id: str(),
    link: url,
    url,
    mime_type: str(),
    sha256: str(),
    caption: str(),
    filename: str(),
    voice: { type: "boolean" },
    animated: { type: "boolean" },
  },
  []
)
const inboundReply = (type: string, body: WhatsAppSchema) =>
  obj({ type: choice(type), [type]: body, response: {} }, ["type", type])
export const whatsappReceiveContentSchemas: Record<string, WhatsAppSchema> = {
  ...whatsappBodySchemas,
  text: obj({ body: str(), preview_url: { type: "boolean" } }, ["body"]),
  image: inboundMedia,
  video: inboundMedia,
  audio: inboundMedia,
  document: inboundMedia,
  sticker: inboundMedia,
  interactive: {
    oneOf: [
      whatsappInteractiveSchema,
      inboundReply("button_reply", obj({ id: str(), title: str() })),
      inboundReply(
        "list_reply",
        obj({ id: str(), title: str(), description: str() }, ["id", "title"])
      ),
      inboundReply(
        "nfm_reply",
        obj({ name: str(), body: str(), response_json: str() }, [
          "name",
          "response_json",
        ])
      ),
      inboundReply(
        "call_permission_reply",
        obj(
          {
            response: str(),
            is_permanent: { type: "boolean" },
            expiration_timestamp: str(),
            response_source: str(),
          },
          ["response"]
        )
      ),
    ],
  },
  reaction: obj({ message_id: str(), emoji: { type: "string" } }, [
    "message_id",
  ]),
  button: obj({ payload: str(), text: str() }),
  order: obj(
    {
      catalog_id: str(),
      text: str(),
      product_items: arr(
        obj({
          product_retailer_id: str(),
          quantity: num(),
          item_price: { oneOf: [str(), num()] },
          currency: str(),
        })
      ),
    },
    ["catalog_id", "product_items"]
  ),
  system: obj(
    {
      body: str(),
      type: choice("user_changed_number", "user_changed_user_id"),
      wa_id: str(),
      user_id: str(),
    },
    ["body", "type"]
  ),
  unsupported: obj({ type: str() }),
  edit: obj({ original_message_id: str(), text: obj({ body: str() }) }, []),
  revoke: obj({ original_message_id: str() }),
}
export const whatsappNormalizedSchema: WhatsAppSchema = {
  type: "object",
  properties: {
    raw: freeObject,
    identity: obj(
      {
        wa_id: str(),
        user_id: str(),
        parent_user_id: str(),
        username: str(),
        identity_key_hash: str(),
      },
      []
    ),
    context: obj(
      {
        from: str(),
        id: str(),
        message_id: str(),
        forwarded: { type: "boolean" },
        frequently_forwarded: { type: "boolean" },
        referred_product: product,
      },
      []
    ),
    referral: obj(
      {
        source_url: str(),
        source_id: str(),
        source_type: choice("ad", "post"),
        body: str(),
        headline: str(),
        media_type: str(),
        image_url: str(),
        video_url: str(),
        thumbnail_url: str(),
        ctwa_clid: str(),
        welcome_message: obj({ text: str() }),
      },
      []
    ),
    errors: arr(freeObject),
  },
  oneOf: Object.entries(whatsappReceiveContentSchemas).map(([type, content]) =>
    obj({ type: choice(type), content }, ["type"])
  ),
}
