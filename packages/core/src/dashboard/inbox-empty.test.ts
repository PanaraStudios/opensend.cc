import assert from "node:assert/strict"
import { test } from "node:test"
import { inboxEmptyDescription } from "./inbox-empty"
test("inbox emptiness explains connected, disconnected and filtered states", () => {
  assert.match(inboxEmptyDescription(false, false), /Connect a channel/)
  assert.match(inboxEmptyDescription(true, false), /channels are connected/)
  assert.match(inboxEmptyDescription(true, true), /Clear the filters/)
  assert.match(inboxEmptyDescription(false, true), /Clear the filters/)
})
