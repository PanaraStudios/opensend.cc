import { test } from "node:test"
import assert from "node:assert/strict"
import { whatsappPayload } from "./payloads"
import { whatsappSendExamples } from "./whatsapp-fixtures"
import { normalizeWhatsAppMessage } from "../../packages/sdk/src/whatsapp/normalize"
const to = "16505551234"
const clone = (name: string) => structuredClone(whatsappSendExamples[name])
const valid = (body: Record<string, unknown>) =>
  whatsappPayload({ to, ...body })
for (const [name, max, field] of [
  ["text", 4096, "body"],
  ["image", 1024, "caption"],
  ["video", 1024, "caption"],
  ["document", 1024, "caption"],
] as const)
  test(`${name} accepts exactly ${max} characters and rejects ${max + 1}`, () => {
    const example = clone(name),
      content = example[name] as Record<string, unknown>
    content[field] = "x".repeat(max)
    valid(example)
    content[field] = "x".repeat(max + 1)
    assert.throws(() => valid(example), new RegExp(String(max)))
  })
test("interactive header/footer/button/row limits match the catalog", () => {
  const example = clone("interactive_list"),
    interactive = example.interactive as {
      body: { text: string }
      header?: { type: string; text: string }
      footer?: { text: string }
      action: {
        button: string
        sections: {
          title: string
          rows: { id: string; title: string; description?: string }[]
        }[]
      }
    }
  interactive.body.text = "x".repeat(4096)
  interactive.header = { type: "text", text: "x".repeat(60) }
  interactive.footer = { text: "x".repeat(60) }
  interactive.action.button = "x".repeat(20)
  const row = interactive.action.sections[0].rows[0]
  row.id = "x".repeat(200)
  row.title = "x".repeat(24)
  row.description = "x".repeat(72)
  interactive.action.sections[0].title = "x".repeat(24)
  valid(example)
  for (const [object, key, max] of [
    [interactive.body, "text", 4096],
    [interactive.header, "text", 60],
    [interactive.footer, "text", 60],
    [interactive.action, "button", 20],
    [row, "id", 200],
    [row, "title", 24],
    [row, "description", 72],
    [interactive.action.sections[0], "title", 24],
  ] as [Record<string, unknown>, string, number][]) {
    const previous = object[key]
    object[key] = "x".repeat(max + 1)
    assert.throws(() => valid(example), new RegExp(String(max)))
    object[key] = previous
  }
})
test("contacts, sections and products enforce catalog maxima, including totals across sections", () => {
  const contact = (clone("contacts").contacts as unknown[])[0]
  valid({ contacts: Array.from({ length: 257 }, () => contact) })
  assert.throws(
    () => valid({ contacts: Array.from({ length: 258 }, () => contact) }),
    /257/
  )
  const example = clone("interactive_product_list"),
    body = example.interactive as {
      action: {
        sections: {
          title: string
          product_items: { product_retailer_id: string }[]
        }[]
      }
    }
  body.action.sections = [0, 1].map((i) => ({
    title: "Products",
    product_items: Array.from({ length: 15 }, (_, j) => ({
      product_retailer_id: `sku${i}-${j}`,
    })),
  }))
  valid(example)
  body.action.sections[1].product_items.push({ product_retailer_id: "extra" })
  assert.throws(() => valid(example), /30/)
})
test("carousel card count, catalog and action consistency reject invalid sends", () => {
  const example = clone("interactive_carousel_product"),
    body = example.interactive as {
      action: {
        cards: { card_index: number; action: { catalog_id: string } }[]
      }
    }
  body.action.cards[1].action.catalog_id = "another"
  assert.throws(() => valid(example), /same catalog/)
  body.action.cards = body.action.cards.slice(0, 1)
  assert.throws(() => valid(example), /at least 2/)
  const media = clone("interactive_carousel_media"),
    cards = (
      media.interactive as { action: { cards: Record<string, unknown>[] } }
    ).action.cards
  cards[1].action = {
    buttons: [
      { type: "quick_reply", quick_reply: { id: "pick", title: "Pick" } },
    ],
  }
  assert.throws(() => valid(media), /must match/)
})
test("catalog doc gaps and advisory flow_cta limits do not invent hard limits", () => {
  const flow = clone("interactive_flow"),
    body = flow.interactive as { action: { parameters: { flow_cta: string } } }
  body.action.parameters.flow_cta = "x".repeat(31)
  valid(flow)
  const button = clone("interactive_button")
  ;(button.interactive as Record<string, unknown>).header = {
    type: "text",
    text: "x".repeat(61),
  }
  valid(button)
})
test("unknown messages and malformed flow JSON remain available without throwing", () => {
  const unknown = { type: "future_type", future_type: { nested: true } }
  assert.deepEqual(normalizeWhatsAppMessage(unknown).raw, unknown)
  assert.equal(normalizeWhatsAppMessage(unknown).type, "unsupported")
  const flow = {
    type: "interactive",
    interactive: {
      type: "nfm_reply",
      nfm_reply: { name: "flow", response_json: "{" },
    },
  }
  assert.deepEqual(normalizeWhatsAppMessage(flow).content, flow.interactive)
})

test("reaction validation accepts complete Unicode emoji graphemes", () => {
  for (const emoji of [
    "👍🏽",
    "☝️🏽",
    "👨‍👩‍👧‍👦",
    "🇮🇳",
    "1️⃣",
    "🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}",
    "",
  ])
    valid({ reaction: { message_id: "wamid.target", emoji } })
  for (const emoji of ["👍👍", "hello", "👍a"])
    assert.throws(
      () => valid({ reaction: { message_id: "wamid.target", emoji } }),
      /one emoji/
    )
})
