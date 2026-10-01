import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  isReservedPropertyKey,
  isValidPropertyKey,
  normalizePropertyKey,
} from "./contacts"
import { matchesNeedle, searchNeedle } from "./search"

describe("normalizePropertyKey", () => {
  it("lowercases, trims, and joins words with underscores", () => {
    assert.equal(normalizePropertyKey("  Company Name "), "company_name")
    assert.equal(isValidPropertyKey("company_name"), true)
    assert.equal(isValidPropertyKey("1abc"), false)
    assert.equal(isReservedPropertyKey("email"), true)
    assert.equal(isReservedPropertyKey("company"), false)
  })
})

describe("search helpers", () => {
  it("matches any field case-insensitively and matches all on empty", () => {
    const contact = { email: "ada@example.com" }
    assert.equal(matchesNeedle("", contact.email), true)
    assert.equal(
      matchesNeedle(searchNeedle(contact.email.toUpperCase()), contact.email),
      true
    )
    assert.equal(matchesNeedle("zzz", "abc", undefined), false)
  })
})

import {
  contactIdentity,
  contactInputError,
  contactPhoneError,
} from "./contacts"

describe("contact identity", () => {
  const channelIdentity = {
    channel: "messenger" as const,
    externalId: "1001",
    profileName: "Page profile",
  }
  it("uses name, email, phone and channel fallbacks in order", () => {
    assert.equal(
      contactIdentity({
        firstName: " Ada ",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "+12345678",
        channelIdentity,
      }).label,
      "Ada Lovelace"
    )
    assert.equal(
      contactIdentity({
        email: "ada@example.com",
        phone: "+12345678",
        channelIdentity,
      }).kind,
      "email"
    )
    assert.equal(
      contactIdentity({ phone: "+12345678", channelIdentity }).kind,
      "phone"
    )
    assert.deepEqual(contactIdentity({}, channelIdentity), {
      label: "Page profile",
      secondary: "Messenger",
      kind: "channel",
      channel: "messenger",
    })
    assert.equal(
      contactIdentity({}, { ...channelIdentity, profileName: "" }).label,
      "Unknown contact"
    )
    assert.equal(contactIdentity({}).label, "Unknown contact")
  })
  it("returns the failing identity field, including phone text shared with the backend", () => {
    assert.deepEqual(contactInputError({ phone: "123" }), {
      phone: contactPhoneError("123"),
    })
    assert.deepEqual(contactInputError({ email: "invalid" }), {
      email: "invalid is not a valid email address",
    })
    assert.deepEqual(contactInputError({}), {
      email: "An email or phone number is required",
    })
    assert.equal(contactInputError({}, { linkedChannel: true }), null)
    assert.equal(contactInputError({ phone: "+12345678" }), null)
  })
})

describe("channel usernames", () => {
  const channelIdentity = {
    channel: "instagram" as const,
    externalId: "20000001",
    username: "grace",
    profileName: "Profile name",
  }
  it("prefers CRM name, email, phone, username, then profile name", () => {
    assert.equal(
      contactIdentity({
        firstName: "CRM",
        email: "a@example.com",
        phone: "+12345678",
        channelIdentity,
      }).label,
      "CRM"
    )
    assert.equal(
      contactIdentity({
        email: "a@example.com",
        phone: "+12345678",
        channelIdentity,
      }).label,
      "a@example.com"
    )
    assert.equal(
      contactIdentity({ phone: "+12345678", channelIdentity }).label,
      "+12345678"
    )
    assert.equal(contactIdentity({ channelIdentity }).label, "@grace")
    assert.equal(
      contactIdentity({
        channelIdentity: { ...channelIdentity, username: undefined },
      }).label,
      "Profile name"
    )
    assert.equal(
      contactIdentity({
        channelIdentity: { ...channelIdentity, username: "@grace" },
      }).label,
      "@grace"
    )
  })
  it("uses email, phone, username, then channel as secondary; never scoped ids", () => {
    for (const [contact, secondary] of [
      [{ email: "a@example.com", phone: "+12345678" }, "a@example.com"],
      [{ phone: "+12345678" }, "+12345678"],
      [{}, "@grace"],
    ] as const)
      assert.equal(
        contactIdentity({ ...contact, channelIdentity }).secondary,
        secondary
      )
    assert.deepEqual(
      contactIdentity({
        channelIdentity: { channel: "messenger", externalId: "10000001" },
      }),
      {
        label: "Unknown contact",
        secondary: "Messenger",
        kind: "channel",
        channel: "messenger",
      }
    )
  })
})
