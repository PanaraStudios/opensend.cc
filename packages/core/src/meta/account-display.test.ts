import assert from "node:assert/strict"
import { test } from "node:test"
import { channelHandle } from "./account-display"
test("Instagram handles have one @ while Page names and phone numbers keep their form", () => {
  assert.equal(channelHandle("instagram", "opensend"), "@opensend")
  assert.equal(channelHandle("instagram", "@opensend"), "@opensend")
  assert.equal(channelHandle("instagram", ""), "")
  assert.equal(channelHandle("messenger", "Opensend Page"), "Opensend Page")
  assert.equal(channelHandle("whatsapp", "+16505551234"), "+16505551234")
})
