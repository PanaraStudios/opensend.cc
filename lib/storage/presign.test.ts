import { test } from "node:test"
import assert from "node:assert/strict"
import { presignPut, presignGet } from "../../convex/storage/objects"

test("real AWS v3 presigner binds type/length and uses R2 path-style signing", async () => {
  const settings = {
    OBJECT_STORAGE_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    OBJECT_STORAGE_REGION: "auto",
    OBJECT_STORAGE_BUCKET: "files",
    OBJECT_STORAGE_ACCESS_KEY_ID: "test-key",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-secret",
  }
  const old = Object.fromEntries(
    Object.keys(settings).map((key) => [key, process.env[key]])
  )
  try {
    Object.assign(process.env, settings)
    const put = new URL(
      await presignPut({
        key: "teams/org/media/2026/10/id",
        contentType: "application/pdf",
        size: 21 * 1024 * 1024,
        expiresIn: 900,
      })
    )
    assert.equal(put.hostname, "account.r2.cloudflarestorage.com")
    assert.equal(put.pathname, "/files/teams/org/media/2026/10/id")
    assert.equal(
      put.searchParams.get("X-Amz-SignedHeaders"),
      "content-length;content-type;host"
    )
    assert.equal(put.searchParams.get("X-Amz-Expires"), "900")
    assert.ok(put.searchParams.get("X-Amz-Signature"))
    const get = new URL(
      await presignGet({
        key: "teams/org/media/2026/10/id",
        filename: "résumé.pdf",
        disposition: "attachment",
        expiresIn: 600,
      })
    )
    assert.equal(
      get.searchParams.get("response-content-disposition"),
      "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"
    )
    assert.equal(get.searchParams.get("X-Amz-Expires"), "600")
  } finally {
    for (const [key, value] of Object.entries(old))
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
  }
})
