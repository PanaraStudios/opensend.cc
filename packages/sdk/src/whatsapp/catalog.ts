/** Cloud API v25.0 catalog. Shared by REST validation, SDK, MCP and OpenAPI.
 * Receive-only types remain distinct; unknown future types become unsupported.
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
  "contacts",
  "interactive",
  "reaction",
] as const
export const WHATSAPP_RECEIVE_TYPES = [
  ...WHATSAPP_SEND_TYPES,
  "button",
  "order",
  "system",
  "unsupported",
  "edit",
  "revoke",
] as const
export type WhatsAppSendType = (typeof WHATSAPP_SEND_TYPES)[number]
export type WhatsAppReceiveType = (typeof WHATSAPP_RECEIVE_TYPES)[number]
export type WhatsAppMediaReference =
  { id: string; link?: never } | { link: string; id?: never }
export type WhatsAppLocation = {
  latitude: number
  longitude: number
  name?: string
  address?: string
  url?: string
}
export type WhatsAppContact = {
  name: {
    formatted_name: string
    first_name?: string
    last_name?: string
    middle_name?: string
    suffix?: string
    prefix?: string
  }
  phones?: { phone?: string; type?: string; wa_id?: string }[]
  emails?: { email?: string; type?: string }[]
  addresses?: {
    street?: string
    city?: string
    state?: string
    zip?: string
    country?: string
    country_code?: string
    type?: string
  }[]
  org?: { company?: string; department?: string; title?: string }
  urls?: { url?: string; type?: string }[]
  birthday?: string
  vcard?: string
  origin?: string
}
export type WhatsAppAmount = { value: number; offset: number }
export type WhatsAppOrderDetails = {
  reference_id: string
  type: "digital-goods" | "physical-goods"
  payment_type: string
  payment_settings: Record<string, unknown>[]
  currency: string
  total_amount: WhatsAppAmount
  order?: {
    status: string
    catalog_id?: string
    expiration?: Record<string, unknown>
    items: {
      retailer_id?: string
      name: string
      amount: WhatsAppAmount
      quantity: number
      sale_amount?: WhatsAppAmount
    }[]
    subtotal: WhatsAppAmount
    tax: WhatsAppAmount
    shipping?: WhatsAppAmount
    discount?: WhatsAppAmount
  }
}
export type WhatsAppOrderStatus = {
  reference_id: string
  order: {
    status:
      "processing" | "partially_shipped" | "shipped" | "completed" | "canceled"
    description?: string
  }
  payment?: Record<string, unknown>
}
export type WhatsAppHeader =
  | { type: "text"; text: string; sub_text?: string }
  | { type: "image"; image: WhatsAppMediaReference }
  | { type: "video"; video: WhatsAppMediaReference }
  | { type: "document"; document: WhatsAppMediaReference }
export type WhatsAppProductSection = {
  title?: string
  product_items: { product_retailer_id: string }[]
}
export type WhatsAppInteractiveActionMap = {
  button: { buttons: { type: "reply"; reply: { id: string; title: string } }[] }
  list: {
    button: string
    sections: {
      title?: string
      rows: { id: string; title: string; description?: string }[]
    }[]
  }
  cta_url: {
    name: "cta_url"
    parameters: { display_text: string; url: string }
  }
  carousel: {
    cards: (
      | {
          card_index: number
          type: "product"
          action: { product_retailer_id: string; catalog_id: string }
        }
      | {
          card_index: number
          type: "cta_url"
          header: Extract<WhatsAppHeader, { type: "image" | "video" }>
          body?: { text: string }
          action:
            | {
                name: "cta_url"
                parameters: { display_text: string; url: string }
              }
            | {
                buttons: {
                  type: "quick_reply"
                  quick_reply: { id: string; title: string }
                }[]
              }
        }
    )[]
  }
  flow: {
    name: "flow"
    parameters: {
      flow_message_version: "3"
      flow_token: string
      flow_id?: string
      flow_name?: string
      flow_cta: string
      mode?: "draft" | "published"
      flow_action?: "navigate" | "data_exchange"
      flow_action_payload?: { screen?: string; data?: Record<string, unknown> }
    }
  }
  location_request_message: { name: "send_location" }
  address_message: {
    name: "address_message"
    parameters: {
      country: "IN"
      values?: Record<string, unknown>
      saved_addresses?: Record<string, unknown>[]
      validation_errors?: Record<string, unknown>
    }
  }
  voice_call: {
    name: "voice_call"
    parameters?: {
      display_text?: string
      ttl_minutes?: number
      payload?: string
    }
  }
  call_permission_request: { name: "call_permission_request" }
  request_contact_info: { name: "request_contact_info" }
  catalog_message: {
    name: "catalog_message"
    parameters?: { thumbnail_product_retailer_id?: string }
  }
  product: { catalog_id: string; product_retailer_id: string }
  product_list: { catalog_id: string; sections: WhatsAppProductSection[] }
  order_details: { name: "review_and_pay"; parameters: WhatsAppOrderDetails }
  order_status: { name: "review_order"; parameters: WhatsAppOrderStatus }
}
export type WhatsAppInteractive = {
  [K in keyof WhatsAppInteractiveActionMap]: {
    type: K
    header?: WhatsAppHeader
    footer?: { text: string }
    action: WhatsAppInteractiveActionMap[K]
  } & (K extends "product" | "catalog_message" | "order_status"
    ? { body?: { text: string } }
    : { body: { text: string } })
}[keyof WhatsAppInteractiveActionMap]
export type WhatsAppTemplateParameter =
  | { type: "text"; text: string; parameter_name?: string }
  | {
      type: "currency"
      currency: { fallback_value: string; code: string; amount_1000: number }
    }
  | { type: "date_time"; date_time: { fallback_value: string } }
  | { type: "image"; image: WhatsAppMediaReference }
  | { type: "video"; video: WhatsAppMediaReference }
  | {
      type: "document"
      document: WhatsAppMediaReference & { filename?: string }
    }
  | { type: "location"; location: WhatsAppLocation }
  | {
      type: "product"
      product: { product_retailer_id: string; catalog_id: string }
    }
  | { type: "payload"; payload: string }
  | {
      type: "action"
      action: {
        flow_token?: string
        flow_action_data?: Record<string, unknown>
        thumbnail_product_retailer_id?: string
        sections?: WhatsAppProductSection[]
        order_details?: WhatsAppOrderDetails
      }
    }
  | { type: "coupon_code"; coupon_code: string }
  | { type: "ttl_minutes"; ttl_minutes: number }
  | {
      type: "limited_time_offer"
      limited_time_offer: { expiration_time_ms: number }
    }
  | { type: "order_status"; order_status: WhatsAppOrderStatus }
export type WhatsAppTemplateComponent =
  | {
      type:
        | "header"
        | "body"
        | "button"
        | "limited_time_offer"
        | "call_permission_request"
        | "order_status"
      parameters: WhatsAppTemplateParameter[]
      sub_type?: string
      index?: string | number
    }
  | {
      type: "carousel"
      cards: { card_index: number; components: WhatsAppTemplateComponent[] }[]
    }
export type WhatsAppTemplate = (
  | {
      name: string
      language: string | { code: string }
      id?: string
      alias?: string
    }
  | {
      id: string
      name?: string
      language?: string | { code: string }
      alias?: never
    }
  | {
      alias: string
      name?: string
      language?: string | { code: string }
      id?: never
    }
) &
  (
    | { components?: WhatsAppTemplateComponent[]; variables?: never }
    | { variables?: Record<string, string | number>; components?: never }
  )
export type WhatsAppSendBodies = {
  text: string | { body: string; preview_url?: boolean }
  template: WhatsAppTemplate
  image: WhatsAppMediaReference & { caption?: string }
  video: WhatsAppMediaReference & { caption?: string }
  audio: WhatsAppMediaReference & { voice?: boolean }
  document: WhatsAppMediaReference & { caption?: string; filename?: string }
  sticker: WhatsAppMediaReference
  location: WhatsAppLocation
  contacts: WhatsAppContact[]
  interactive: WhatsAppInteractive
  reaction: { message_id: string; emoji: string }
}
export type WhatsAppInboundMedia = {
  id?: string
  link?: string
  url?: string
  mime_type?: string
  sha256?: string
  caption?: string
  filename?: string
  voice?: boolean
  animated?: boolean
}
export type WhatsAppInteractiveReply =
  | { type: "button_reply"; button_reply: { id: string; title: string } }
  | {
      type: "list_reply"
      list_reply: { id: string; title: string; description?: string }
    }
  | {
      type: "nfm_reply"
      nfm_reply: { name: string; body?: string; response_json: string }
      response?: unknown
    }
  | {
      type: "call_permission_reply"
      call_permission_reply: {
        response: string
        is_permanent?: boolean
        expiration_timestamp?: string
        response_source?: string
      }
    }
export type WhatsAppReceiveBodies = Omit<
  WhatsAppSendBodies,
  | "text"
  | "interactive"
  | "reaction"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
> & {
  text: { body: string; preview_url?: boolean }
  interactive: WhatsAppInteractive | WhatsAppInteractiveReply
  reaction: { message_id: string; emoji?: string }
  image: WhatsAppInboundMedia
  video: WhatsAppInboundMedia
  audio: WhatsAppInboundMedia
  document: WhatsAppInboundMedia
  sticker: WhatsAppInboundMedia
  button: { payload: string; text: string }
  order: {
    catalog_id: string
    text?: string
    product_items: {
      product_retailer_id: string
      quantity: number
      item_price: string | number
      currency: string
    }[]
  }
  system: {
    body: string
    wa_id?: string
    user_id?: string
    type: "user_changed_number" | "user_changed_user_id"
  }
  unsupported: { type: string }
  edit: Record<string, unknown>
  revoke: { original_message_id: string }
}
export type WhatsAppIdentity = {
  wa_id?: string
  user_id?: string
  parent_user_id?: string
  username?: string
  identity_key_hash?: string
}
export type WhatsAppContext = {
  from?: string
  id?: string
  message_id?: string
  forwarded?: boolean
  frequently_forwarded?: boolean
  referred_product?: { catalog_id: string; product_retailer_id: string }
}
export type WhatsAppReferral = {
  source_url?: string
  source_id?: string
  source_type?: "ad" | "post"
  body?: string
  headline?: string
  media_type?: string
  image_url?: string
  video_url?: string
  thumbnail_url?: string
  ctwa_clid?: string
  welcome_message?: { text: string }
}
export type WhatsAppNormalized = {
  [K in keyof WhatsAppReceiveBodies]: {
    type: K
    content: WhatsAppReceiveBodies[K]
  }
}[keyof WhatsAppReceiveBodies] & {
  raw: Record<string, unknown>
  identity: WhatsAppIdentity
  context?: WhatsAppContext
  referral?: WhatsAppReferral
  errors?: Record<string, unknown>[]
}
