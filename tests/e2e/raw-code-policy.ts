// Common attachment filenames are customer content, not leaked machine labels.
// Keep variable paths such as contact.first_name and trigger.message.text eligible.
export const RAW_CODE_FILENAME_PATTERN =
  /\.(?:pdf|png|jpe?g|gif|webp|svg|csv|txt|docx?|xlsx?|pptx?|zip|mp[34]|wav|ogg)$/i

// Self-contained browser function: Playwright serializes it without module imports.
export function findVisibleRawCodes(fileNamePattern: RegExp): string[] {
  const raw = new Set<string>()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode,
      el = node.parentElement
    if (
      !el ||
      el.closest(
        'input, textarea, pre, code, script, style, [hidden], [aria-hidden="true"], [data-slot="json-viewer"], [data-testid*="payload"]'
      ) ||
      !el.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      })
    )
      continue
    const text = node.textContent ?? ""
    // Strip complete filenames before tokenization: the snake-case alternative
    // would otherwise split order_receipt.pdf into order_receipt and pdf.
    const diagnosticText = text.replace(
      /\b[a-z][\w-]*(?:\.[\w-]+)+\b/gi,
      (candidate) => (fileNamePattern.test(candidate) ? "" : candidate)
    )
    for (const token of diagnosticText.match(
      /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[a-z][a-z_]*(?:\.[a-z_]+)+\b/g
    ) ?? []) {
      // Domain names and URLs are readable addresses, not machine labels.
      if (
        fileNamePattern.test(token) ||
        /\.(test|com|cc|dev|net|org|io)$/.test(token) ||
        text.includes("https://") ||
        text.includes("http://") ||
        text.includes("@") ||
        // A handle may render its @ prefix in a separate text node.
        el.textContent?.trim() === `@${token}`
      )
        continue
      raw.add(token)
    }
  }
  return [...raw]
}
