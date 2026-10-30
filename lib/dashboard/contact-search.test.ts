import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  matchesContactSearch,
  parseContactSearch,
  phoneEndings,
  searchQuery,
  searchText,
  searchWords,
} from "./contact-search"

const sam = { phone: "+14155552671", firstName: "Sam", lastName: "Hill" }

describe("phoneEndings", () => {
  it("holds every ending from four digits up to the whole national part", () => {
    assert.deepEqual(phoneEndings("+14155552671"), [
      "2671",
      "52671",
      "552671",
      "5552671",
      "55552671",
      "155552671",
      "4155552671",
    ])
    assert.deepEqual(phoneEndings("+447911123456").at(-1), "47911123456")
    assert.deepEqual(phoneEndings(undefined), [])
  })
})

describe("searchText", () => {
  it("keeps the words it held before, then the phone endings", () => {
    const words = searchWords(
      searchText({
        email: "jane.doe+news@example.test",
        firstName: "Jane",
        lastName: "Doe",
      })
    )
    assert.deepEqual(
      [...new Set(words)],
      ["jane", "doe", "news", "example", "test"]
    )
    assert.ok(
      searchText(sam).trim().startsWith("+14155552671 14155552671 2671 ")
    )
  })
})

describe("parseContactSearch", () => {
  it("reads a formatted number as one run of digits", () => {
    assert.deepEqual(parseContactSearch(" +1 (415) 555-2671 "), {
      kind: "phone",
      digits: ["14155552671"],
    })
    assert.deepEqual(parseContactSearch("555 2671"), {
      kind: "phone",
      digits: ["5552671"],
    })
  })
  it("also tries a number without its trunk or international zeros", () => {
    assert.deepEqual(parseContactSearch("07911 123456"), {
      kind: "phone",
      digits: ["7911123456", "07911123456"],
    })
    assert.deepEqual(parseContactSearch("0044 7911 123456"), {
      kind: "phone",
      digits: ["447911123456", "00447911123456"],
    })
    assert.deepEqual(parseContactSearch("0000"), {
      kind: "phone",
      digits: ["0000"],
    })
  })
  it("splits anything else into at most 16 words", () => {
    assert.deepEqual(parseContactSearch("Jane.Doe@Example"), {
      kind: "words",
      words: ["jane", "doe", "example"],
    })
    assert.equal(searchQuery(parseContactSearch("@ .")), "")
    const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ")
    assert.equal(
      (parseContactSearch(many) as { words: string[] }).words.length,
      16
    )
  })
})

describe("matchesContactSearch", () => {
  it("needs every word as the start of one of the contact's words", () => {
    const jane = { email: "jane@x.test", firstName: "Jane", lastName: "Doe" }
    assert.equal(matchesContactSearch(parseContactSearch("jan do"), jane), true)
    assert.equal(matchesContactSearch(parseContactSearch("ane"), jane), false)
    assert.equal(
      matchesContactSearch(parseContactSearch("jane x9"), jane),
      false
    )
    assert.equal(matchesContactSearch(parseContactSearch("@"), jane), false)
  })
  it("matches a number's ending, a run inside it or the whole number", () => {
    for (const search of ["2671", "(415) 555-2671", "5552", "+1 415 555 2671"])
      assert.equal(matchesContactSearch(parseContactSearch(search), sam), true)
    for (const search of ["2672", "0415 555 2671x"])
      assert.equal(matchesContactSearch(parseContactSearch(search), sam), false)
  })
})
