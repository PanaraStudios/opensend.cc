import assert from "node:assert/strict"
import { test } from "node:test"
import { asTemplate } from "./template-record"
import type { Doc } from "../../convex/_generated/dataModel"

const row = {
  _id: "template",
  _creationTime: 1,
  organizationId: "team",
  name: "Hello",
  alias: "hello",
  subject: "Subject",
  preview: "Preview",
  status: "draft",
  variables: ["name"],
  updatedAt: 2,
} as Doc<"templates">
test("template adapter preserves page channels and customer-facing content", () => {
  for (const channel of ["messenger", "instagram"] as const) {
    const content = {
      text: "Hi {{{name}}}",
      quick_replies: [{ title: "Yes", payload: "YES" }],
    }
    const item = asTemplate({ ...row, channel }, { html: "", content })
    assert.equal(item.channel, channel)
    assert.deepEqual(item.localContent, content)
    assert.equal(item.content, undefined)
    const incomplete = {
      text: "Hi",
      quick_replies: [{ title: "", payload: "" }],
    }
    assert.deepEqual(
      asTemplate({ ...row, channel }, { html: "", content: incomplete })
        .localContent,
      incomplete
    )
  }
})
test("email markup and WhatsApp components keep their established shapes", () => {
  const email = asTemplate(row, {
    html: "<p>Hello</p>",
    content: { type: "doc" },
  })
  assert.equal(email.channel, undefined)
  assert.equal(email.html, "<p>Hello</p>")
  assert.deepEqual(email.content, { type: "doc" })
  const components = [{ type: "BODY", text: "Hello" }]
  assert.deepEqual(
    asTemplate({ ...row, channel: "whatsapp" }, { html: "", components })
      .components,
    components
  )
})
