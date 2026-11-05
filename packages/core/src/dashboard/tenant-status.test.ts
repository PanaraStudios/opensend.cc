import assert from "node:assert/strict"
import { test } from "node:test"
import { tenantStatusLabel, TENANT_STATUS_TONE } from "./format"

for (const [status, label, tone] of [
  ["ENABLED", "Enabled", "success"],
  ["DISABLED", "Disabled", "warning"],
  ["REINSTATED", "Reinstated", "success"],
  ["UNKNOWN", "Unknown", "warning"],
] as const)
  test(`tenant ${status} uses a sentence-case label and matching tone`, () => {
    assert.equal(tenantStatusLabel(status), label)
    assert.equal(TENANT_STATUS_TONE[status], tone)
  })

test("missing and future tenant states have readable labels", () => {
  assert.equal(tenantStatusLabel(), "Unknown")
  assert.equal(tenantStatusLabel("PENDING_REVIEW"), "Pending review")
})
