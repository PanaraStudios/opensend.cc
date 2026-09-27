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
