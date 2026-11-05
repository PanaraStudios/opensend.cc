import { strict as assert } from "node:assert"
import { test } from "node:test"
import { normalizePhone, toWaId, fromWaId } from "./phone"

test("normalizes international phone formatting without guessing a country", () => {
  for (const value of [
    "+14155552671",
    " +1 (415) 555-2671 ",
    "+1 415 555 2671",
  ])
    assert.equal(normalizePhone(value), "+14155552671")
  assert.equal(normalizePhone("+12345678"), "+12345678")
  assert.equal(normalizePhone("+123456789012345"), "+123456789012345")
})
test("rejects missing country prefix, invalid digits, length and extensions", () => {
  for (const value of [
    "",
    "4155552671",
    "(415) 555-2671",
    "+1234567",
    "+1234567890123456",
    "+012345678",
    "+1+4155552671",
    "+14155552671 ext 4",
    "+1415.555.2671",
    "+abcdefgh",
    "+",
    "++12345678",
  ])
    assert.equal(normalizePhone(value), null, value)
})

test("wa_id conversion keeps one international prefix", () => {
  assert.equal(toWaId("+14155552671"), "14155552671")
  assert.equal(toWaId("14155552671"), "14155552671")
  assert.equal(fromWaId("14155552671"), "+14155552671")
  assert.equal(fromWaId("+14155552671"), "+14155552671")
})
