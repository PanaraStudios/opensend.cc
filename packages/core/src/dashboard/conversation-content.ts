/** Presentation helpers for normalized channel content. Never reads `raw`. */
import { object, string } from "../meta/parse"
import { callPermissionReplyLabel } from "./voice-playground"

/** Readable text for the same normalized content shown in the conversation. */
export function messageContentPreview(
  type: string,
  value: unknown,
  fallback: string,
  rendered?: { body: string } | null
) {
  const content = object(value)
  if (type === "revoke") return "Message deleted"
  if (type === "template") return rendered?.body || fallback
  if (["image", "video", "audio", "document", "sticker"].includes(type))
    return `${type[0].toUpperCase()}${type.slice(1)}${string(content.caption) ? `: ${string(content.caption)}` : ""}`
  if (type === "interactive") {
    const subtype = string(content.type)
    if (["button_reply", "list_reply"].includes(subtype)) {
      const reply = object(content[subtype])
      return (
        [string(reply.title), string(reply.description)]
          .filter(Boolean)
          .join(" — ") || fallback
      )
    }
    if (subtype === "nfm_reply") {
      const reply = object(content.nfm_reply)
      return string(reply.body) || "Form response"
    }
    if (subtype === "call_permission_reply")
      return `Call permission: ${callPermissionReplyLabel(string(object(content.call_permission_reply).response))}`
    return string(object(content.body).text) || fallback
  }
  if (type === "reaction")
    return `Reaction: ${string(content.emoji) || "removed"}`
  if (type === "button") return string(content.text) || fallback
  return string(content.body) || fallback
}

export function relativeMessageTime(at: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

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
