import assert from "node:assert/strict"
import { test } from "node:test"
import {
  object,
  array,
  string,
  timestamp,
  outboundStatus,
  STATUS_RANK,
  profileNameParts,
} from "./webhooks"
test("untrusted webhook helpers reject mismatched shapes and invalid timestamps", () => {
  for (const value of [null, [], "text", 123])
    assert.deepEqual(object(value), {})
  assert.deepEqual(array({}), [])
  assert.equal(string(123), "")
  assert.equal(timestamp("1749416383", 0), 1749416383000)
  for (const value of [null, "", -1, "bad", Infinity, 1e20])
    assert.equal(timestamp(value, 123), 123)
  assert.equal(outboundStatus("received"), null)
  assert.equal(outboundStatus("failed"), "failed")
  assert.ok(STATUS_RANK.failed > STATUS_RANK.read)
})

test("profile names split into first and last names", () => {
  assert.deepEqual(profileNameParts("Priya Shah"), {
    firstName: "Priya",
    lastName: "Shah",
  })
  assert.deepEqual(profileNameParts("  Ana  María de la Cruz "), {
    firstName: "Ana",
    lastName: "María de la Cruz",
  })
  assert.deepEqual(profileNameParts("Cher"), {
    firstName: "Cher",
    lastName: "",
  })
  assert.deepEqual(profileNameParts(""), { firstName: "", lastName: "" })
})

test("Page and Instagram messaging parsers preserve scoped IDs, millisecond timestamps, attachments, postbacks and reactions", async () => {
  const { pageWebhookItems } = await import("./webhooks")
  const at = 1790812800123
  const event = (fields: object) => ({
    sender: { id: "123" },
    recipient: { id: "456" },
    timestamp: at,
    ...fields,
  })
  const payload = (messaging: unknown[], object = "page") => ({
    object,
    entry: [{ id: "456", messaging }],
  })
  const items = pageWebhookItems(
    payload([
      event({
        message: {
          mid: "mid.text",
          text: "Hello",
          quick_reply: { payload: "YES" },
        },
      }),
      event({
        message: {
          mid: "mid.file",
          attachments: [
            { type: "file", payload: { url: "https://cdn.example/file" } },
          ],
        },
      }),
      event({
        postback: { mid: "mid.button", title: "Start", payload: "START" },
      }),
      event({ reaction: { mid: "mid.text", emoji: "❤️", action: "react" } }),
      event({ delivery: { mids: ["mid.sent"], watermark: at } }),
      event({ read: { watermark: at } }),
      event({ message: { mid: "mid.echo", text: "Echo", is_echo: true } }),
    ]),
    at
  )
  assert.equal(items.length, 7)
  assert.deepEqual(items[0], {
    channel: "messenger",
    accountId: "456",
    sender: "123",
    at,
    kind: "message",
    externalId: "mid.text",
    type: "text",
    preview: "Hello",
    profileName: "",
    files: [],
    data: event({
      message: {
        mid: "mid.text",
        text: "Hello",
        quick_reply: { payload: "YES" },
      },
    }),
  })
  assert.equal(items[1].kind === "message" && items[1].type, "document")
  assert.equal(items[2].kind === "message" && items[2].type, "button")
  assert.equal(items[3].kind === "message" && items[3].type, "reaction")
  assert.deepEqual(items[6], {
    channel: "messenger",
    accountId: "456",
    sender: "123",
    at,
    kind: "watermark",
    status: "read",
    watermark: at,
  })
  assert.equal(
    pageWebhookItems(
      payload([event({ read: { mid: "mid.ig" } })], "instagram"),
      at
    )[0].channel,
    "instagram"
  )
  assert.deepEqual(pageWebhookItems({ object: "unknown", entry: [] }, at), [])
})

test("WhatsApp normalizes incoming messages and statuses without changing stored wire data", async () => {
  const { whatsappWebhookItems } = await import("./webhooks")
  const data = {
    id: "wamid.in",
    from: "14155552671",
    timestamp: "1749416383",
    type: "image",
    image: { id: "media1", mime_type: "image/png", caption: "Photo" },
  }
  const [message, status] = whatsappWebhookItems(
    {
      metadata: { phone_number_id: "123" },
      contacts: [{ wa_id: data.from, profile: { name: "Ada" } }],
      messages: [data, { ...data, id: "", from: "bad" }],
      statuses: [
        {
          id: "wamid.out",
          recipient_id: data.from,
          status: "read",
          timestamp: data.timestamp,
        },
      ],
    },
    "456",
    1
  )
  assert.equal(message.kind, "message")
  if (message.kind !== "message") return
  assert.equal(message.sender, data.from)
  assert.equal(message.phone, "+14155552671")
  assert.equal(message.preview, "Photo")
  assert.equal(message.profileName, "Ada")
  assert.equal(message.at, 1749416383000)
  assert.deepEqual(message.files, [
    { mediaId: "media1", contentType: "image/png", mimeType: "image/png" },
  ])
  assert.equal(message.data, data)
  assert.equal(status.kind, "status")
})
