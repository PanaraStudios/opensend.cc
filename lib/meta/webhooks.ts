/** WhatsApp webhook shapes are documented per field:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_quality_update
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/phone_number_name_update
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/template_category_update
 * Checked 2026-10-01 against Meta's .md references. Management fields use
 * entry.id and display_phone_number, not metadata. Limits prefer the new
 * max_daily_conversations_per_business; current_limit is deprecated.
 */
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
export const string = (value: unknown) =>
  typeof value === "string" ? value : ""
export const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : []
export const timestamp = (value: unknown, fallback: number) => {
  const seconds = Number(value)
  return (typeof value === "string" || typeof value === "number") &&
    Number.isFinite(seconds) &&
    seconds > 0 &&
    seconds * 1000 <= 8.64e15
    ? seconds * 1000
    : fallback
}
export const MEDIA_TYPES = [
  "image",
  "video",
  "audio",
  "document",
  "sticker",
] as const
export const STATUS_RANK = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
  received: 0,
} as const
export const outboundStatus = (
  value: unknown
): "sent" | "delivered" | "read" | "failed" | null =>
  value === "sent" ||
  value === "delivered" ||
  value === "read" ||
  value === "failed"
    ? value
    : null

/** A channel profile name as contact names: the first word, then the rest.
    Only used when inbound creates a contact, so a CRM's names are kept. */
export function profileNameParts(name: string) {
  const [firstName = "", ...rest] = name.trim().split(/\s+/).filter(Boolean)
  return { firstName, lastName: rest.join(" ") }
}

export type PageWebhookItem = {
  channel: "messenger" | "instagram"
  accountId: string
  sender: string
  at: number
} & (
  | { kind: "message"; data: Record<string, unknown> }
  | {
      kind: "status"
      status: "delivered" | "read"
      ids: string[]
      watermark?: number
    }
)
const milliseconds = (value: unknown, fallback: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= 8.64e15
    ? value
    : fallback

/** Page/Instagram webhook timestamps and read watermarks are milliseconds.
 * https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks
 */
export function pageWebhookItems(
  raw: unknown,
  fallback: number
): PageWebhookItem[] {
  const root = object(raw)
  if (root.object !== "page" && root.object !== "instagram") return []
  const channel: "messenger" | "instagram" =
    root.object === "page" ? "messenger" : "instagram"
  const items: PageWebhookItem[] = []
  for (const rawEntry of array(root.entry)) {
    const entry = object(rawEntry),
      accountId = string(entry.id)
    if (!accountId) continue
    for (const rawEvent of array(entry.messaging)) {
      const event = object(rawEvent),
        sender = string(object(event.sender).id)
      const recipient = string(object(event.recipient).id)
      if (!sender || recipient !== accountId) continue
      const at = milliseconds(event.timestamp, fallback),
        base = { channel, accountId, sender, at }
      const message = object(event.message)
      if (message.is_echo === true || sender === accountId) continue
      const postback = object(event.postback),
        reaction = object(event.reaction)
      if (event.message || event.postback || event.reaction) {
        const mid = string(message.mid) || string(postback.mid)
        let data: Record<string, unknown>
        if (event.reaction) {
          if (!string(reaction.mid)) continue
          data = {
            id: `reaction:${string(reaction.mid)}:${sender}:${at}:${string(reaction.action)}`,
            type: "reaction",
            reaction,
          }
        } else if (event.postback) {
          // Some postbacks lack mid; the timestamp and payload identify a replay.
          data = {
            id: mid || `postback:${sender}:${at}:${string(postback.payload)}`,
            type: "button",
            button: {
              text: string(postback.title),
              payload: string(postback.payload),
            },
          }
        } else {
          if (!mid) continue
          const attachments = array(message.attachments).map(object)
          const attachment = attachments[0],
            type = string(attachment?.type)
          const kind =
            type === "file"
              ? "document"
              : MEDIA_TYPES.find((known) => known === type)
          data = {
            id: mid,
            type:
              typeof message.text === "string"
                ? "text"
                : (kind ?? "unsupported"),
            ...(typeof message.text === "string"
              ? { text: { body: message.text } }
              : {}),
            ...(kind ? { [kind]: object(attachment.payload) } : {}),
            ...(attachments.length ? { attachments } : {}),
            ...(message.quick_reply
              ? { quick_reply: message.quick_reply }
              : {}),
            ...(message.reply_to ? { reply_to: message.reply_to } : {}),
          }
        }
        items.push({
          ...base,
          kind: "message",
          data: { ...data, from: sender, timestamp: at / 1000 },
        })
      } else if ((channel === "messenger" && event.delivery) || event.read) {
        const data = object(event.delivery ?? event.read)
        const ids = array(data.mids).map(string).filter(Boolean)
        if (string(data.mid)) ids.push(string(data.mid))
        const watermark = milliseconds(data.watermark, 0)
        if (!ids.length && !watermark) continue
        items.push({
          ...base,
          kind: "status",
          status: event.delivery ? "delivered" : "read",
          ids,
          ...(watermark ? { watermark } : {}),
        })
      }
    }
  }
  return items
}
