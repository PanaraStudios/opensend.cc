import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { apiKeyDomainLabel } from "./api-keys"
import type { Domain } from "./types"

describe("apiKeyDomainLabel", () => {
  const domains = [
    { id: "dom_opensend", name: "opensend.cc" },
  ] as unknown as Domain[]

  it("names the restricted domain", () => {
    assert.equal(
      apiKeyDomainLabel(domains, { domainId: "dom_opensend" }),
      "opensend.cc"
    )
  })

  it("keeps removed domain restrictions visible", () => {
    assert.equal(apiKeyDomainLabel(domains, { domainId: null }), "All domains")
    assert.equal(
      apiKeyDomainLabel(domains, { domainId: "dom_gone" }),
      "Removed domain (sending disabled)"
    )
  })
})
