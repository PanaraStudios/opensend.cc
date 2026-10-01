import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { setupSteps, inferredSetupStep } from "./installation-setup"

describe("wizard routing", () => {
  it("skips resources and domains only after choosing email later", () => {
    assert.deepEqual(setupSteps({ accountId: "aws" }), [
      "welcome",
      "aws",
      "callback",
      "resources",
      "team",
      "domain",
    ])
    assert.deepEqual(setupSteps({ emailDeferredAt: 1 }), [
      "welcome",
      "aws",
      "callback",
      "team",
    ])
    const steps = setupSteps({ emailDeferredAt: 1 })
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

describe("channel selection step sequences", () => {
  const email = { channels: { email: true, meta: false } }
  const meta = { channels: { email: false, meta: true } }
  const both = { channels: { email: true, meta: true } }
  it("asks before either provider and checks the callback first", () => {
    assert.deepEqual(setupSteps({}), [
      "welcome",
      "channels",
      "callback",
      "team",
    ])
    assert.deepEqual(setupSteps(email), [
      "welcome",
      "channels",
      "callback",
      "aws",
      "resources",
      "team",
      "domain",
    ])
    assert.deepEqual(setupSteps(meta), [
      "welcome",
      "channels",
      "callback",
      "meta",
      "team",
    ])
    assert.deepEqual(setupSteps(both), [
      "welcome",
      "channels",
      "callback",
      "aws",
      "resources",
      "meta",
      "team",
      "domain",
    ])
  })
  it("email deferral removes only AWS resources and domain; Meta deferral keeps its return step", () => {
    assert.deepEqual(setupSteps({ ...both, emailDeferredAt: 1 }), [
      "welcome",
      "channels",
      "callback",
      "aws",
      "meta",
      "team",
    ])
    assert.deepEqual(
      setupSteps({ ...both, metaDeferredAt: 1 }),
      setupSteps(both)
    )
    assert.equal(
      inferredSetupStep(
        {
          ...both,
          emailDeferredAt: 1,
          metaDeferredAt: 1,
          environmentCheckedAt: 1,
        },
        false,
        true
      ),
      "team"
    )
    assert.equal(inferredSetupStep(meta, false, false), "callback")
    assert.equal(
      inferredSetupStep({ ...meta, environmentCheckedAt: 1 }, false, false),
      "meta"
    )
    assert.equal(
      inferredSetupStep(
        { ...meta, environmentCheckedAt: 1 },
        false,
        true,
        true
      ),
      "team"
    )
  })
})
