import assert from "node:assert/strict"
import { test } from "node:test"
import { messageHref, threadHref } from "./messages/links"

test("logs and inbox share the established email, received and channel routes", () => {
  assert.equal(messageHref("email", "sent1"), "/emails/sent1")
  assert.equal(messageHref("received", "in1"), "/emails/receiving/in1")
  assert.equal(messageHref("channel", "msg1"), "/emails/messages/msg1")
  assert.equal(threadHref(null), "/emails/inbox")
  assert.equal(threadHref("thread1"), "/emails/inbox?c=thread1")
  assert.equal(threadHref("a&b"), "/emails/inbox?c=a%26b")
})
