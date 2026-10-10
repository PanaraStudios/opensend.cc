import assert from "node:assert/strict"
import { test } from "node:test"
import { defaultSendChannel } from "./send-channels"
test("send defaults use the common channel order and only connected senders", () => {
  assert.equal(defaultSendChannel(["instagram", "email", "whatsapp"]), "email")
  assert.equal(defaultSendChannel(["instagram"]), "instagram")
  assert.equal(defaultSendChannel([]), undefined)
  assert.equal(
    defaultSendChannel(["messenger"], { phone: "+15555555555" }),
    "messenger"
  )
  assert.equal(
    defaultSendChannel(["email", "whatsapp"], {
      channelIdentity: { channel: "whatsapp" },
    }),
    "whatsapp"
  )
  assert.equal(
    defaultSendChannel(["email", "whatsapp"], {
      email: "ada@example.test",
      phone: "+15555555555",
    }),
    "email"
  )
})

test("send defaults resolve after loading and preserve manual choices across reloads", () => {
  assert.equal(defaultSendChannel(undefined), undefined)
  assert.equal(defaultSendChannel(["whatsapp", "email"]), "email")
  const contact = { channelIdentity: { channel: "whatsapp" as const } }
  assert.equal(defaultSendChannel(undefined, contact), undefined)
  assert.equal(defaultSendChannel(["email", "whatsapp"], contact), "whatsapp")

  const manual = "whatsapp"
  assert.equal(defaultSendChannel(undefined, undefined, manual), manual)
  assert.equal(
    defaultSendChannel(
      ["email", "whatsapp"],
      { email: "ada@example.test" },
      manual
    ),
    manual
  )
  assert.equal(
    defaultSendChannel(["instagram", "whatsapp", "email"], undefined, manual),
    manual
  )
  // A genuinely removed sender must fall back to an available channel.
  assert.equal(defaultSendChannel(["email"], undefined, manual), "email")
  assert.equal(defaultSendChannel([], undefined, manual), undefined)
})
