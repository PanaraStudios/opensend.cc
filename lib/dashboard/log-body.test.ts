import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { storedBody } from "./logs"

describe("storedBody", () => {
  it("shows JSON as data, other text as sent, and no body as null", () => {
    assert.deepEqual(storedBody('{"id":"em_1"}'), { id: "em_1" })
    assert.equal(storedBody('{"cut": "at 64 K'), '{"cut": "at 64 K')
    assert.equal(storedBody(undefined), null)
  })
})
