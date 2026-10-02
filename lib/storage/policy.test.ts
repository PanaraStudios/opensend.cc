import { test } from "node:test"
import assert from "node:assert/strict"
import { validateUpload, verifyUpload } from "./policy"

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
