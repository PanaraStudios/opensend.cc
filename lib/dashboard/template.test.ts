import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  normalizeTemplates,
  publishedAtAfterEdit,
  renamedTemplateAlias,
  templateAliasError,
  templatePublishLabel,
  templateVariables,
  uniqueTemplateAlias,
} from "./template"
import type { EmailTemplate } from "./types"

function template(patch: Partial<EmailTemplate>): EmailTemplate {
  return {
    id: "tpl_1",
    name: "Welcome",
    alias: "welcome",
    subject: "",
    preview: "",
    html: "",
    status: "draft",
    variables: [],
    createdAt: 1,
    updatedAt: 1,
    publishedAt: null,
    ...patch,
  }
}

describe("uniqueTemplateAlias", () => {
  it("slugs the name", () => {
    assert.equal(
      uniqueTemplateAlias("Untitled Template", []),
      "untitled-template"
    )
  })

  it("numbers an alias that is taken", () => {
    assert.equal(
      uniqueTemplateAlias("Welcome", [
        template({}),
        template({ alias: "welcome-2" }),
      ]),
      "welcome-3"
    )
  })

  it("falls back when the name has nothing to slug", () => {
    assert.equal(uniqueTemplateAlias("!!!", []), "template")
  })
})

describe("renamedTemplateAlias", () => {
  const untitled = template({
    name: "Untitled Template",
    alias: "untitled-template",
  })

  it("follows the name while the alias is still the automatic one", () => {
    assert.equal(
      renamedTemplateAlias(untitled, "Signup welcome", [untitled]),
      "signup-welcome"
    )
  })

  it("still follows when the alias was numbered at creation", () => {
    const second = template({
      id: "tpl_2",
      name: "Untitled Template",
      alias: "untitled-template-2",
    })
    /* The template that held the plain slug has since been renamed. */
    const first = template({ name: "Signup", alias: "signup" })
    assert.equal(
      renamedTemplateAlias(second, "Receipt", [first, second]),
      "receipt"
    )
  })

  it("keeps an alias that was chosen by hand or already published", () => {
    const chosen = template({ name: "Untitled Template", alias: "signup" })
    assert.equal(
      renamedTemplateAlias(chosen, "Signup welcome", [chosen]),
      "signup"
    )
    const live = { ...untitled, publishedAt: 5 }
    assert.equal(
      renamedTemplateAlias(live, "Signup welcome", [live]),
      "untitled-template"
    )
  })
})

describe("templateVariables", () => {
  it("collects the subject's and the preview's along with the body's", () => {
    assert.deepEqual(
      templateVariables(
        template({
          subject: "Your {{{MONTH}}} invoice",
          preview: "Hi {{{FIRST_NAME|there}}}",
          html: "<p>{{{INVOICE_ID}}} for {{{MONTH}}}</p>",
        })
      ),
      ["MONTH", "FIRST_NAME", "INVOICE_ID"]
    )
  })
})

describe("templateAliasError", () => {
  it("accepts a free, well-formed alias", () => {
    assert.equal(templateAliasError("order_receipt-2", [template({})]), null)
  })

  it("rejects an empty, malformed or taken alias", () => {
    assert.ok(templateAliasError("", []))
    assert.ok(templateAliasError("Order Receipt", []))
    assert.ok(templateAliasError("-receipt", []))
    assert.ok(templateAliasError("welcome", [template({})]))
  })
})

describe("templatePublishLabel", () => {
  it("publishes a draft, and has nothing to do once live", () => {
    assert.equal(templatePublishLabel(template({ updatedAt: 9 })), "Publish")
    assert.equal(
      templatePublishLabel(
        template({ status: "published", updatedAt: 5, publishedAt: 5 })
      ),
      null
    )
  })

  it("offers the changes once a published template is edited", () => {
    assert.equal(
      templatePublishLabel(
        template({ status: "published", updatedAt: 6, publishedAt: 5 })
      ),
      "Publish changes"
    )
  })
})

describe("publishedAtAfterEdit", () => {
  const live = template({ status: "published", updatedAt: 5, publishedAt: 5 })

  it("keeps a live template live through a rename or a new alias", () => {
    assert.equal(publishedAtAfterEdit(live, { name: "New" }, 9), 9)
    assert.equal(publishedAtAfterEdit(live, { alias: "new" }, 9), 9)
  })

  it("leaves it behind once what is sent changes", () => {
    assert.equal(publishedAtAfterEdit(live, { html: "<p>x</p>" }, 9), 5)
    assert.equal(publishedAtAfterEdit(live, { content: undefined }, 9), 5)
  })

  it("does not make pending changes live, or publish a draft", () => {
    const edited = { ...live, updatedAt: 6 }
    assert.equal(publishedAtAfterEdit(edited, { name: "New" }, 9), 5)
    assert.equal(publishedAtAfterEdit(template({}), { name: "New" }, 9), null)
  })
})

describe("normalizeTemplates", () => {
  it("backfills alias, preview and publish time on old records", () => {
    const old = (patch: Partial<EmailTemplate>) => {
      const record: Partial<EmailTemplate> = template(patch)
      delete record.alias
      delete record.preview
      delete record.publishedAt
      return record as EmailTemplate
    }
    const [first, second, third] = normalizeTemplates([
      old({ name: "Invoice", status: "published", updatedAt: 7 }),
      old({ name: "Invoice" }),
      template({ alias: "kept" }),
    ])
    assert.deepEqual(
      [first!.alias, first!.preview, first!.publishedAt],
      ["invoice", "", 7]
    )
    assert.deepEqual([second!.alias, second!.publishedAt], ["invoice-2", null])
    assert.equal(third!.alias, "kept")
  })
})
