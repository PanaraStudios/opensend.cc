import { test } from "node:test"
import assert from "node:assert/strict"
import {
  audioTime,
  chatDay,
  messageTextParts,
  safeMessageUrl,
  sameMessageGroup,
  messageContentPreview,
  relativeMessageTime,
} from "./conversation-content"
import { composerInteractive } from "./conversation-composer"
import { validateWhatsAppBody } from "../../packages/sdk/src/whatsapp/validation"

test("shared readable previews describe replies, templates and media; times are relative", () => {
  assert.equal(
    messageContentPreview(
      "interactive",
      { type: "button_reply", button_reply: { title: "Yes" } },
      "[interactive]"
    ),
    "Yes"
  )
  assert.equal(
    messageContentPreview(
      "interactive",
      { body: { text: "Choose a time" } },
      "[interactive]"
    ),
    "Choose a time"
  )
  assert.equal(
    messageContentPreview("template", {}, "[template]", { body: "Hello Ada" }),
    "Hello Ada"
  )
  assert.equal(
    messageContentPreview("image", { caption: "Receipt" }, "[image]"),
    "Image: Receipt"
  )
  assert.equal(messageContentPreview("audio", {}, "[audio]"), "Audio")
  assert.equal(
    messageContentPreview(
      "interactive",
      {
        type: "call_permission_reply",
        call_permission_reply: { response: "accept" },
      },
      "[interactive]"
    ),
    "Call permission: Accepted"
  )
  assert.equal(
    messageContentPreview(
      "interactive",
      {
        type: "call_permission_reply",
        call_permission_reply: { response: "reject" },
      },
      "[interactive]"
    ),
    "Call permission: Declined"
  )
  assert.equal(relativeMessageTime(0, 2 * 3600_000), "2h ago")
})

test("WhatsApp formatting preserves text and never permits script URLs", () => {
  assert.deepEqual(
    messageTextParts(
      "Hello *Ada* _hello_ ~old~ ```<b>code</b>``` https://example.com"
    ),
    [
      { kind: "text", text: "Hello " },
      { kind: "bold", text: "Ada" },
      { kind: "text", text: " " },
      { kind: "italic", text: "hello" },
      { kind: "text", text: " " },
      { kind: "strike", text: "old" },
      { kind: "text", text: " " },
      { kind: "code", text: "<b>code</b>" },
      { kind: "text", text: " " },
      { kind: "link", text: "https://example.com" },
    ]
  )
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "//evil.test",
    "file:///etc/passwd",
  ])
    assert.equal(safeMessageUrl(url), undefined)
  assert.equal(safeMessageUrl("tel:+123", true), "tel:+123")
})
test("groups stop at direction changes, five minutes and local date boundaries", () => {
  const at = new Date(2026, 9, 1, 12).getTime()
  const one = { direction: "inbound", at }
  assert.equal(sameMessageGroup(one, { ...one, at: at + 60_000 }), true)
  assert.equal(sameMessageGroup(one, { ...one, direction: "outbound" }), false)
  assert.equal(sameMessageGroup(one, { ...one, at: at + 300_000 }), false)
  assert.equal(chatDay(at, at), "Today")
  assert.equal(chatDay(at - 86_400_000, at), "Yesterday")
  assert.equal(audioTime(95), "1:35")
  assert.equal(audioTime(Infinity), "0:00")
})
test("every advanced composer builds a request the shared SDK validator accepts", () => {
  for (const kind of [
    "button",
    "list",
    "cta_url",
    "location_request_message",
  ] as const) {
    const interactive = composerInteractive({
      kind,
      body: "Choose an option",
      header: "Hello",
      footer: "Thank you",
      labels: ["Yes", "No", ""],
      button: "View options",
      url: "https://example.com",
    })
    assert.doesNotThrow(() =>
      validateWhatsAppBody({ type: "interactive", interactive })
    )
  }
})
