import { parse, type DefaultTreeAdapterTypes } from "parse5"
import { signToken } from "../tokens/signed"

export const TRACKING_CONTEXT = "opensend:tracking:v1:"
export const MAX_TRACKED_LINKS = 1000
const MAX_LINK_BYTES = 128 * 1024

export function httpLink(value: string) {
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}

/** Edit only href values at parser-provided offsets: preserve the sender's
    markup, entities, attribute order, quotes, comments and CSS verbatim. */
export async function trackingHtml(input: {
  html: string
  emailId: string
  origin: string
  open: boolean
  click: boolean
  secret: string
  unsubscribeUrls: string[]
}) {
  const { html, emailId, origin, secret } = input
  const links: string[] = []
  const edits: { start: number; end: number; value: string }[] = []
  const skip = new Set(input.unsubscribeUrls.map(httpLink))
  let bytes = 0
  let pixelAt = html.length
  const visited = new Set<number>()
  const token = (index: number) =>
    signToken(`${emailId}.${index}`, TRACKING_CONTEXT, secret)
  const nodes: DefaultTreeAdapterTypes.Node[] = [
    parse(html, { sourceCodeLocationInfo: true }),
  ]
  while (nodes.length) {
    const node = nodes.pop()!
    if ("childNodes" in node)
      for (let i = node.childNodes.length - 1; i >= 0; i--)
        nodes.push(node.childNodes[i])
    if (
      "tagName" in node &&
      node.tagName === "body" &&
      node.sourceCodeLocation?.endTag
    )
      pixelAt = node.sourceCodeLocation.endTag.startOffset
    if (
      !input.click ||
      !("tagName" in node) ||
      !["a", "area"].includes(node.tagName)
    )
      continue
    if (
      node.attrs.some(
        (a) =>
          a.name === "ses:no-track" ||
          (a.name === "rel" && a.value.split(/\s+/).includes("unsubscribe"))
      )
    )
      continue
    const href = node.attrs.find((a) => a.name === "href")
    const loc = node.sourceCodeLocation?.attrs?.href
    const url = href && httpLink(href.value)
    if (
      !url ||
      !loc ||
      visited.has(loc.startOffset) ||
      skip.has(url) ||
      /\/unsubscribe(?:\/|$)/.test(new URL(url).pathname)
    )
      continue
    visited.add(loc.startOffset)
    bytes += new TextEncoder().encode(url).length
    if (links.length >= MAX_TRACKED_LINKS || bytes > MAX_LINK_BYTES)
      throw new Error("Email tracking links exceed the supported limit")
    const replacement = `${origin}/t/c/${await token(links.length)}`
    links.push(url)
    const attr = html.slice(loc.startOffset, loc.endOffset)
    const match = /^(href\s*=\s*)(["']?)([\s\S]*?)\2$/i.exec(attr)
    if (!match) throw new Error("Invalid tracking link attribute")
    edits.push({
      start: loc.startOffset,
      end: loc.endOffset,
      value: `${match[1]}${match[2]}${replacement}${match[2]}`,
    })
  }
  if (input.open)
    edits.push({
      start: pixelAt,
      end: pixelAt,
      value: `<img src="${origin}/t/o/${await token(-1)}" width="1" height="1" alt="" />`,
    })
  let result = html
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.value + result.slice(edit.end)
  return { html: result, links }
}
