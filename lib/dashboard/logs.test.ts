import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { formatRelative } from "./format"
import { logStatusClass, normalizeLog, tokenizeJson } from "./logs"
import type { ApiLog } from "./types"

describe("tokenizeJson", () => {
  it("round-trips the source and separates keys from strings", () => {
    const source = JSON.stringify({ to: ["a@b.co"], n: 2, ok: true }, null, 2)
    const tokens = tokenizeJson(source)
    assert.equal(tokens.map((token) => token.value).join(""), source)
    assert.deepEqual(
      tokens.filter((token) => token.kind !== "punct"),
      [
        { kind: "key", value: '"to"' },
        { kind: "string", value: '"a@b.co"' },
        { kind: "key", value: '"n"' },
        { kind: "literal", value: "2" },
        { kind: "key", value: '"ok"' },
        { kind: "literal", value: "true" },
      ]
    )
  })
})

describe("logStatusClass", () => {
  it("buckets by hundreds", () => {
    assert.equal(logStatusClass(201), "2xx")
    assert.equal(logStatusClass(304), "3xx")
    assert.equal(logStatusClass(422), "4xx")
    assert.equal(logStatusClass(503), "5xx")
  })
})

describe("normalizeLog", () => {
  it("backfills fields missing from older persisted logs", () => {
    const legacy = { id: "log_1", status: 200 } as ApiLog
    const log = normalizeLog(legacy)
    assert.equal(log.source, "dashboard")
    assert.equal(log.apiKeyId, null)
    assert.ok(log.userAgent)
  })
})

describe("formatRelative", () => {
  it("uses the largest whole unit", () => {
    const now = 1_000_000_000_000
    assert.equal(formatRelative(now - 30_000, now), "just now")
    assert.equal(formatRelative(now - 5 * 60_000, now), "5m ago")
    assert.equal(formatRelative(now - 3 * 3_600_000, now), "3h ago")
    assert.equal(formatRelative(now - 18 * 86_400_000, now), "18d ago")
  })
})
