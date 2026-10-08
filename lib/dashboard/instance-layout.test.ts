import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ConvexProvider, type ConvexReactClient } from "convex/react"
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime"
import { Window } from "happy-dom"
import InstanceLayout from "../../app/(app)/(dashboard)/instance/layout"
import { INSTANCE_PAGES } from "./nav"

function render(path: string, admin: boolean | undefined) {
  // Only installation.status is queried by the layout; no server is contacted.
  const client = {
    watchQuery: () => ({
      localQueryResult: () => (admin === undefined ? undefined : { admin }),
    }),
  } as unknown as ConvexReactClient
  const content = h(InstanceLayout, {
    children: h("section", null, h("h2", null, "Page settings")),
  })
  const html = renderToStaticMarkup(
    h(PathnameContext.Provider, {
      value: path,
      children: h(ConvexProvider, { client, children: content }),
    })
  )
  const window = new Window()
  window.document.body.innerHTML = html
  return window.document
}

test("the shared instance layout puts each title and intro before page settings", () => {
  for (const page of INSTANCE_PAGES) {
    const document = render(page.href, true)
    const title = document.querySelector("h1")!
    assert.equal(title.textContent, page.title)
    assert.equal(title.nextElementSibling?.textContent, page.description)
    assert.equal(document.querySelectorAll("h1").length, 1)
    assert.ok(document.body.firstElementChild?.contains(title))
    assert.equal(document.body.lastElementChild?.textContent, "Page settings")
  }
})

test("instance settings stay hidden while loading and for non-admin accounts", () => {
  for (const admin of [undefined, false]) {
    const document = render("/instance/general", admin)
    assert.equal(document.querySelector("h1")?.textContent, "Instance settings")
    assert.equal(
      document.querySelector("h2")?.textContent,
      admin === false ? "Administrator access required" : undefined
    )
    assert.equal(document.body.textContent.includes("Page settings"), false)
    if (admin === false)
      assert.ok(
        document.body.textContent.includes("Administrator access required")
      )
  }
})
