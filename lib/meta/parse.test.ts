import assert from "node:assert/strict"
import { test } from "node:test"
import { array, object, string, oneOf } from "./parse"

test("wire parsing keeps valid fields and uses stable malformed-field fallbacks", () => {
  const record = { field: "value" },
    list = [record]
  assert.equal(object(record), record)
  assert.equal(array(list), list)
  for (const value of [null, undefined, [], 1, "text"])
    assert.deepEqual(object(value), {})
  assert.equal(string(1), "")
  assert.equal(string(" text "), " text ")
  assert.deepEqual(array(record), [])
  assert.equal(oneOf("read", ["read", "sent"] as const), "read")
  assert.equal(oneOf("unknown", ["read", "sent"] as const), undefined)
})
