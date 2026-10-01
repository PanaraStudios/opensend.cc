import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  skipReasonLabel,
  SKIP_REASON_TONE,
  metaTemplateStatusLabel,
  tenantStatusLabel,
  httpStatusLabel,
  httpStatusTone,
  messagingLimitLabel,
  normalizeHref,
} from "./format"

describe("normalizeHref", () => {
  it("keeps web addresses, mail and phone links, anchors and merge tags", () => {
    for (const href of [
      "https://opensend.cc/a?b=1",
      "http://example.com",
      "mailto:hello@opensend.cc",
      "tel:+15551234567",
      "#pricing",
      "{{{OPENSEND_UNSUBSCRIBE_URL}}}",
    ]) {
      assert.equal(normalizeHref(href), href)
    }
  })

  it("reads a bare domain as https", () => {
    assert.equal(
      normalizeHref(" example.com/pricing "),
      "https://example.com/pricing"
    )
  })

  it("refuses anything that would run or is not an address", () => {
    assert.equal(normalizeHref("javascript:alert(1)"), null)
    assert.equal(normalizeHref("data:text/html,<script>1</script>"), null)
    assert.equal(normalizeHref("not a link"), null)
  })

  it("leaves an empty value empty, which clears the link", () => {
    assert.equal(normalizeHref("   "), "")
  })
})

describe("httpStatusTone", () => {
  it("reads a missing response as a failure", () => {
    assert.equal(httpStatusTone(204), "success")
    assert.equal(httpStatusTone(301), "warning")
    assert.equal(httpStatusTone(500), "destructive")
    assert.equal(httpStatusTone(0), "destructive")
  })

  it("labels a missing response in words", () => {
    assert.equal(httpStatusLabel(0), "No response")
    assert.equal(httpStatusLabel(502), "502")
  })
})

describe("messagingLimitLabel", () => {
  it("reads Meta's messaging limit tiers", () => {
    assert.equal(messagingLimitLabel("TIER_250"), "250 per 24 hours")
    assert.equal(messagingLimitLabel("TIER_10K"), "10K per 24 hours")
    assert.equal(messagingLimitLabel("TIER_UNLIMITED"), "Unlimited")
    assert.equal(messagingLimitLabel(undefined), "Unknown")
  })
})

describe("campaign outcomes", () => {
  it("labels technical skip words and keeps opt-outs neutral", () => {
    assert.equal(skipReasonLabel("no_phone"), "No phone number")
    assert.equal(skipReasonLabel("contact_deleted"), "Contact deleted")
    assert.equal(skipReasonLabel("missing_variables"), "Missing variables")
    assert.equal(SKIP_REASON_TONE.marketing_opt_out, "secondary")
    assert.equal(SKIP_REASON_TONE.missing_variables, "warning")
  })
  it("uses the same sentence spelling for Meta and tenant statuses", () => {
    assert.equal(metaTemplateStatusLabel("IN_APPEAL"), "In appeal")
    assert.equal(tenantStatusLabel("IN_APPEAL"), "In appeal")
    assert.equal(tenantStatusLabel(), "Unknown")
  })
})
