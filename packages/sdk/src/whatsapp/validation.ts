import { WHATSAPP_SEND_TYPES } from "./catalog"
import { whatsappBodySchemas, validateWhatsAppSchema } from "./schema"

type RecordValue = Record<string, unknown>
const record = (v: unknown) => v as RecordValue
const list = (v: unknown) => v as RecordValue[]
const unique = (values: unknown[], field: string) => {
  if (new Set(values).size !== values.length)
    throw new Error(`${field} must be unique.`)
}
const exactlyOne = (value: RecordValue, keys: string[], field: string) => {
  if (keys.filter((k) => value[k] !== undefined).length !== 1)
    throw new Error(`${field}: provide exactly one of ${keys.join(" or ")}.`)
}
function productSections(value: unknown) {
  const sections = list(value)
  if (sections.reduce((sum, s) => sum + list(s.product_items).length, 0) > 30)
    throw new Error("Product lists allow at most 30 products in total.")
  if (sections.length > 1 && sections.some((s) => !s.title))
    throw new Error(
      "Product sections require titles when there is more than one section."
    )
}
function components(value: unknown, depth = 0) {
  if (depth > 1)
    throw new Error("Template carousel cards cannot contain another carousel.")
  const items = list(value)
  const buttons = items.filter((c) => c.type === "button")
  if (buttons.length > 10)
    throw new Error("Templates allow at most 10 buttons.")
  unique(
    buttons.map((c) => String(c.index)),
    "Template button indexes"
  )
  for (const component of items) {
    if (component.type === "carousel") {
      const cards = list(component.cards)
      unique(
        cards.map((c) => c.card_index),
        "Template carousel card indexes"
      )
      for (const card of cards) {
        if (list(card.components).filter((c) => c.type === "button").length > 2)
          throw new Error("Template carousel cards allow at most 2 buttons.")
        components(card.components, depth + 1)
      }
      continue
    }
    if (
      component.type === "button" &&
      (component.sub_type === undefined || component.index === undefined)
    )
      throw new Error("Template buttons require sub_type and index.")
    const params = list(component.parameters)
    for (const parameter of params) {
      if (parameter.type === "action") {
        const action = record(parameter.action)
        if (action.sections) productSections(action.sections)
      }
    }
    const allowed: Record<string, string[]> = {
      quick_reply: ["payload"],
      url: ["text"],
      copy_code: ["coupon_code"],
      flow: ["action"],
      CATALOG: ["action"],
      catalog: ["action"],
      mpm: ["action"],
      voice_call: ["ttl_minutes", "payload"],
      order_details: ["action"],
    }
    if (
      component.type === "button" &&
      params.some(
        (p) => !allowed[String(component.sub_type)]?.includes(String(p.type))
      )
    )
      throw new Error(
        `Invalid parameter for template button ${component.sub_type}.`
      )
  }
}
/** Structural limits are shared with OpenAPI/MCP; aggregate constraints live here. */
export function validateWhatsAppBody(input: RecordValue) {
  const present = WHATSAPP_SEND_TYPES.filter(
    (type) => input[type] !== undefined
  )
  if (
    present.length !== 1 ||
    (input.type !== undefined && input.type !== present[0])
  )
    throw new Error(
      "Provide exactly one message body, matching type when specified."
    )
  const type = present[0]
  validateWhatsAppSchema(whatsappBodySchemas[type], input[type], type)
  const body = record(input[type])
  if (["image", "video", "audio", "document", "sticker"].includes(type)) {
    if (
      body.caption !== undefined &&
      !["image", "video", "document"].includes(type)
    )
      throw new Error(`${type} does not support captions.`)
    if (body.filename !== undefined && type !== "document")
      throw new Error("Only documents support filename.")
    if (body.voice !== undefined && type !== "audio")
      throw new Error("Only audio supports voice.")
    if (body.link) {
      const url = new URL(String(body.link))
      if (url.username || url.password)
        throw new Error("Media links must not contain credentials.")
    }
  }
  if (type === "reaction" && body.emoji !== "") {
    // Node >=20 (the SDK runtime) supports Unicode grapheme segmentation,
    // including skin tones, ZWJ families, flags and subdivision tag sequences.
    const Segmenter = Reflect.get(Intl, "Segmenter") as new (
      locale: undefined,
      options: { granularity: "grapheme" }
    ) => { segment(input: string): Iterable<unknown> }
    const emoji = String(body.emoji)
    if (
      [...new Segmenter(undefined, { granularity: "grapheme" }).segment(emoji)]
        .length !== 1 ||
      !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoji)
    )
      throw new Error(
        "reaction.emoji must be one emoji or an empty string to remove it."
      )
  }
  if (type === "template") {
    if (body.components !== undefined && body.variables !== undefined)
      throw new Error("Provide template components or variables, not both.")
    if (body.components) {
      if (!body.name || !body.language)
        throw new Error("Template components require name and language.")
      components(body.components)
    }
  }
  if (type === "interactive") {
    const action = record(body.action)
    if (body.type === "button") {
      const replies = list(action.buttons).map((b) => record(b.reply))
      unique(
        replies.map((b) => b.id),
        "Reply ids"
      )
      unique(
        replies.map((b) => b.title),
        "Reply titles"
      )
    } else if (body.type === "list") {
      const sections = list(action.sections),
        rows = sections.flatMap((s) => list(s.rows))
      if (rows.length > 10)
        throw new Error("Interactive lists allow at most 10 rows in total.")
      unique(
        rows.map((r) => r.id),
        "List row ids"
      )
      if (sections.length > 1 && sections.some((s) => !s.title))
        throw new Error(
          "List sections require titles when there is more than one section."
        )
    } else if (body.type === "flow") {
      const params = record(action.parameters)
      exactlyOne(params, ["flow_id", "flow_name"], "flow.parameters")
      if (
        params.flow_action === "navigate" &&
        !record(params.flow_action_payload ?? {}).screen
      )
        throw new Error(
          "flow_action navigate requires flow_action_payload.screen."
        )
    } else if (body.type === "product_list") productSections(action.sections)
    else if (body.type === "product" && body.header !== undefined)
      throw new Error("Product messages do not support a header.")
    else if (body.type === "carousel") {
      const cards = list(action.cards)
      unique(
        cards.map((c) => c.card_index),
        "Carousel card indexes"
      )
      if (cards.some((c) => c.type !== cards[0].type))
        throw new Error("Carousel cards must have the same type.")
      if (cards[0].type === "product") {
        if (
          cards.some(
            (c) =>
              record(c.action).catalog_id !== record(cards[0].action).catalog_id
          )
        )
          throw new Error("Product carousel cards must use the same catalog.")
      } else {
        const signature = (c: RecordValue) => {
          const action = record(c.action)
          return action.buttons
            ? `quick_reply:${list(action.buttons).length}`
            : "cta_url:1"
        }
        if (cards.some((c) => signature(c) !== signature(cards[0])))
          throw new Error(
            "Carousel button type and count must match across cards."
          )
      }
    }
  }
  return type
}
