import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { apiKeyDomainLabel, apiKeyLogs, filterApiKeys } from "./api-keys"
import { searchNeedle } from "./search"
import type { ApiKey, ApiLog, Domain } from "./types"

function key(patch: Partial<ApiKey>): ApiKey {
  return {
    id: "key_1",
    name: "Production",
    tokenPrefix: "os_9f2a1c4e",
    tokenLast4: "k3m8",
    permission: "full_access",
    domainId: null,
    createdAt: 0,
    lastUsedAt: null,
    ...patch,
  }
}

function log(patch: Partial<ApiLog>): ApiLog {
  return {
    id: "log_1",
    method: "POST",
    path: "/emails",
    status: 200,
    createdAt: 0,
    durationMs: 10,
    emailId: null,
    userAgent: "curl/8.7.1",
    source: "api",
    apiKeyId: null,
    ...patch,
  }
}

const keys: ApiKey[] = [
  key({ id: "key_prod", name: "Production" }),
  key({
    id: "key_staging",
    name: "Staging",
    permission: "sending_access",
    domainId: "dom_opensend",
    tokenPrefix: "os_b71e0d22",
  }),
  key({
    id: "key_ci",
    name: "CI",
    permission: "sending_access",
    tokenPrefix: "os_c8aa55d0",
  }),
]

describe("filterApiKeys", () => {
  it("returns every key with no needle and no permission filter", () => {
    const rows = filterApiKeys(keys, { needle: "", permission: "all" })
    assert.equal(rows.length, 3)
  })

  it("matches the name case-insensitively", () => {
    const rows = filterApiKeys(keys, {
      needle: searchNeedle("  StAg "),
      permission: "all",
    })
    assert.deepEqual(
      rows.map((row) => row.id),
      ["key_staging"]
    )
  })

  it("matches the visible token prefix", () => {
    const rows = filterApiKeys(keys, {
      needle: searchNeedle("c8aa"),
      permission: "all",
    })
    assert.deepEqual(
      rows.map((row) => row.id),
      ["key_ci"]
    )
  })

  it("narrows to one permission", () => {
    const rows = filterApiKeys(keys, {
      needle: "",
      permission: "sending_access",
    })
    assert.deepEqual(
      rows.map((row) => row.id),
      ["key_staging", "key_ci"]
    )
  })

  it("intersects the needle and the permission", () => {
    const rows = filterApiKeys(keys, {
      needle: searchNeedle("production"),
      permission: "sending_access",
    })
    assert.equal(rows.length, 0)
  })
})

describe("apiKeyLogs", () => {
  const logs: ApiLog[] = [
    log({ id: "log_1", apiKeyId: "key_prod" }),
    log({ id: "log_2", apiKeyId: null }),
    log({ id: "log_3", apiKeyId: "key_ci" }),
    log({ id: "log_4", apiKeyId: "key_prod" }),
  ]

  it("keeps only the requests signed with the key, in order", () => {
    assert.deepEqual(
      apiKeyLogs(logs, "key_prod").map((item) => item.id),
      ["log_1", "log_4"]
    )
  })

  it("never matches dashboard requests that carry no key", () => {
    assert.deepEqual(apiKeyLogs(logs, "key_missing"), [])
  })

  it("counts total uses", () => {
    assert.equal(apiKeyLogs(logs, "key_prod").length, 2)
    assert.equal(apiKeyLogs(logs, "key_ci").length, 1)
    assert.equal(apiKeyLogs(logs, "key_staging").length, 0)
  })
})

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

  it("falls back to all domains when unrestricted or deleted", () => {
    assert.equal(apiKeyDomainLabel(domains, { domainId: null }), "All domains")
    assert.equal(
      apiKeyDomainLabel(domains, { domainId: "dom_gone" }),
      "All domains"
    )
  })
})
