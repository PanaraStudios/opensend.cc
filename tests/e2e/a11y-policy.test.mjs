import { test } from "node:test"
import assert from "node:assert/strict"
import { blocksA11yTour } from "./a11y-policy.ts"

test("accessibility gate blocks serious/critical issues, retaining lower impacts for review", () => {
  for (const impact of ["critical", "serious"])
    assert.equal(blocksA11yTour({ ruleId: "button-name", impact }), true)
  for (const impact of ["moderate", "minor", null])
    assert.equal(blocksA11yTour({ ruleId: "heading-order", impact }), false)
})

test("an explicit exception only exempts that rule, including at critical impact", () => {
  const allowlist = new Set(["third-party-rule"])
  assert.equal(
    blocksA11yTour(
      { ruleId: "third-party-rule", impact: "critical" },
      allowlist
    ),
    false
  )
  assert.equal(
    blocksA11yTour({ ruleId: "button-name", impact: "serious" }, allowlist),
    true
  )
  assert.equal(
    blocksA11yTour({ ruleId: "button-name", impact: "critical" }, allowlist),
    true
  )
})
