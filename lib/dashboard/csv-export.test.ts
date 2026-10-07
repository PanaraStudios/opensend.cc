import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { csvLine, parseCsv } from "./csv"

describe("csvLine", () => {
  it("quotes only what needs quoting and round-trips through parseCsv", () => {
    const line = csvLine(["plain", 'say "hi"', "a,b", "two\nlines"])
    assert.equal(line, 'plain,"say ""hi""","a,b","two\nlines"\r\n')
    assert.deepEqual(parseCsv(`h1,h2,h3,h4\n${line}`).rows, [
      ["plain", 'say "hi"', "a,b", "two\nlines"],
    ])
  })

  it("defuses cells a spreadsheet would run as formulas", () => {
    assert.equal(
      csvLine(["=SUM(A1)", "+1", "-2", "@x", "ok"]),
      "'=SUM(A1),'+1,'-2,'@x,ok\r\n"
    )
  })
})

it("defuses formulas after leading whitespace or controls without altering ordinary cells (S11)", () => {
  for (const prefix of [
    "",
    " ",
    "\n",
    "\t",
    "\r\n",
    "\u0000",
    "\u001f",
    "\u007f",
    "\u0085",
    "\u00a0",
    " \t\n",
  ]) {
    for (const formula of ["=1+1", "+1", "-2", "@cmd"]) {
      const value = `${prefix}${formula}`
      const escaped = `'${value}`
      const expected = /[",\r\n]/.test(escaped)
        ? `"${escaped.replace(/"/g, '""')}"`
        : escaped
      assert.equal(csvLine([value]), `${expected}\r\n`)
    }
  }
  assert.equal(
    csvLine([" ordinary ", "\tname", "\nname", "hello=world", "", " "]),
    ' ordinary ,\tname,"\nname",hello=world,, \r\n'
  )
})
