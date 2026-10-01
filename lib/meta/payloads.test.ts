import { test } from "node:test"
import assert from "node:assert/strict"
import { whatsappPayload } from "./payloads"
const to = "+16505551234"
test("text previews, normalized recipients, replies and type inference use the Cloud API shape", () => {
  assert.deepEqual(
    whatsappPayload({
      to,
      text: { body: "Hello", preview_url: true },
      reply_to: "wamid.reply",
    }),
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "16505551234",
      type: "text",
      text: { body: "Hello", preview_url: true },
      context: { message_id: "wamid.reply" },
    }
  )
})
test("template components pass through and variables become ordered or named text parameters", () => {
  const components = [
    { type: "body", parameters: [{ type: "text", text: "Ada" }] },
  ]
  assert.deepEqual(
    whatsappPayload({
      to,
      template: { name: "hello", language: "en_US", components },
    }).template,
    { name: "hello", language: { code: "en_US" }, components }
  )
  assert.deepEqual(
    whatsappPayload({
      to,
      template: {
        name: "hello",
        language: { code: "en_US" },
        variables: { "2": 42, "1": "Ada" },
      },
    }).template,
    {
      name: "hello",
      language: { code: "en_US" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ada" },
            { type: "text", text: "42" },
          ],
        },
      ],
    }
  )
  assert.deepEqual(
    whatsappPayload({
      to,
      template: {
        name: "hello",
        language: "en",
        variables: { first_name: "Ada" },
      },
    }).template,
    {
      name: "hello",
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", parameter_name: "first_name", text: "Ada" },
          ],
        },
      ],
    }
  )
})
for (const type of [
  "image",
  "video",
  "audio",
  "document",
  "sticker",
] as const) {
  test(`${type} supports media id and link, with caption/filename only on supported types`, () => {
    for (const ref of [{ id: "123" }, { link: "https://example.com/media" }]) {
      const body = {
        ...ref,
        ...(["image", "video", "document"].includes(type)
          ? { caption: "Caption" }
          : {}),
        ...(type === "document" ? { filename: "file.pdf" } : {}),
      }
      assert.deepEqual(whatsappPayload({ to, [type]: body })[type], body)
    }
    assert.throws(() =>
      whatsappPayload({
        to,
        [type]: { id: "123", link: "https://example.com" },
      })
    )
  })
}
test("location, reaction and button/list actions", () => {
  const location = {
    latitude: 37.4,
    longitude: -122.1,
    name: "Office",
    address: "1 Main Street",
  }
  assert.deepEqual(whatsappPayload({ to, location }).location, location)
  for (const emoji of ["👍", ""])
    assert.deepEqual(
      whatsappPayload({ to, reaction: { message_id: "wamid.id", emoji } })
        .reaction,
      { message_id: "wamid.id", emoji }
    )
  const buttons = {
    type: "button",
    body: { text: "Choose" },
    action: {
      buttons: [{ type: "reply", reply: { id: "yes", title: "Yes" } }],
    },
  }
  assert.deepEqual(
    whatsappPayload({ to, interactive: buttons }).interactive,
    buttons
  )
  const list = {
    type: "list",
    body: { text: "Choose" },
    action: {
      button: "Options",
      sections: [
        {
          title: "Section",
          rows: [{ id: "one", title: "One", description: "First" }],
        },
      ],
    },
  }
  assert.deepEqual(whatsappPayload({ to, interactive: list }).interactive, list)
})
test("malformed bodies fail before Graph: mismatch, multiple bodies, coordinates, parameter holes, captions", () => {
  for (const input of [
    { to, type: "video" as const, text: "Hello" },
    { to, text: "Hello", image: { id: "1" } },
    { to, text: { body: "x".repeat(4097) } },
    { to: "invalid", text: "Hello" },
    { to, location: { latitude: 91, longitude: 0 } },
    { to, audio: { id: "1", caption: "Unsupported" } },
    { to, image: { id: "1", filename: "Unsupported" } },
    {
      to,
      template: { name: "hello", language: "en", variables: { "2": "hole" } },
    },
    {
      to,
      template: {
        name: "hello",
        language: "en",
        components: [],
        variables: {},
      },
    },
    {
      to,
      interactive: {
        type: "button",
        body: { text: "Choose" },
        action: { buttons: [] },
      },
    },
  ])
    assert.throws(() => whatsappPayload(input))
})
