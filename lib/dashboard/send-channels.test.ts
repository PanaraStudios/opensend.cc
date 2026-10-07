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
