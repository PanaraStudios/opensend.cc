import { test } from "node:test"
import assert from "node:assert/strict"
import { readPage, readPages, pageTokenProblem } from "./page-account"
import {
  localTemplate,
  localTemplateVariables,
  fillLocalTemplate,
} from "./local-templates"

test("Page metadata narrows Graph responses and validates Page/Instagram token permissions", () => {
  assert.equal(readPage({ id: "invalid", name: "Page" }), null)
  assert.equal(readPage({ id: "123" }), null)
  const raw = {
    id: "123",
    name: "Page",
    access_token: "secret",
    instagram_business_account: { id: "456", username: "acme" },
  }
  assert.deepEqual(readPages({ data: [raw, null] }), [
    {
      id: "123",
      name: "Page",
      token: "secret",
      instagram: { id: "456", username: "acme", name: "acme" },
    },
  ])
  const info = {
    appId: "app",
    valid: true,
    scopes: ["pages_messaging", "pages_manage_metadata"],
    targets: {},
  }
  assert.equal(pageTokenProblem(info, "app", "123"), null)
  assert.match(pageTokenProblem(info, "app", "123", true)!, /instagram_basic/)
  assert.match(
    pageTokenProblem({ ...info, appId: "other" }, "app")!,
    /different Meta app/
  )
  assert.match(
    pageTokenProblem(
      { ...info, targets: { pages_messaging: ["999"] } },
      "app",
      "123"
    )!,
    /no access/
  )
  assert.match(pageTokenProblem({ ...info, valid: false }, "app")!, /not valid/)
})
test("local messaging templates infer and substitute text/quick-reply variables without HTML escaping", () => {
  const content = localTemplate({
    text: "Hi {{{name}}}",
    quick_replies: [{ title: "Yes", payload: "YES_{{{name}}}" }],
  })
  assert.deepEqual(localTemplateVariables(content), ["name"])
  assert.deepEqual(fillLocalTemplate(content, { name: 'Ada "L" & Grace' }), {
    text: 'Hi Ada "L" & Grace',
    quick_replies: [{ title: "Yes", payload: 'YES_Ada "L" & Grace' }],
  })
  assert.throws(() => localTemplate({ text: 123 }))
  assert.throws(() => localTemplate({ text: "x".repeat(2001) }))
})
