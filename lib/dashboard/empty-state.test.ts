import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { EmptyTitle } from "../../components/ui/empty"
test("empty state titles are semantic headings without caller role attributes", () => {
  const html = renderToStaticMarkup(
    createElement(EmptyTitle, null, "Calling stack is not configured")
  )
  assert.match(html, /^<h3\b/)
  assert.match(html, />Calling stack is not configured<\/h3>/)
})
