import { test } from "node:test"
import assert from "node:assert/strict"
import { conversationMedia } from "./conversation-media"
import type { ThreadMessage } from "../messages/use-messages"

function message(
  id: string,
  type: string,
  mime: string,
  url = `https://example.test/${id}`
): ThreadMessage {
  return {
    id,
    at: 123,
    direction: "inbound",
    normalized: {
      type,
      content: { caption: "Caption" },
      attachments: [
        { download_url: url, content_type: mime, filename: `${id}.file` },
      ],
    },
  } as ThreadMessage
}

test("gallery follows thread order across image, video and template media, with captions and sender", () => {
  const photo = message("photo", "image", "image/png")
  const video = {
    ...message("video", "video", "video/mp4"),
    direction: "outbound",
  } as ThreadMessage
  const template = message("template", "template", "video/mp4")
  const gallery = conversationMedia([photo, video, template], "Ada")
  assert.deepEqual(
    gallery.map(({ id, type, sender }) => ({ id, type, sender })),
    [
      { id: "photo:0", type: "image", sender: "Ada" },
      { id: "video:0", type: "video", sender: "You" },
      { id: "template:0", type: "video", sender: "Ada" },
    ]
  )
  assert.equal(gallery[0].caption, "Caption")
  assert.equal(gallery[0].src, "https://example.test/photo")
  assert.equal(gallery[0].at, 123)
  // Stable identity survives older messages being prepended.
  assert.equal(
    conversationMedia([message("older", "image", "image/png"), photo], "Ada")[1]
      .id,
    gallery[0].id
  )
})

test("gallery excludes audio, documents, stickers, revoked, failed and unsafe URLs", () => {
  const revoked = message("revoked", "image", "image/png")
  revoked.normalized!.revoked_at = "2026-10-01T00:00:00Z"
  const failed = message("failed", "image", "image/png")
  failed.normalized!.attachments[0].error = "Unavailable"
  const rows = [
    revoked,
    failed,
    message("unsafe", "image", "image/png", "javascript:alert(1)"),
    message("audio", "audio", "audio/ogg"),
    message("document", "document", "image/png"),
    message("sticker", "sticker", "image/webp"),
  ]
  assert.deepEqual(conversationMedia(rows, "Ada"), [])
})

test("generic cards and referral images join the same conversation gallery", () => {
  const row = message("card", "template", "application/pdf")
  row.normalized!.content = {
    elements: [{ title: "Pickup", image_url: "https://example.test/card.png" }],
  }
  row.normalized!.referral = {
    image_url: "https://example.test/ad.png",
    thumbnail_url: "https://example.test/ad-small.png",
    headline: "Sale",
  }
  assert.deepEqual(
    conversationMedia([row], "Ada").map(({ id, caption }) => ({ id, caption })),
    [
      { id: "card:card:0", caption: "Pickup" },
      { id: "card:referral", caption: "Sale" },
    ]
  )
  assert.equal(
    conversationMedia([row], "Ada")[1].src,
    "https://example.test/ad.png"
  )
})
