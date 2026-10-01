import assert from "node:assert/strict"
import { test } from "node:test"
import {
  actionShortcut,
  shortcutEventKey,
  isMacPlatform,
  matchesShortcut,
  NAVIGATION_SHORTCUTS,
  sequenceKey,
  SEQUENCE_TIMEOUT,
  type ShortcutKey,
} from "./shortcuts"

const key = (
  value: string,
  overrides: Partial<ShortcutKey> = {}
): ShortcutKey => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  keyCode: 0,
  ...overrides,
})

test("modifier follows platform and rejects mixed or wrong modifiers", () => {
  assert.equal(isMacPlatform("MacIntel"), true)
  assert.equal(isMacPlatform("Win32"), false)
  assert.equal(isMacPlatform("Linux x86_64"), false)
  for (const mac of [true, false]) {
    assert.equal(
      matchesShortcut(key("k", { metaKey: mac, ctrlKey: !mac }), "mod+k", mac),
      true
    )
    assert.equal(
      matchesShortcut(key("k", { metaKey: !mac, ctrlKey: mac }), "mod+k", mac),
      false
    )
    assert.equal(
      matchesShortcut(key("k", { metaKey: true, ctrlKey: true }), "mod+k", mac),
      false
    )
  }
})

test("letters match case but never claim modified browser keys", () => {
  assert.equal(matchesShortcut(key("G"), "g", false), true)
  for (const modifier of ["metaKey", "ctrlKey", "altKey", "shiftKey"] as const)
    assert.equal(
      matchesShortcut(key("g", { [modifier]: true }), "g", false),
      false
    )
  for (const value of ["l", "r", "w"])
    assert.equal(
      matchesShortcut(key(value, { metaKey: true }), "mod+k", true),
      false
    )
})

test("question mark permits Shift on layouts that require it", () => {
  assert.equal(matchesShortcut(key("?", { shiftKey: true }), "?", true), true)
  assert.equal(matchesShortcut(key("?"), "?", false), true)
  assert.equal(matchesShortcut(key("/"), "?", false), false)
})

test("IME, legacy composition and held keys never trigger", () => {
  for (const override of [
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
  ])
    assert.equal(matchesShortcut(key("c", override), "c", false), false)
})

test("navigation prefix expires at one second", () => {
  const prefix = { key: "g", at: 100 }
  assert.equal(sequenceKey(prefix, "d", 101), "g d")
  assert.equal(sequenceKey(prefix, "d", 100 + SEQUENCE_TIMEOUT), "d")
  assert.equal(sequenceKey(null, "d", 101), "d")
})

test("navigation has every requested destination and no duplicate keys", () => {
  assert.equal(Object.keys(NAVIGATION_SHORTCUTS).length, 12)
  assert.equal(new Set(Object.values(NAVIGATION_SHORTCUTS)).size, 12)
  assert.equal(NAVIGATION_SHORTCUTS["/contacts"], "c")
  assert.equal(NAVIGATION_SHORTCUTS["/channels"], "h")
  assert.equal(NAVIGATION_SHORTCUTS["/settings/team"], "s")
})

test("shared action scopes bind only existing actions", () => {
  for (const label of [
    "Create API key",
    "Add domain",
    "Add Contacts",
    "Create broadcast",
    "Create automation",
    "Create template",
    "Create segment",
    "Create topic",
    "Create property",
    "Add webhook",
  ])
    assert.equal(actionShortcut("create", label), "c")
  assert.equal(actionShortcut("edit", "Edit template"), "e")
  assert.equal(actionShortcut("save", "Save changes"), "mod+s")
  assert.equal(actionShortcut("delete", "Delete"), "Backspace")
  for (const label of ["Send now", "Publish", "Start", "Cancel", "Docs"])
    assert.equal(actionShortcut("create", label), null)
  assert.equal(actionShortcut(null, "Create API key"), null)
  assert.equal(actionShortcut("create", "Edit template"), null)
})

test("keydown events without a key are ignored before case conversion", () => {
  for (const eventKey of [undefined, null, "", 42]) {
    assert.equal(shortcutEventKey(eventKey), null)
    assert.equal(
      matchesShortcut(
        { ...key("g"), key: eventKey } as ShortcutKey,
        "g",
        false
      ),
      false
    )
  }
  assert.equal(shortcutEventKey("G"), "g")
})
