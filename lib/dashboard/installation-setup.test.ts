import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { setupSteps, inferredSetupStep } from "./installation-setup"

describe("wizard routing", () => {
  it("skips resources and domains only after choosing email later", () => {
    assert.deepEqual(setupSteps(false), [
      "welcome",
      "aws",
      "callback",
      "resources",
      "team",
      "domain",
    ])
    assert.deepEqual(setupSteps(true), ["welcome", "aws", "callback", "team"])
    const steps = setupSteps(true)
    assert.equal(steps[steps.indexOf("team") - 1], "callback")
  })
  it("resumes the deferred flow at callback until it is checked, then at team", () => {
    assert.equal(inferredSetupStep(null, false, false), "welcome")
    assert.equal(
      inferredSetupStep({ emailDeferredAt: 1 }, false, false),
      "callback"
    )
    assert.equal(
      inferredSetupStep(
        { emailDeferredAt: 1, environmentCheckedAt: 1 },
        false,
        true
      ),
      "team"
    )
  })
  it("keeps AWS-first prerequisites and steps", () => {
    const installation = { accountId: "123456789012" }
    assert.equal(inferredSetupStep(installation, false, false), "callback")
    const checked = { ...installation, environmentCheckedAt: 1 }
    assert.equal(inferredSetupStep(checked, false, true), "resources")
    assert.equal(inferredSetupStep(checked, true, false), "team")
    assert.equal(inferredSetupStep(checked, true, true), "domain")
  })
})
