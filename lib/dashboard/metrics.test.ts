import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { SEED_STATE } from "./data"
import { rangeFromPreset } from "./email-range"
import { percent, rate } from "./format"
import { eventCount, senderDomain, summarizeEmails } from "./metrics"

const RANGE = rangeFromPreset("15d")

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

describe("summarizeEmails", () => {
  it("returns one row per day in the range", () => {
    const { days } = summarizeEmails(SEED_STATE.emails, RANGE, null, null)
    assert.equal(days.length, 15)
  })

  it("keeps day and domain counts in step with the totals", () => {
    const { totals, days, domains } = summarizeEmails(
      SEED_STATE.emails,
      RANGE,
      null,
      null
    )
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
    assert.equal(sum(days.map((day) => day.sent)), totals.sent)
    assert.equal(sum(domains.map((row) => row.counts.sent)), totals.sent)
    assert.equal(sum(days.map((day) => day.events)), totals.sent)
  })

  it("filters by domain and charts the picked status", () => {
    const all = summarizeEmails(SEED_STATE.emails, RANGE, null, "bounced")
    const none = summarizeEmails(SEED_STATE.emails, RANGE, "nope.dev", null)
    assert.equal(none.totals.sent, 0)
    assert.equal(
      all.days.reduce((total, day) => total + day.events, 0),
      eventCount(all.totals, "bounced")
    )
  })

  it("counts a click as an open and a delivery", () => {
    const { totals } = summarizeEmails(SEED_STATE.emails, RANGE, null, null)
    assert.ok(totals.delivered >= totals.opened)
    assert.ok(totals.opened >= totals.clicked)
  })
})
