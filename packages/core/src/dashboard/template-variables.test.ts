import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { templateAliasBase, templateVariableDefaults } from "./template"

describe("templateVariableDefaults", () => {
  it("lists each variable once, with the first fallback written for it", () => {
    assert.deepEqual(
      templateVariableDefaults({
        subject: "Hi {{{NAME}}}",
        preview: "{{{PLAN|free}}}",
        html: "<p>{{{NAME|there}}} {{{NAME|friend}}} {{{PLAN|pro}}}</p>",
      }),
      [
        { key: "NAME", fallback: "there" },
        { key: "PLAN", fallback: "free" },
      ]
    )
  })

  it("leaves a variable without any fallback required", () => {
    assert.deepEqual(
      templateVariableDefaults({ subject: "", preview: "", html: "{{{ID|}}}" }),
      [{ key: "ID" }]
    )
  })
})

describe("templateAliasBase", () => {
  it("slugs the name, or falls back when nothing is left", () => {
    assert.equal(templateAliasBase("Order Shipped!"), "order-shipped")
    assert.equal(templateAliasBase("!!!"), "template")
  })
})
