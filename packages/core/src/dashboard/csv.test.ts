import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  parseCsv,
  parseUnsubscribed,
  splitEmails,
  suggestCsvMapping,
} from "./csv"

describe("parseCsv", () => {
  it("reads headers and rows", () => {
    const table = parseCsv("email,first_name\nada@example.com,Ada\n")
    assert.deepEqual(table.headers, ["email", "first_name"])
    assert.deepEqual(table.rows, [["ada@example.com", "Ada"]])
  })

  it("handles quoted commas and a BOM", () => {
    const table = parseCsv(
      '\uFEFFemail,company\n"ada@example.com","Analytical, Engines"\n'
    )
    assert.deepEqual(table.rows[0], ["ada@example.com", "Analytical, Engines"])
  })
})

describe("suggestCsvMapping", () => {
  it("maps reserved and custom columns", () => {
    assert.equal(suggestCsvMapping("First Name", []), "first_name")
    assert.equal(suggestCsvMapping("company", ["company"]), "company")
    assert.equal(suggestCsvMapping("notes", ["company"]), "ignore")
  })
})

describe("splitEmails", () => {
  it("splits, lowercases, and drops invalids", () => {
    assert.deepEqual(splitEmails("Ada@Example.com, nope\ngrace@hopper.dev"), [
      "ada@example.com",
      "grace@hopper.dev",
    ])
  })
})

describe("parseUnsubscribed", () => {
  it("accepts common truthy and falsy tokens", () => {
    assert.equal(parseUnsubscribed("yes"), true)
    assert.equal(parseUnsubscribed("0"), false)
    assert.equal(parseUnsubscribed(""), undefined)
  })
})
