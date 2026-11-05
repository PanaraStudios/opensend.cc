import assert from "node:assert/strict"
import test from "node:test"
import { byteRange } from "./range"

test("byteRange resolves open, closed and suffix ranges", () => {
  assert.deepEqual(byteRange("bytes=0-", 100), { start: 0, end: 99 })
  assert.deepEqual(byteRange("bytes=10-19", 100), { start: 10, end: 19 })
  assert.deepEqual(byteRange("bytes=90-500", 100), { start: 90, end: 99 })
  assert.deepEqual(byteRange("bytes=-20", 100), { start: 80, end: 99 })
  assert.deepEqual(byteRange("bytes=-500", 100), { start: 0, end: 99 })
})

test("byteRange ignores absent or multi ranges and rejects impossible ones", () => {
  assert.equal(byteRange(null, 100), null)
  assert.equal(byteRange("bytes=0-1,5-6", 100), null)
  assert.equal(byteRange("items=0-1", 100), null)
  assert.equal(byteRange("bytes=100-", 100), "unsatisfiable")
  assert.equal(byteRange("bytes=20-10", 100), "unsatisfiable")
  assert.equal(byteRange("bytes=-0", 100), "unsatisfiable")
})
