import assert from "node:assert/strict"
import { test } from "node:test"
import { includeSelected, matchingOptions } from "./options"

test("rank exact, prefix and substring matches, preserving tie order", () => {
  assert.deepEqual(
    matchingOptions(
      ["Some needle", "needle prefix", "Needle", "needless", "missing"],
      " NEEDLE ",
      (row) => [row]
    ),
    ["Needle", "needle prefix", "needless", "Some needle"]
  )
})
test("search considers candidates beyond the first twenty", () => {
  const rows = [...Array.from({ length: 25 }, (_, i) => `item${i}`), "target"]
  assert.equal(matchingOptions(rows, "", (row) => [row]).length, 20)
  assert.deepEqual(
    matchingOptions(rows, "target", (row) => [row]),
    ["target"]
  )
})
test("a selected row uses one slot without duplicates or mutating results", () => {
  const rows = Array.from({ length: 20 }, (_, i) => String(i))
  assert.deepEqual(
    includeSelected(rows, "0", (row) => row),
    rows
  )
  const selected = includeSelected(rows, "old", (row) => row)
  assert.equal(selected.length, 20)
  assert.equal(selected[19], "old")
  assert.equal(rows[19], "19")
  assert.deepEqual(
    includeSelected([], "old", (row) => row),
    ["old"]
  )
  assert.deepEqual(
    includeSelected(rows, null, (row) => row),
    rows
  )
})
