import { toPlainText } from "@react-email/render"
import { parse, type DefaultTreeAdapterMap } from "parse5"
import { escapeHtml, fillVariables } from "../../lib/dashboard/email-variables"

/* The editor exports finished HTML (React Email runs in the browser), so a
   send only fills merge tags. Every send path renders through here. */
export type EmailContent = { subject: string; html: string; text?: string }

/** Hand-written HTML may use unquoted attributes. Character references keep
    whitespace inside the value rather than letting it start another attribute.
    Parse locations identify that context without rewriting the template. */
function fillHtml(
  source: string,
  values: Readonly<Record<string, string | undefined>>
) {
  const unquoted: { start: number; end: number }[] = []
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("attrs" in node && node.sourceCodeLocation?.attrs)
      for (const location of Object.values(node.sourceCodeLocation.attrs)) {
        const attribute = source.slice(location.startOffset, location.endOffset)
        const equals = attribute.indexOf("=")
        if (equals < 0) continue
        const value = attribute.slice(equals + 1).trimStart()
        if (!value.startsWith('"') && !value.startsWith("'"))
          unquoted.push({
            start: location.startOffset,
            end: location.endOffset,
          })
      }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child)
    if ("content" in node) visit(node.content)
  }
  visit(parse(source, { sourceCodeLocationInfo: true }))
  return fillVariables(source, values, (value, offset) => {
    const escaped = escapeHtml(value)
    return unquoted.some(({ start, end }) => offset >= start && offset < end)
      ? escaped.replace(/[\t\n\f\r =`]/g, (char) => `&#${char.charCodeAt(0)};`)
      : escaped
  })
}

/** One recipient's copy. Without an explicit plain-text part, one is
    derived from the filled HTML. */
export function renderEmail(
  content: EmailContent,
  values: Readonly<Record<string, string | undefined>>
) {
  const html = fillHtml(content.html, values)
  return {
    subject: fillVariables(content.subject, values),
    html,
    text:
      content.text === undefined
        ? toPlainText(html)
        : fillVariables(content.text, values),
  }
}
