/** Presentation helpers for normalized channel content. Never reads `raw`. */
export function safeMessageUrl(
  value: unknown,
  phone = false
): string | undefined {
  if (typeof value !== "string") return
  try {
    const url = new URL(value)
    if (
      ["https:", "http:", ...(phone ? ["tel:", "mailto:"] : [])].includes(
        url.protocol
      )
    )
      return url.href
  } catch {
    /* Invalid URLs remain plain text. */
  }
}

export type MessageTextPart = {
  kind: "text" | "bold" | "italic" | "strike" | "code" | "link"
  text: string
}
export function messageTextParts(text: string): MessageTextPart[] {
  const pattern =
    /```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~|(https?:\/\/[^\s<>]+)/g
  const parts: MessageTextPart[] = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > at)
      parts.push({ kind: "text", text: text.slice(at, match.index) })
    const kind = match[1]
      ? "code"
      : match[2]
        ? "bold"
        : match[3]
          ? "italic"
          : match[4]
            ? "strike"
            : "link"
    parts.push({
      kind,
      text: match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5],
    })
    at = match.index! + match[0].length
  }
  if (at < text.length) parts.push({ kind: "text", text: text.slice(at) })
  return parts
}
export function sameMessageGroup(
  a: { direction: string; at: number } | undefined,
  b: { direction: string; at: number }
) {
  return (
    !!a &&
    a.direction === b.direction &&
    b.at - a.at < 5 * 60_000 &&
    new Date(a.at).toDateString() === new Date(b.at).toDateString()
  )
}
export function chatDay(at: number, now: number) {
  const date = new Date(at)
  if (date.toDateString() === new Date(now).toDateString()) return "Today"
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}
export { formatMediaTime as audioTime } from "../media-player"
