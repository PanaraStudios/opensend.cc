import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  isReservedPropertyKey,
  isValidPropertyKey,
  normalizePropertyKey,
} from "./contacts"
import { SEED_STATE } from "./data"
import { matchesNeedle, searchNeedle } from "./search"

describe("normalizePropertyKey", () => {
  it("lowercases, trims, and joins words with underscores", () => {
    assert.equal(normalizePropertyKey("  Company Name "), "company_name")
    assert.equal(isValidPropertyKey("company_name"), true)
    assert.equal(isValidPropertyKey("1abc"), false)
    assert.equal(isReservedPropertyKey("email"), true)
    assert.equal(isReservedPropertyKey("company"), false)
  })
})

describe("search helpers", () => {
  it("matches any field case-insensitively and matches all on empty", () => {
    const contact = SEED_STATE.contacts[0]!
    assert.equal(matchesNeedle("", contact.email), true)
    assert.equal(
      matchesNeedle(searchNeedle(contact.email.toUpperCase()), contact.email),
      true
    )
    assert.equal(matchesNeedle("zzz", "abc", undefined), false)
  })
})
