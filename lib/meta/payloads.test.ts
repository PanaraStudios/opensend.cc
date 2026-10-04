import { test } from "node:test"
import assert from "node:assert/strict"
import {
  whatsappPayload,
  pageMessageTextLimit,
  pageMessageContent,
} from "./payloads"
const to = "+16505551234"
test("editor text limits match send validation for Messenger and Instagram", () => {
  for (const channel of ["messenger", "instagram"] as const) {
    const limit = pageMessageTextLimit(channel)
    assert.equal(limit, channel === "instagram" ? 1000 : 2000)
    assert.doesNotThrow(() =>
      pageMessageContent({ text: "x".repeat(limit) }, channel)
    )
    assert.throws(
      () => pageMessageContent({ text: "x".repeat(limit + 1) }, channel),
      /at most/
    )
  }
})
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

test("Messenger uses scoped recipients, attachments, replies and at most 13 quick replies", async () => {
  const { messengerPayload } = await import("./payloads")
  assert.deepEqual(
    messengerPayload({
      to: "123",
      text: "Hello",
      reply_to: "mid.parent",
      quick_replies: [{ title: "Yes", payload: "YES" }],
    }),
    {
      recipient: { id: "123" },
      messaging_type: "RESPONSE",
      message: {
        text: "Hello",
        quick_replies: [{ content_type: "text", title: "Yes", payload: "YES" }],
      },
      reply_to: { mid: "mid.parent" },
    }
  )
  assert.deepEqual(
    messengerPayload({
      to: "123",
      attachment: { type: "file", id: "saved-file" },
    }).message.attachment,
    { type: "file", payload: { attachment_id: "saved-file" } }
  )
  for (const input of [
    { to: "bad", text: "x" },
    { to: "1", text: "x", attachment: {} },
    { to: "1", text: "x".repeat(2001) },
    {
      to: "1",
      attachment: { type: "image", url: "https://u:p@example.com/a" },
    },
    { to: "1", attachment: { type: "image", url: "file:///tmp/a" } },
    {
      to: "1",
      text: "x",
      quick_replies: Array.from({ length: 14 }, () => ({
        title: "x",
        payload: "x",
      })),
    },
    { to: "1", text: "x", tag: "invalid" },
  ])
    assert.throws(() => messengerPayload(input))
})
test("Instagram restricts tags and quick replies on media; HUMAN_AGENT has a seven-day window", async () => {
  const { instagramPayload, pageMessagingType, PAGE_WINDOW_CLOSED } =
    await import("./payloads")
  assert.equal(
    instagramPayload({ to: "123", text: "Hello", tag: "HUMAN_AGENT" }).tag,
    "HUMAN_AGENT"
  )
  assert.throws(
    () =>
      instagramPayload({
        to: "1",
        attachment: { type: "image", url: "https://example.com/a" },
        quick_replies: [],
      }),
    /text message/
  )
  assert.throws(
    () => instagramPayload({ to: "1", text: "x", tag: "ACCOUNT_UPDATE" }),
    /only supported message tag is HUMAN_AGENT/
  )
  assert.throws(() => instagramPayload({ to: "1", text: "x".repeat(1001) }))
  const now = 8 * 86400_000
  assert.equal(pageMessagingType(now + 1, undefined, now), "RESPONSE")
  assert.throws(() => pageMessagingType(now, undefined, now), {
    message: PAGE_WINDOW_CLOSED,
  })
  assert.equal(
    pageMessagingType(now - 86400_000, "HUMAN_AGENT", now),
    "MESSAGE_TAG"
  )
  assert.throws(
    () => pageMessagingType(now - 6 * 86400_000, "HUMAN_AGENT", now),
    /7-day/
  )
  assert.throws(() => pageMessagingType(undefined, "HUMAN_AGENT", now), /7-day/)
})

test("channel strategies apply each channel's payload, endpoint and window rule", async () => {
  const { channelStrategies } = await import("./payloads")
  const account = {
    _id: "account",
    externalId: "phone",
    pageId: "page",
    throughputMps: 1000,
  }
  assert.deepEqual(channelStrategies.whatsapp.replyContext("parent"), {
    context: { message_id: "parent" },
  })
  assert.deepEqual(channelStrategies.whatsapp.identity("16505551234"), {
    phone: "+16505551234",
  })
  assert.deepEqual(channelStrategies.whatsapp.rate(account), {
    key: "account",
    rate: 1000,
  })
  assert.equal(channelStrategies.whatsapp.requiresRegistration, true)
  const wa = channelStrategies.whatsapp.build({ to, text: "Hi" })
  assert.equal(wa.to, "16505551234")
  assert.throws(
    () => channelStrategies.whatsapp.assertWindow(wa.payload, 0, 1),
    /approved template/
  )
  assert.equal(
    channelStrategies.whatsapp.endpoint({
      externalId: "phone",
      pageId: "page",
    }),
    "phone"
  )
  for (const channel of ["messenger", "instagram"] as const) {
    const strategy = channelStrategies[channel]
    assert.equal(strategy.requiresRegistration, false)
    assert.deepEqual(strategy.replyContext("parent"), {
      reply_to: { mid: "parent" },
    })
    assert.deepEqual(strategy.identity("123"), {})
    assert.deepEqual(strategy.rate(account), {
      key: "page:page",
      rate: 300,
      mediaRate: 10,
    })
    const media = strategy.build({
      to: "123",
      attachment: { type: "image", id: "image1" },
    })
    assert.deepEqual(strategy.mediaData(media.payload, "image"), {
      attachment_id: "image1",
    })
    const result = channelStrategies[channel].build({
      to: "123",
      text: "Hi",
      tag: "HUMAN_AGENT",
    })
    channelStrategies[channel].assertWindow(result.payload, 100, 101)
    assert.equal(result.payload.messaging_type, "MESSAGE_TAG")
    assert.equal(
      channelStrategies[channel].endpoint({
        externalId: "account",
        pageId: "page",
      }),
      "page"
    )
  }
})
