import type { ThreadMessage } from "./use-messages"

/** Detail renders exactly this message, even when it is older than the thread page. */
export function detailThreadMessage(found: {
  message: {
    _id: string
    _creationTime: number
    direction: "inbound" | "outbound"
    status: string
    preview: string
  }
  normalized: Record<string, unknown>
  rendered?: ThreadMessage["rendered"]
  media: ThreadMessage["media"]
}): ThreadMessage {
  return {
    id: found.message._id,
    kind: "channel",
    direction: found.message.direction,
    at: found.message._creationTime,
    status: found.message.status,
    text: found.rendered?.body ?? found.message.preview,
    rendered: found.rendered,
    normalized: found.normalized as ThreadMessage["normalized"],
    media: found.media,
  }
}
