import assert from "node:assert/strict"
import { test } from "node:test"
import {
  messageHref,
  threadHref,
  playgroundRedirectHref,
} from "./messages/links"

test("logs and inbox share the established email, received and channel routes", () => {
  assert.equal(messageHref("email", "sent1"), "/emails/sent1")
  assert.equal(messageHref("received", "in1"), "/emails/receiving/in1")
  assert.equal(messageHref("channel", "msg1"), "/emails/messages/msg1")
  assert.equal(threadHref(null), "/playground/inbox")
  assert.equal(threadHref("thread1"), "/playground/inbox?c=thread1")
  assert.equal(threadHref("a&b"), "/playground/inbox?c=a%26b")
})

test("legacy Inbox and Calls redirects preserve the query without changing the destination", () => {
  for (const tab of ["inbox", "calls"] as const) {
    assert.equal(playgroundRedirectHref(tab, {}), `/playground/${tab}`)
    assert.equal(
      playgroundRedirectHref(tab, { c: undefined }),
      `/playground/${tab}`
    )
    const url = new URL(
      playgroundRedirectHref(tab, {
        c: "a&b +/?=",
        filter: ["open", "unread"],
        blank: "",
      }),
      "https://example.test"
    )
    assert.equal(url.pathname, `/playground/${tab}`)
    assert.equal(url.searchParams.get("c"), "a&b +/?=")
    assert.deepEqual(url.searchParams.getAll("filter"), ["open", "unread"])
    assert.equal(url.searchParams.get("blank"), "")
    assert.equal(
      playgroundRedirectHref(tab, { c: "//outside.test" }).startsWith(
        `/playground/${tab}?`
      ),
      true
    )
  }
})
