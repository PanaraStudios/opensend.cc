import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { SEED_STATE } from "./data"
import {
  availableVariables,
  formatVariable,
  hasUnsubscribeLink,
  parseVariables,
  UNSUBSCRIBE_VARIABLE,
  usedVariables,
} from "./email-variables"

describe("formatVariable and parseVariables", () => {
  it("round-trips a name with and without a fallback", () => {
    const source = `${formatVariable("contact.first_name", "there")} ${formatVariable("contact.plan")}`
    assert.deepEqual(parseVariables(source), [
      { name: "contact.first_name", fallback: "there" },
      { name: "contact.plan", fallback: "" },
    ])
  })

  it("still reads the older upper-case tags", () => {
    assert.deepEqual(parseVariables("Hi {{{FIRST_NAME}}}"), [
      { name: "FIRST_NAME", fallback: "" },
    ])
  })
})

describe("usedVariables", () => {
  it("lists each name once", () => {
    assert.deepEqual(usedVariables("{{{a}}} {{{b|x}}} {{{a|y}}}"), ["a", "b"])
  })
})

describe("hasUnsubscribeLink", () => {
  it("finds the opt-out tag inside exported markup", () => {
    assert.equal(
      hasUnsubscribeLink(`<a href="${UNSUBSCRIBE_VARIABLE}">Unsubscribe</a>`),
      true
    )
    assert.equal(hasUnsubscribeLink("<p>No link here</p>"), false)
  })
})

describe("availableVariables", () => {
  it("adds custom contact properties after the built-in ones, once each", () => {
    const base = SEED_STATE.properties[0]!
    const variables = availableVariables([
      { ...base, key: "plan", name: "Plan", fallbackValue: "free" },
      { ...base, key: "first_name", name: "Duplicate" },
    ])
    const plan = variables.find((one) => one.name === "contact.plan")
    assert.deepEqual(plan, {
      name: "contact.plan",
      label: "Plan",
      fallback: "free",
      group: "contact",
    })
    assert.equal(
      variables.filter((one) => one.name === "contact.first_name").length,
      1
    )
  })
})
