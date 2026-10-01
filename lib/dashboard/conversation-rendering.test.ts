import { test } from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { normalizeWhatsAppMessage } from "../../packages/sdk/src/whatsapp/normalize"
import {
  whatsappInboundExamples,
  whatsappSendExamples,
} from "../meta/whatsapp-fixtures"
import { ThreadBubble } from "../../components/dashboard/conversation/thread-messages"
import type { ThreadMessage } from "../messages/use-messages"

function fixture(
  payload: Record<string, unknown>,
  rendered?: ThreadMessage["rendered"]
): ThreadMessage {
  const wireType =
    payload.type ??
    [
      "text",
      "image",
      "video",
      "audio",
      "document",
      "sticker",
      "location",
      "contacts",
      "interactive",
      "template",
      "reaction",
    ].find((key) => key in payload)
  const normalized = normalizeWhatsAppMessage({ ...payload, type: wireType })
  return {
    id: "fixture",
    at: Date.UTC(2026, 9, 1, 12),
    direction: "inbound",
    kind: "channel",
    status: "received",
    text: "Fixture message",
    media: [],
    rendered,
    normalized: {
      ...normalized,
      raw: { ...payload, private_test_sentinel: "DO_NOT_RENDER_RAW" },
      attachments: [
        {
          id: "media",
          content_type: "image/webp",
          filename: "fixture.file",
          size: 1234,
          download_url: "https://example.test/channels/media/signed",
          expires_at: "2026-10-01T13:00:00Z",
          error: null,
        },
      ],
      reactions: [],
      channel: "whatsapp",
    } as unknown as ThreadMessage["normalized"],
  }
}
const html = (message: ThreadMessage) =>
  renderToStaticMarkup(React.createElement(ThreadBubble, { message }))
for (const [name, payload] of [
  ...Object.entries(whatsappSendExamples).map(
    ([name, payload]) => [`outbound-${name}`, payload] as const
  ),
  ...Object.entries(whatsappInboundExamples),
]) {
  if (name.includes("reaction")) continue
  test(`normalized catalog renders ${name} without exposing raw payloads`, () => {
    const output = html(fixture(payload))
    assert.match(output, /thread-message/)
    assert.doesNotMatch(output, /DO_NOT_RENDER_RAW/)
    assert.doesNotMatch(output, /\[object Object\]/)
  })
}
test("inline media and borderless stickers replace generic file chips", () => {
  assert.match(html(fixture(whatsappInboundExamples.image)), /Open photo/)
  const video = html(fixture(whatsappInboundExamples.video_note))
  assert.match(video, /Open video/)
  assert.doesNotMatch(video, /<video[^>]*controls/)
  const audio = html(fixture(whatsappInboundExamples.audio))
  assert.doesNotMatch(audio, /<audio[^>]*controls/)
  assert.match(audio, /Playback speed 1×/)
  assert.match(audio, /Seek audio/)
  assert.match(
    html(fixture(whatsappInboundExamples.voice_note)),
    /voice-player/
  )
  assert.match(html(fixture(whatsappInboundExamples.audio)), /audio-player/)
  assert.match(
    html(fixture(whatsappInboundExamples.sticker)),
    /data-variant="ghost"/
  )
  assert.match(
    html(fixture(whatsappInboundExamples.document)),
    /Download document/
  )
  assert.match(
    html(fixture(whatsappInboundExamples.location)),
    /google.com\/maps/
  )
})
test("reaction badges attach to targets, and unsupported polls show a read-only notice", () => {
  const message = fixture(whatsappInboundExamples.text)
  message.normalized!.reactions = [
    {
      id: "reaction" as never,
      external_id: "wamid.r",
      from: "123",
      emoji: "👍",
      created_at: "2026-10-01T12:00:00Z",
    },
  ]
  assert.match(html(message), /bubble-reactions/)
  assert.match(html(message), /👍/)
  assert.match(
    html(fixture(whatsappInboundExamples.poll_creation)),
    /Polls aren&#x27;t supported/
  )
})
test("templates retain headers, footer, carousel and attached rows with all-options expansion", () => {
  const message = fixture(whatsappSendExamples.template, {
    header: { format: "TEXT", text: "Order update" },
    body: "Hi Ada",
    footer: "Thank you",
    buttons: [
      { type: "URL", text: "Visit" },
      { type: "FLOW", text: "Open form" },
      { type: "COPY_CODE", text: "Copy code" },
      { type: "VOICE_CALL", text: "Call" },
    ],
    cards: [
      {
        body: "First carousel product",
        buttons: [{ type: "CATALOG", text: "View catalog" }],
      },
    ],
  })
  const output = html(message)
  for (const text of [
    "Order update",
    "Hi Ada",
    "Thank you",
    "First carousel product",
    "attached-buttons",
    "See all options",
  ])
    assert.ok(output.includes(text), text)
})
test("text formatting escapes markup and quotes link to loaded originals", () => {
  const message = fixture({
    type: "text",
    text: { body: "*Hello* _Ada_ ~old~ ```<img>``` https://example.test" },
    context: { id: "wamid.original", forwarded: true },
  })
  const output = renderToStaticMarkup(
    React.createElement(ThreadBubble, {
      message,
      reply: { ...message, id: "original", text: "Original question" },
    })
  )
  for (const text of [
    "<strong>",
    "<em>",
    "<s>",
    "&lt;img&gt;",
    'href="https://example.test/"',
    "Forwarded",
    "#chat-message-original",
  ])
    assert.ok(output.includes(text), text)
})

test("reaction events never render a separate bubble", () => {
  assert.equal(html(fixture(whatsappInboundExamples.reaction)), "")
})
test("bubbles use inbox variants, muted metadata and an existing read accent", () => {
  const message = fixture(whatsappInboundExamples.text)
  assert.match(html(message), /data-variant="muted"/)
  message.direction = "outbound"
  message.status = "read"
  const output = html(message)
  assert.match(output, /data-variant="default"/)
  assert.match(output, /text-muted-foreground/)
  assert.match(output, /text-info/)
  assert.doesNotMatch(output, /chat-out|chat-in|chat-wallpaper|chat-bubble/)
})
test("Messenger and Instagram generic cards use the same attached rows", () => {
  for (const channel of ["messenger", "instagram"] as const) {
    const message = fixture({ type: "template", template: {} })
    message.rendered = undefined
    message.normalized = {
      ...message.normalized!,
      channel,
      content: {
        template_type: "generic",
        elements: [
          {
            title: "Order ready",
            subtitle: "Pickup today",
            buttons: [
              {
                type: "web_url",
                title: "Track order",
                url: "https://example.test/order",
              },
            ],
          },
        ],
      },
    } as ThreadMessage["normalized"]
    const output = html(message)
    assert.match(output, /Order ready/)
    assert.match(output, /Pickup today/)
    assert.match(output, /Track order/)
    assert.match(output, /href="https:\/\/example.test\/order"/)
  }
})
