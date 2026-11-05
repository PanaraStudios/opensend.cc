import assert from "node:assert/strict"
import { test } from "node:test"
import {
  templateTestReady,
  templateTestRecipient,
  templateTestVariables,
} from "./template-test"
import type { EmailTemplate } from "./types"

test("Meta tests require published templates and WhatsApp approval", () => {
  for (const channel of ["whatsapp", "messenger", "instagram"] as const) {
    assert.equal(templateTestReady({ channel, status: "draft" }), false)
    assert.equal(
      templateTestReady({ channel, status: "published" }),
      channel !== "whatsapp"
    )
  }
  assert.equal(
    templateTestReady({
      channel: "whatsapp",
      status: "published",
      whatsapp: { metaStatus: "APPROVED" } as EmailTemplate["whatsapp"],
    }),
    true
  )
})
test("test recipients normalize international phones and preserve scoped Meta recipients", () => {
  assert.equal(
    templateTestRecipient("whatsapp", "+1 (555) 123-4567"),
    "+15551234567"
  )
  assert.equal(templateTestRecipient("messenger", " 123456789 "), "123456789")
  assert.throws(
    () => templateTestRecipient("whatsapp", "5551234567"),
    /country code/
  )
  assert.throws(() => templateTestRecipient("instagram", " "), /recipient/)
})
test("test variables retain the exact send keys including WhatsApp media", () => {
  assert.deepEqual(
    templateTestVariables({ channel: "instagram", variables: ["first_name"] }),
    [{ key: "first_name", label: "Variable {{{first_name}}}" }]
  )
  const fields = templateTestVariables({
    channel: "whatsapp",
    variables: [],
    components: [
      { type: "HEADER", format: "IMAGE" },
      { type: "BODY", text: "Hi {{1}}", example: { body_text: [["Ada"]] } },
    ],
  })
  assert.deepEqual(
    fields.map((field) => field.key),
    ["header_media", "1"]
  )
})
