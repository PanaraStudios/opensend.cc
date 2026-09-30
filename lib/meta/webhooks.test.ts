import assert from "node:assert/strict"
import { test } from "node:test"
import {
  object,
  array,
  string,
  timestamp,
  outboundStatus,
  STATUS_RANK,
  profileNameParts,
} from "./webhooks"
test("untrusted webhook helpers reject mismatched shapes and invalid timestamps", () => {
  for (const value of [null, [], "text", 123])
    assert.deepEqual(object(value), {})
  assert.deepEqual(array({}), [])
  assert.equal(string(123), "")
  assert.equal(timestamp("1749416383", 0), 1749416383000)
  for (const value of [null, "", -1, "bad", Infinity, 1e20])
    assert.equal(timestamp(value, 123), 123)
  assert.equal(outboundStatus("received"), null)
  assert.equal(outboundStatus("failed"), "failed")
  assert.ok(STATUS_RANK.failed > STATUS_RANK.read)
})

test("profile names split into first and last names", () => {
  assert.deepEqual(profileNameParts("Priya Shah"), {
    firstName: "Priya",
    lastName: "Shah",
  })
  assert.deepEqual(profileNameParts("  Ana  María de la Cruz "), {
    firstName: "Ana",
    lastName: "María de la Cruz",
  })
  assert.deepEqual(profileNameParts("Cher"), {
    firstName: "Cher",
    lastName: "",
  })
  assert.deepEqual(profileNameParts(""), { firstName: "", lastName: "" })
})
