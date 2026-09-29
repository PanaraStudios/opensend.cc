import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { percent, rate } from "./format"
import { emptyEmailCounts, eventCount, senderDomain } from "./metrics"

describe("rate", () => {
  it("rounds to the requested digits and guards an empty total", () => {
    assert.equal(rate(1, 7), 14)
    assert.equal(rate(1, 7, 2), 14.29)
    assert.equal(rate(1, 0), 0)
    assert.equal(percent(1, 7, 2), "14.29%")
  })
})

describe("senderDomain", () => {
  it("reads the domain from a display-name address", () => {
    assert.equal(senderDomain("Billing <billing@OpenSend.cc>"), "opensend.cc")
    assert.equal(senderDomain("login@opensend.cc"), "opensend.cc")
    assert.equal(senderDomain("nobody"), "unknown")
  })
})

describe("eventCount", () => {
  it("charts lifecycle events even after emails moved past them", () => {
    // 3 sent: one delivered, one bounced, one delivered then complained.
    const counts = {
      ...emptyEmailCounts(),
      sent: 3,
      delivered: 2,
      bounced: 1,
      complained: 1,
      status: { delivered: 1, bounced: 1, complained: 1, suppressed: 1 },
    }
    assert.equal(eventCount(counts, null), 3)
    assert.equal(eventCount(counts, "sent"), 3)
    assert.equal(eventCount(counts, "delivered"), 2)
    assert.equal(eventCount(counts, "bounced"), 1)
    assert.equal(eventCount(counts, "suppressed"), 1)
    assert.equal(eventCount(counts, "failed"), 0)
  })
})
