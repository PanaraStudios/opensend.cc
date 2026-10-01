import { test } from "node:test"
import assert from "node:assert/strict"
import { objectKey, validateUpload, verifyUpload } from "./policy"

test("keys use UTC date and reject path traversal in every segment", () => {
  assert.equal(
    objectKey("org_1", "media", "uuid-1", Date.UTC(2026, 9, 1)),
    "teams/org_1/media/2026/10/uuid-1"
  )
  for (const unsafe of ["../team", "a/b", "a%2Fb", "", "file.png"])
    for (let index = 0; index < 3; index++) {
      const segments = ["org", "media", "id"]
      segments[index] = unsafe
      assert.throws(() => objectKey(segments[0], segments[1], segments[2]))
    }
})
test("kind limits and local fallback are enforced before transfers", () => {
  const cases: [string, number, boolean?][] = [
    ["image/png", 5 * 1024 * 1024],
    ["video/mp4", 16 * 1024 * 1024],
    ["audio/mpeg", 16 * 1024 * 1024],
    ["application/pdf", 100 * 1024 * 1024],
    ["image/webp", 100 * 1024],
    ["image/webp", 500 * 1024, true],
  ]
  for (const [contentType, size, animated] of cases) {
    validateUpload({ use: "whatsapp", contentType, size, animated }, true)
    assert.throws(() =>
      validateUpload(
        { use: "whatsapp", contentType, size: size + 1, animated },
        true
      )
    )
  }
  assert.throws(
    () =>
      validateUpload(
        {
          use: "whatsapp",
          contentType: "application/pdf",
          size: 21 * 1024 * 1024,
        },
        false
      ),
    /20 MB/
  )
  assert.throws(() =>
    validateUpload({ use: "email", contentType: "text/plain", size: NaN }, true)
  )
  assert.throws(() =>
    validateUpload(
      { use: "asset", contentType: "image/svg+xml", size: 1 },
      true
    )
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
