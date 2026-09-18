/* Helpers for reading finished email markup back into the editor. Browser
   only: they parse with `DOMParser`. */

const WRAPPERS = new Set(["TABLE", "TBODY", "TR", "TD", "DIV", "CENTER"])

function isHidden(element: Element): boolean {
  const style = element.getAttribute("style") ?? ""
  return /display\s*:\s*none/i.test(style)
}

/** The part of an email a person wrote: the markup inside the layout tables
    every email is wrapped in, without the hidden inbox-preview text. */
export function emailContentHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html")
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    if (isHidden(element)) element.remove()
  }
  let node: Element = doc.body
  while (
    node.children.length === 1 &&
    WRAPPERS.has(node.children[0]!.tagName)
  ) {
    /* A wrapper with text of its own is content, not layout. */
    const own = Array.from(node.childNodes).some(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()
    )
    if (own) break
    node = node.children[0]!
  }
  return node.innerHTML
}
