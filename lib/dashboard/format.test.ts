import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { normalizeHref } from "./format"

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
