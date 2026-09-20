import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { createTotpSecret, totpCode, totpUri, verifyTotp } from "./totp"

/* RFC 6238's SHA-1 secret, "12345678901234567890", in base32. */
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

describe("totp", () => {
  it("matches the RFC 6238 vectors, cut to six digits", async () => {
    assert.equal(await totpCode(SECRET, 59_000), "287082")
    assert.equal(await totpCode(SECRET, 1_111_111_109_000), "081804")
    assert.equal(await totpCode(SECRET, 2_000_000_000_000), "279037")
  })

  it("allows one step of drift either way, and no more", async () => {
    const at = 1_111_111_109_000
    const code = await totpCode(SECRET, at)
    assert.equal(await verifyTotp(SECRET, code, at + 30_000), true)
    assert.equal(await verifyTotp(SECRET, code, at - 30_000), true)
    assert.equal(await verifyTotp(SECRET, code, at + 90_000), false)
    assert.equal(await verifyTotp(SECRET, "000000", at), false)
  })

  it("makes base32 secrets and an otpauth link", () => {
    assert.match(createTotpSecret(), /^[A-Z2-7]{32}$/)
    assert.equal(
      totpUri("ABC", "ada@example.com", "Opensend"),
      "otpauth://totp/Opensend%3Aada%40example.com?secret=ABC&issuer=Opensend"
    )
  })
})
