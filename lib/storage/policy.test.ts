import { test } from "node:test"
import assert from "node:assert/strict"
import {
  uploadHint,
  validateUpload,
  verifyUpload,
  type StorageUse,
} from "./policy"

test("upload hints describe the limits for every use", () => {
  const hints: Record<StorageUse, string> = {
    whatsapp:
      "Images up to 5 MB · video and audio up to 16 MB · documents up to 100 MB",
    template: "JPEG, PNG, MP4 or PDF up to 16 MB",
    email: "Up to 30 MB",
    ivr: "WAV, MP3 or OGG, up to 16 MB",
    import: "CSV up to 256 KB",
    asset: "PNG, JPEG, WebP or GIF up to 1 MB",
  }
  for (const [use, hint] of Object.entries(hints))
    assert.equal(uploadHint(use as StorageUse), hint)
})

test("oversized errors describe the file type and limit in MB or KB", () => {
  const cases: [StorageUse, string, number, string, boolean?][] = [
    [
      "whatsapp",
      "image/png",
      5 * 1024 * 1024,
      "WhatsApp images can be up to 5 MB.",
    ],
    [
      "whatsapp",
      "video/mp4",
      16 * 1024 * 1024,
      "WhatsApp videos can be up to 16 MB.",
    ],
    [
      "whatsapp",
      "audio/mpeg",
      16 * 1024 * 1024,
      "WhatsApp audio files can be up to 16 MB.",
    ],
    [
      "whatsapp",
      "application/pdf",
      100 * 1024 * 1024,
      "WhatsApp documents can be up to 100 MB.",
    ],
    [
      "whatsapp",
      "image/webp",
      100 * 1024,
      "WhatsApp stickers can be up to 100 KB.",
    ],
    [
      "whatsapp",
      "image/webp",
      500 * 1024,
      "WhatsApp stickers can be up to 500 KB.",
      true,
    ],
    [
      "template",
      "image/jpeg",
      5 * 1024 * 1024,
      "Template images can be up to 5 MB.",
    ],
    [
      "template",
      "application/pdf",
      16 * 1024 * 1024,
      "Template documents can be up to 16 MB.",
    ],
    [
      "email",
      "application/pdf",
      30 * 1024 * 1024,
      "Email attachments can be up to 30 MB.",
    ],
    [
      "ivr",
      "audio/ogg",
      16 * 1024 * 1024,
      "IVR audio files can be up to 16 MB.",
    ],
    ["import", "text/csv", 256 * 1024, "CSV files can be up to 256 KB."],
    ["asset", "image/png", 1024 * 1024, "Asset images can be up to 1 MB."],
  ]
  for (const [use, contentType, size, message, animated] of cases) {
    validateUpload({ use, contentType, size, animated })
    assert.throws(
      () => validateUpload({ use, contentType, size: size + 1, animated }),
      { message }
    )
  }
})

test("invalid sizes and types produce readable errors before transfer", () => {
  for (const size of [0, -1, NaN, Infinity, 1.5])
    assert.throws(
      () => validateUpload({ use: "import", contentType: "text/csv", size }),
      { message: "Choose a non-empty file for csv files." }
    )
  assert.throws(
    () =>
      validateUpload({ use: "template", contentType: "audio/ogg", size: 1 }),
    { message: "Use a JPEG, PNG, MP4 or PDF template sample." }
  )
  assert.throws(
    () =>
      validateUpload({ use: "ivr", contentType: "application/pdf", size: 1 }),
    { message: "Upload a WAV, MP3 or OGG IVR prompt." }
  )
  assert.throws(
    () => validateUpload({ use: "import", contentType: "image/png", size: 1 }),
    { message: "Upload a CSV file." }
  )
  assert.throws(
    () =>
      validateUpload({ use: "asset", contentType: "image/svg+xml", size: 1 }),
    { message: "Upload a PNG, JPEG, WebP or GIF image." }
  )
  assert.throws(
    () =>
      validateUpload({
        use: "email",
        contentType: "text/plain\r\nx-header: value",
        size: 1,
      }),
    /Invalid file type/
  )
})

test("browser and server validation handle MIME parameters consistently", () => {
  validateUpload({
    use: "ivr",
    contentType: "audio/ogg; codecs=opus",
    size: 16 * 1024 * 1024,
  })
  validateUpload({
    use: "template",
    contentType: " IMAGE/PNG ",
    size: 5 * 1024 * 1024,
  })
  validateUpload({
    use: "import",
    contentType: "text/csv; charset=utf-8",
    size: 256 * 1024,
  })
  validateUpload({
    use: "whatsapp",
    contentType: "audio/ogg; codecs=opus",
    size: 16 * 1024 * 1024,
  })
  assert.throws(
    () =>
      validateUpload({ use: "whatsapp", contentType: "audio/ogg", size: 1 }),
    /OGG requires codecs=opus/
  )
})

test("kind limits without a Convex storage cap are enforced before transfers", () => {
  const cases: [string, number, boolean?][] = [
    ["image/png", 5 * 1024 * 1024],
    ["video/mp4", 16 * 1024 * 1024],
    ["audio/mpeg", 16 * 1024 * 1024],
    ["application/pdf", 100 * 1024 * 1024],
    ["image/webp", 100 * 1024],
    ["image/webp", 500 * 1024, true],
  ]
  for (const [contentType, size, animated] of cases) {
    validateUpload({ use: "whatsapp", contentType, size, animated })
    assert.throws(() =>
      validateUpload({ use: "whatsapp", contentType, size: size + 1, animated })
    )
  }
  validateUpload({
    use: "whatsapp",
    contentType: "application/pdf",
    size: 100 * 1024 * 1024,
  })
  validateUpload({
    use: "email",
    contentType: "text/plain",
    size: 30 * 1024 * 1024,
  })
  assert.throws(() =>
    validateUpload({ use: "email", contentType: "text/plain", size: NaN })
  )
  assert.throws(() =>
    validateUpload({ use: "asset", contentType: "image/svg+xml", size: 1 })
  )
})
test("completion requires exact size and type", () => {
  const file = { size: 5, contentType: "image/png" }
  verifyUpload(file, file)
  assert.throws(() => verifyUpload(file, { ...file, size: 6 }), /size/)
  assert.throws(
    () => verifyUpload(file, { ...file, contentType: "text/html" }),
    /type/
  )
})
