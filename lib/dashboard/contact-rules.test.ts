import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  contactEmailError,
  contactFieldsError,
  effectiveTopicSubscription,
  mergeContactFields,
  propertyKeyError,
} from "./contacts"
import { rangeBounds } from "./email-range"

describe("propertyKeyError", () => {
  it("refuses malformed, reserved and taken keys", () => {
    assert.match(propertyKeyError("1abc", [])!, /lowercase key/)
    assert.equal(propertyKeyError("email", []), "That key already exists")
    assert.equal(propertyKeyError("plan", ["plan"]), "That key already exists")
    assert.equal(propertyKeyError("plan", []), null)
  })
})

describe("contact validation", () => {
  const properties = [
    { key: "plan", type: "string" as const },
    { key: "seats", type: "number" as const },
  ]
  it("checks addresses", () => {
    assert.equal(contactEmailError("ada@example.com"), null)
    assert.match(contactEmailError("ada")!, /not a valid email/)
  })
  it("checks property keys and number values", () => {
    assert.equal(
      contactFieldsError(
        { properties: { plan: "pro", seats: "3" } },
        properties
      ),
      null
    )
    assert.equal(
      contactFieldsError({ properties: { seats: "" } }, properties),
      null
    )
    assert.equal(
      contactFieldsError({ properties: { seats: "x" } }, properties),
      "seats must be a number"
    )
    assert.equal(
      contactFieldsError({ properties: { other: "x" } }, properties),
      "Unknown property: other"
    )
  })
})

describe("mergeContactFields", () => {
  it("keeps stored names over blanks and merges properties", () => {
    assert.deepEqual(
      mergeContactFields(
        {
          firstName: "Ada",
          lastName: "L",
          unsubscribed: false,
          properties: { plan: "pro" },
        },
        { firstName: " ", unsubscribed: true, properties: { seats: "2" } }
      ),
      {
        firstName: "Ada",
        lastName: "L",
        unsubscribed: true,
        properties: { plan: "pro", seats: "2" },
      }
    )
  })
})

describe("effectiveTopicSubscription", () => {
  it("uses the explicit choice, else the topic's default", () => {
    const optOut = { defaultSubscription: "opt_out" as const }
    const optIn = { defaultSubscription: "opt_in" as const }
    assert.equal(effectiveTopicSubscription(undefined, optOut), "subscribed")
    assert.equal(effectiveTopicSubscription(undefined, optIn), "unsubscribed")
    assert.equal(
      effectiveTopicSubscription("unsubscribed", optOut),
      "unsubscribed"
    )
  })
})

describe("rangeBounds", () => {
  it("spans whole days, and nothing for all time", () => {
    assert.deepEqual(rangeBounds(undefined), {})
    const day = new Date(2026, 8, 28, 15)
    const { from, to } = rangeBounds({ from: day })
    assert.equal(new Date(from!).getHours(), 0)
    assert.equal(to! - from!, 86_400_000 - 1)
  })
})
