import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  contactMatches,
  isReservedPropertyKey,
  isValidPropertyKey,
  normalizePropertyKey,
  segmentContactCounts,
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

describe("segmentContactCounts", () => {
  it("counts every segment in one pass", () => {
    const counts = segmentContactCounts(SEED_STATE.contacts)
    for (const segment of SEED_STATE.segments) {
      const expected = SEED_STATE.contacts.filter((contact) =>
        contact.segmentIds.includes(segment.id)
      ).length
      assert.equal(counts.get(segment.id) ?? 0, expected)
    }
  })
})

describe("search helpers", () => {
  it("matches any field case-insensitively and matches all on empty", () => {
    const contact = SEED_STATE.contacts[0]!
    assert.equal(contactMatches(contact, ""), true)
    assert.equal(
      contactMatches(contact, searchNeedle(contact.email.toUpperCase())),
      true
    )
    assert.equal(matchesNeedle("zzz", "abc", undefined), false)
  })
})
