import assert from "node:assert/strict"
import { test } from "node:test"
import {
  DASHBOARD_NAV,
  CHANNEL_PAGES,
  EMAIL_CHANNELS_HREF,
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
    { href: "/playground/knowledge", title: "Knowledge" },
    { href: "/playground/tools", title: "Tools" },
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

test("Channels replaces Domains and stays active on a domain's page", () => {
  assert.equal(
    DASHBOARD_NAV.some((item) => item.title === "Domains"),
    false
  )
  const channels = DASHBOARD_NAV.find((item) => item.href === "/channels")!
  for (const path of ["/channels", "/channels/acc_1", "/domains/dom_1"])
    assert.equal(navItemActive(path, channels), true, path)
  assert.equal(navItemActive("/domains-other", channels), false)
  assert.deepEqual(channels.keywords, [
    "Domains",
    "sender",
    "Email",
    "WhatsApp",
    "Messenger",
    "Instagram",
  ])
  assert.equal(EMAIL_CHANNELS_HREF, "/channels?type=email")
})

test("command channel destinations cover every registered sender type", () => {
  assert.deepEqual(
    CHANNEL_PAGES.map((page) => page.href),
    [
      "/channels?type=email",
      "/channels?type=whatsapp",
      "/channels?type=messenger",
      "/channels?type=instagram",
    ]
  )
  assert.ok(CHANNEL_PAGES.every((page) => page.keywords.includes("sender")))
})
