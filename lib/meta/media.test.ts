import { test } from "node:test"
import assert from "node:assert/strict"
import {
  whatsappMediaLimit,
  validateWhatsAppMedia,
  whatsappMediaMultipart,
  isMediaIdGone,
} from "./media"
test("Meta media MIME types and limits, including OGG/Opus and animated stickers", () => {
  assert.equal(whatsappMediaLimit("image/png"), 5 * 1024 * 1024)
  assert.equal(whatsappMediaLimit("application/pdf"), 100 * 1024 * 1024)
  assert.equal(whatsappMediaLimit("video/3gpp"), 16 * 1024 * 1024)
  assert.equal(whatsappMediaLimit("audio/ogg; codecs=opus"), 16 * 1024 * 1024)
  assert.equal(whatsappMediaLimit("image/webp"), 100 * 1024)
  assert.equal(whatsappMediaLimit("image/webp", true), 500 * 1024)
  for (const type of ["audio/ogg", "audio/webm", "application/octet-stream"])
    assert.throws(() => whatsappMediaLimit(type))
  assert.throws(() => validateWhatsAppMedia(new Uint8Array(), "image/png"))
  assert.throws(() =>
    validateWhatsAppMedia(new Uint8Array(5 * 1024 * 1024 + 1), "image/png")
  )
  const sticker = new Uint8Array(200 * 1024)
  sticker.set(new TextEncoder().encode("VP8X"), 12)
  sticker[20] = 2
  validateWhatsAppMedia(sticker, "image/webp")
  sticker[20] = 0
  assert.throws(() => validateWhatsAppMedia(sticker, "image/webp"))
})
test("multipart round trip preserves non-UTF8 file bytes and sanitizes filenames", async () => {
  const bytes = new Uint8Array([0, 255, 128, 13, 10, 254])
  const body = whatsappMediaMultipart(
    bytes,
    "image/png",
    'a"\r\n.png',
    "test_boundary"
  )
  const form = await new Response(body.bytes, {
    headers: { "content-type": body.contentType },
  }).formData()
  assert.equal(form.get("messaging_product"), "whatsapp")
  const file = form.get("file") as File
  assert.equal(file.name, "a___.png")
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes)
})

test("a media id Meta no longer knows reads as gone; other refusals do not", () => {
  assert.equal(
    isMediaIdGone({ code: 131053, message: "Media upload error" }),
    true
  )
  assert.equal(
    isMediaIdGone({
      code: 100,
      message: "(#100) Invalid parameter",
      details: "Invalid media id",
    }),
    true
  )
  assert.equal(
    isMediaIdGone({ code: 131009, details: "Media ID is not valid" }),
    true
  )
  assert.equal(
    isMediaIdGone({ code: 100, message: "(#100) Invalid parameter" }),
    false
  )
  assert.equal(
    isMediaIdGone({ code: 131026, message: "Media undeliverable" }),
    false
  )
  assert.equal(isMediaIdGone({}), false)
})
