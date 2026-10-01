import assert from "node:assert/strict"
import { test } from "node:test"
import {
  CHANNELS,
  CHANNEL_IDS,
  PAGE_CHANNELS,
  isPageChannel,
  CHANNEL_SEND_STEPS,
  channelForSendStep,
  isChannelSendStep,
} from "./channels"

test("every channel has a stable label, resource and account identifier", () => {
  assert.deepEqual(Object.keys(CHANNELS), [...CHANNEL_IDS])
  assert.deepEqual(
    CHANNEL_IDS.map((channel) => CHANNELS[channel].label),
    ["Email", "WhatsApp", "Messenger", "Instagram"]
  )
  assert.deepEqual(
    ["whatsapp", "messenger", "instagram"].map((channel) => {
      const definition = CHANNELS[channel as keyof typeof CHANNELS]
      return [definition.resource, definition.idParam]
    }),
    [
      ["phone-numbers", "phone_number_id"],
      ["pages", "page_id"],
      ["accounts", "account_id"],
    ]
  )
  assert.deepEqual(
    CHANNEL_IDS.filter((channel) => CHANNELS[channel].supports.logs),
    ["email", "whatsapp"]
  )
  assert.deepEqual(CHANNEL_IDS.filter(isPageChannel), [...PAGE_CHANNELS])
  assert.equal(isPageChannel("unknown"), false)
})

test("the registry maps each messaging automation step to its own channel", () => {
  assert.deepEqual(CHANNEL_SEND_STEPS, [
    "send_whatsapp",
    "send_messenger",
    "send_instagram",
  ])
  assert.deepEqual(CHANNEL_SEND_STEPS.map(channelForSendStep), [
    "whatsapp",
    "messenger",
    "instagram",
  ])
  for (const step of CHANNEL_SEND_STEPS)
    assert.equal(isChannelSendStep(step), true)
  assert.equal(isChannelSendStep("send_email"), false)
  assert.equal(isChannelSendStep("send_unknown"), false)
})
