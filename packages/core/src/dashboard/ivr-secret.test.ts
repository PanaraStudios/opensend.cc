import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  IVR_SIGNING_SECRET_PLACEHOLDER,
  revealedIvrSigningSecret,
  revealedIvrSigningSecretFromResult,
} from "./ivr-secret"

describe("revealedIvrSigningSecret", () => {
  it("hides the read placeholder and empty values", () => {
    assert.equal(revealedIvrSigningSecret(IVR_SIGNING_SECRET_PLACEHOLDER), null)
    assert.equal(
      revealedIvrSigningSecret(`  ${IVR_SIGNING_SECRET_PLACEHOLDER}  `),
      null
    )
    assert.equal(revealedIvrSigningSecret(""), null)
    assert.equal(revealedIvrSigningSecret("   "), null)
    assert.equal(revealedIvrSigningSecret(null), null)
    assert.equal(revealedIvrSigningSecret(undefined), null)
    assert.equal(revealedIvrSigningSecret(0), null)
  })

  it("returns a create or rotate secret unchanged", () => {
    assert.equal(revealedIvrSigningSecret("shown-once"), "shown-once")
  })
})

describe("revealedIvrSigningSecretFromResult", () => {
  it("reads only a real secret from the response field", () => {
    assert.equal(
      revealedIvrSigningSecretFromResult({
        id: "ivr",
        webhook_signing_secret: "shown-once",
      }),
      "shown-once"
    )
    assert.equal(
      revealedIvrSigningSecretFromResult({
        webhook_signing_secret: IVR_SIGNING_SECRET_PLACEHOLDER,
      }),
      null
    )
    assert.equal(revealedIvrSigningSecretFromResult({ id: "ivr" }), null)
    assert.equal(revealedIvrSigningSecretFromResult(null), null)
    assert.equal(revealedIvrSigningSecretFromResult("shown-once"), null)
  })
})
