import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { slugify, uniqueSlug } from "./slug"

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(slugify("Acme Inc"), "acme-inc")
  })

  it("strips punctuation and apostrophes", () => {
    assert.equal(slugify("Kamal's Lab"), "kamals-lab")
  })

  it("returns empty for blank input", () => {
    assert.equal(slugify("   "), "")
  })
})

describe("uniqueSlug", () => {
  it("keeps the base slug when it is free", () => {
    assert.equal(uniqueSlug("Acme", ["opensend"], "team"), "acme")
  })

  it("suffixes when the slug is taken", () => {
    assert.equal(uniqueSlug("Acme", ["acme", "acme-2"], "team"), "acme-3")
  })

  it("falls back when the name has no slug chars", () => {
    assert.equal(uniqueSlug("!!!", [], "team"), "team")
  })
})
