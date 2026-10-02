import assert from "node:assert/strict"
import { test } from "node:test"
import {
  DASHBOARD_NAV,
  EMAIL_TABS,
  PLAYGROUND_TABS,
  navItemActive,
  tabActive,
} from "./nav"

test("Messages has delivery logs and Playground has the engine testers", () => {
  assert.deepEqual(EMAIL_TABS, [
    { href: "/emails", title: "Sending" },
    { href: "/emails/receiving", title: "Receiving" },
    { href: "/emails/suppressions", title: "Suppressions" },
  ])
  assert.deepEqual(PLAYGROUND_TABS, [
    { href: "/playground/inbox", title: "Inbox" },
    { href: "/playground/calls", title: "Calls" },
    { href: "/playground/ivr", title: "IVR" },
    { href: "/playground/voice-bot", title: "Voice bot" },
  ])
})

test("Playground follows Webhooks and is active across all its tabs", () => {
  const index = DASHBOARD_NAV.findIndex((item) => item.href === "/playground")
  assert.equal(DASHBOARD_NAV[index - 1].href, "/webhooks")
  const playground = DASHBOARD_NAV[index]
  const messages = DASHBOARD_NAV.find((item) => item.href === "/emails")!
  assert.equal(navItemActive("/playground", playground), true)
  for (const { href } of PLAYGROUND_TABS) {
    assert.equal(navItemActive(href, playground), true)
    assert.equal(navItemActive(href, messages), false)
    for (const tab of PLAYGROUND_TABS)
      assert.equal(tabActive(href, tab.href), href === tab.href)
  }
  assert.equal(navItemActive("/playground-other", playground), false)
})
