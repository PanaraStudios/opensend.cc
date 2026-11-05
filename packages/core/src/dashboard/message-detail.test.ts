import assert from "node:assert/strict"
import { test } from "node:test"
import { messageEnvelope, messageParty } from "./message-detail"
import { CHANNEL_IDS } from "../channels"

test("every channel uses the same sender and recipient labels", () => {
  for (const channel of CHANNEL_IDS) {
    const items = messageEnvelope({ channel, from: "Team", to: "Ada" })
    assert.deepEqual(
      items.map((item) => item.label),
      ["Channel", "Sender", "Recipient"]
    )
  }
  assert.equal(
    messageEnvelope({
      channel: "email",
      from: "Team",
      to: "Ada",
      subject: "Hello",
    })[3].value,
    "Hello"
  )
})
test("customer labels use names and handles without leaking scoped ids", () => {
  assert.equal(
    messageParty({ channel: "instagram", address: "178123", username: "@ada" }),
    "@ada"
  )
  assert.equal(
    messageParty({ channel: "messenger", address: "123", profileName: "Ada" }),
    "Ada"
  )
  assert.equal(
    messageParty({ channel: "messenger", address: "123" }),
    "Messenger user"
  )
  assert.equal(
    messageParty({ channel: "whatsapp", address: "15551234567" }),
    "+15551234567"
  )
  assert.equal(
    messageParty({ channel: "email", address: "ada@example.com" }),
    "ada@example.com"
  )
})
test("WhatsApp business-scoped recipients use a public profile instead of a fabricated phone", () => {
  assert.equal(
    messageParty({
      channel: "whatsapp",
      address: "business-scoped-recipient",
      profileName: "Ada",
    }),
    "Ada"
  )
  assert.equal(
    messageParty({ channel: "whatsapp", address: "business-scoped-recipient" }),
    "WhatsApp user"
  )
})
