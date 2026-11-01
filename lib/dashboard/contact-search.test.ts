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
      digits: "14155552671",
      national: "14155552671",
    })
    assert.deepEqual(parseContactSearch("555 2671"), {
      kind: "phone",
      digits: "5552671",
      national: "5552671",
    })
  })
  it("also tries a number without its trunk or international zeros", () => {
    assert.deepEqual(parseContactSearch("07911 123456"), {
      kind: "phone",
      digits: "07911123456",
      national: "7911123456",
    })
    assert.deepEqual(parseContactSearch("0044 7911 123456"), {
      kind: "phone",
      digits: "00447911123456",
      national: "447911123456",
    })
    assert.deepEqual(parseContactSearch("0000"), {
      kind: "phone",
      digits: "0000",
      national: "0000",
    })
  })
  it("keeps a short run that starts with 0 as typed", () => {
    for (const run of ["0", "01", "0123", "012345", "079111", "00", "00123"])
      assert.deepEqual(parseContactSearch(run), {
        kind: "phone",
        digits: run,
        national: run,
      })
    assert.equal(
      (parseContactSearch("07911 12") as { national: string }).national,
      "791112"
    )
    assert.equal(
      (parseContactSearch("0044 79") as { national: string }).national,
      "4479"
    )
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

/** Convex's full-text rule, which convex-test does not follow: the last
    query term matches as a word prefix, every other term as a whole word,
    and a document is a candidate when any term matches. */
function convexCandidate(query: string, text: string) {
  const terms = query.split(" ").filter(Boolean)
  const words = searchWords(text)
  return terms.some((term, i) =>
    i === terms.length - 1
      ? words.some((word) => word.startsWith(term))
      : words.includes(term)
  )
}

describe("searchQuery", () => {
  it("puts the run every match starts a word with last", () => {
    assert.equal(searchQuery(parseContactSearch("07911 12")), "0791112 791112")
    assert.equal(searchQuery(parseContactSearch("+44 7911")), "447911")
    assert.equal(searchQuery(parseContactSearch("Jan  Gmail")), "jan gmail")
  })
  it("lets Convex return every contact the box matches", () => {
    const contacts = [
      sam,
      { phone: "+447911123456", firstName: "Olivia", lastName: "Brown" },
      { phone: "+14155550123", firstName: "Zero", lastName: "Ending" },
      { phone: "+919876543210", firstName: "Ravi", lastName: "Kumar" },
      { email: "jane.doe@gmail.com", firstName: "Jane", lastName: "Doe" },
    ]
    const searches = [
      "0791",
      "07911 1",
      "07911 12",
      "07911 12345",
      "07911 123456",
      "0044 7911 12",
      "00447911123456",
      "0123",
      "01",
      "(415) 555-2",
      "5552",
      "+91 98765",
      "98765 43",
      "2671",
      "jan gmail",
      "gmail jan",
      "jane do",
      "doe@gmail",
    ]
    for (const search of searches) {
      const parsed = parseContactSearch(search)
      const query = searchQuery(parsed)
      for (const contact of contacts)
        if (matchesContactSearch(parsed, contact))
          assert.ok(
            convexCandidate(query, searchText(contact)),
            `${search} matches ${contact.firstName} but the index misses it`
          )
    }
    // The cases that motivated the order: partly typed national numbers.
    const olivia = contacts[1]
    for (const search of ["07911 12", "0044 7911 12"])
      assert.ok(matchesContactSearch(parseContactSearch(search), olivia))
    // An ending that starts with 0 is not widened to the digits after it.
    const matched = (search: string) =>
      contacts
        .filter((contact) =>
          matchesContactSearch(parseContactSearch(search), contact)
        )
        .map((contact) => contact.firstName)
    assert.deepEqual(matched("0123"), ["Zero"])
    assert.deepEqual(matched("01"), ["Zero"])
    // Short runs still match the start of any stored ending.
    assert.deepEqual(matched("55"), ["Sam", "Zero"])
    assert.deepEqual(matched("267"), ["Sam"])
  })
})
