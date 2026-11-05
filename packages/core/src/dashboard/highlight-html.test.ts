import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { joinHtmlTokens, tokenizeHtml } from "./highlight-html"

describe("tokenizeHtml", () => {
  it("round-trips a simple paragraph", () => {
    const source = "<p>Thanks, domain verified on our side too.</p>"
    assert.equal(joinHtmlTokens(tokenizeHtml(source)), source)
  })

  it("marks tags, attributes, and quoted strings", () => {
    const source =
      '<p>Reset your password: <a href="https://opensend.cc/reset">this link</a></p>'
    const tokens = tokenizeHtml(source)
    assert.equal(joinHtmlTokens(tokens), source)
    assert.deepEqual(
      tokens
        .filter((token) => token.kind !== "text" && token.kind !== "punct")
        .map((token) => `${token.kind}:${token.value}`),
      [
        "tag:p",
        "tag:a",
        "attr:href",
        'string:"https://opensend.cc/reset"',
        "tag:a",
        "tag:p",
      ]
    )
  })

  it("keeps comments intact", () => {
    const source = "<!-- preview --><br/>"
    assert.equal(joinHtmlTokens(tokenizeHtml(source)), source)
    assert.equal(tokenizeHtml(source)[0]?.kind, "comment")
  })

  it("treats a lone less-than as text", () => {
    const source = "score < 10"
    const tokens = tokenizeHtml(source)
    assert.equal(joinHtmlTokens(tokens), source)
    assert.equal(
      tokens.every((token) => token.kind === "text"),
      true
    )
  })
})
