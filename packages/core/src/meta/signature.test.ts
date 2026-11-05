import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { describe, it } from "node:test"
import { metaSignature, sameSecret, verifyMetaSignature } from "./signature"

const secret = "app-secret"
const body = '{"object":"whatsapp_business_account","entry":[]}'
const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

describe("X-Hub-Signature-256", () => {
  it("matches Node's HMAC-SHA256 for text and bytes", async () => {
    assert.equal(await metaSignature(secret, body), expected)
    assert.equal(
      await metaSignature(secret, new TextEncoder().encode(body)),
      expected
    )
  })
  it("verifies only the exact body with the same secret", async () => {
    assert.equal(await verifyMetaSignature(secret, body, expected), true)
    assert.equal(
      await verifyMetaSignature(
        secret,
        body,
        expected.toUpperCase().replace("SHA256=", "sha256=")
      ),
      true
    )
    assert.equal(await verifyMetaSignature(secret, `${body} `, expected), false)
    assert.equal(await verifyMetaSignature("other", body, expected), false)
  })
  it("rejects missing and malformed headers", async () => {
    for (const header of [
      null,
      undefined,
      "",
      expected.slice("sha256=".length),
      "sha1=" + expected.slice("sha256=".length),
      "sha256=zz",
      `${expected}00`,
    ])
      assert.equal(await verifyMetaSignature(secret, body, header), false)
    assert.equal(await verifyMetaSignature("", body, expected), false)
  })
})

describe("sameSecret", () => {
  it("matches only identical strings", () => {
    assert.equal(sameSecret("os_token", "os_token"), true)
    for (const other of ["os_tokem", "os_toke", "os_token ", ""])
      assert.equal(sameSecret("os_token", other), false, other)
  })
})
