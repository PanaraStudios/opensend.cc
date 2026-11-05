import assert from "node:assert/strict"
import { test } from "node:test"
import { detailThreadMessage } from "./detail"

test("detail preview retains the selected message and rendered template", () => {
  const normalized = { type: "template", content: { body: "Hello" } }
  const rendered = { body: "Hello Ada", buttons: [] }
  const message = detailThreadMessage({
    message: {
      _id: "old-message",
      _creationTime: 123,
      direction: "outbound",
      status: "delivered",
      preview: "Template",
    },
    normalized,
    rendered,
    media: [],
  })
  assert.equal(message.id, "old-message")
  assert.equal(message.text, "Hello Ada")
  assert.equal(message.normalized, normalized)
  assert.equal(message.rendered, rendered)
  assert.equal(
    detailThreadMessage({
      message: {
        _id: "text",
        _creationTime: 124,
        direction: "inbound",
        status: "received",
        preview: "Hello",
      },
      normalized: {},
      media: [],
    }).text,
    "Hello"
  )
})
