import { expect, test } from "vitest"
import { parse, type DefaultTreeAdapterMap } from "parse5"
import { renderEmail } from "./email/render"

test.each([
  "<div title={{{value}}}>Hello</div>",
  "<!doctype html><html><body title={{{value}}}>Hello</body></html>",
])(
  "merge values cannot add attributes to hand-written unquoted HTML: %s",
  (html) => {
    const value = "team display-name=contact\tregion=office"
    const rendered = renderEmail({ subject: "Hello", html }, { value })
    const attributes: { name: string; value: string }[] = []
    const visit = (node: DefaultTreeAdapterMap["node"]) => {
      if ("attrs" in node) attributes.push(...node.attrs)
      if ("childNodes" in node)
        for (const child of node.childNodes) visit(child)
    }
    visit(parse(rendered.html))
    expect(attributes).toEqual([{ name: "title", value }])
  }
)

test("merge rendering preserves quoted attribute and text content", () => {
  const value = "Team & office"
  const html = '<div title="{{{value}}}">{{{value}}}</div>'
  expect(
    renderEmail({ subject: "Hello {{{value}}}", html }, { value })
  ).toMatchObject({
    subject: `Hello ${value}`,
    html: '<div title="Team &amp; office">Team &amp; office</div>',
  })
})
