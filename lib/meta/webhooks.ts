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
import { array, object, string, oneOf } from "./parse"
import type { MessagingChannel, PageChannel } from "../channels"
import { fromWaId, normalizePhone, toWaId } from "../dashboard/phone"
import { CHANNEL_MESSAGE_TYPES } from "../../convex/tables/channels"
export { array, object, string } from "./parse"
export const timestamp = (
  value: unknown,
  fallback: number,
  unit: "seconds" | "milliseconds" = "seconds"
) => {
  const at = Number(value) * (unit === "seconds" ? 1000 : 1)
  return (typeof value === "string" || typeof value === "number") &&
    Number.isFinite(at) &&
    at > 0 &&
    at <= 8.64e15
    ? at
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

export type InboundItem = {
  kind: "message"
  sender: string
  externalId: string
  type: (typeof CHANNEL_MESSAGE_TYPES)[number]
  preview: string
  profileName: string
  files: {
    mediaId: string
    contentType: string
    filename?: string
    url?: string
  }[]
  phone?: string
  at: number
  data: Record<string, unknown>
}
export type StatusItem = {
  kind: "status"
  sender: string
  externalId: string
  status: NonNullable<ReturnType<typeof outboundStatus>>
  at: number
  data: Record<string, unknown>
}
export type WebhookItem = {
  channel: MessagingChannel
  accountId: string
  wabaId?: string
} & (
  | InboundItem
  | StatusItem
  | {
      kind: "watermark"
      sender: string
      status: "delivered" | "read"
      watermark: number
      at: number
    }
)
export type PageWebhookItem = WebhookItem & { channel: PageChannel }
export const MANAGEMENT_WEBHOOK_FIELDS = [
  "phone_number_quality_update",
  "phone_number_name_update",
  "account_update",
] as const
export const ACCOUNT_REMOVED_EVENTS = [
  "ACCOUNT_DELETED",
  "PARTNER_REMOVED",
  "PARTNER_APP_UNINSTALLED",
  "ACCOUNT_OFFBOARDED",
] as const
export const ACCOUNT_RESTRICTED_EVENTS = [
  "ACCOUNT_RESTRICTION",
  "ACCOUNT_VIOLATION",
] as const

/** WhatsApp is parsed into the same inbound and status items as Page channels. */
export function whatsappWebhookItems(
  value: Record<string, unknown>,
  wabaId: string,
  fallback: number
): WebhookItem[] {
  const accountId = string(object(value.metadata).phone_number_id)
  const base = { channel: "whatsapp" as const, accountId, wabaId }
  const items: WebhookItem[] = []
  for (const raw of array(value.messages)) {
    const data = object(raw),
      externalId = string(data.id),
      sender = toWaId(string(data.from))
    const phone = normalizePhone(fromWaId(sender))
    if (!externalId || !sender || !phone) continue
    const type = oneOf(data.type, CHANNEL_MESSAGE_TYPES) ?? "unsupported",
      media = object(data[type])
    const profile = array(value.contacts)
      .map(object)
      .find((contact) => string(contact.wa_id) === sender)
    const mediaId = string(media.id)
    items.push({
      ...base,
      kind: "message",
      externalId,
      sender,
      phone,
      type,
      profileName: string(object(profile?.profile).name),
      preview: (type === "text"
        ? string(object(data.text).body)
        : string(media.caption) || `[${type}]`
      ).slice(0, 1000),
      at: timestamp(data.timestamp, fallback),
      data,
      files:
        MEDIA_TYPES.some((t) => t === type) && mediaId
          ? [
              {
                mediaId,
                contentType:
                  string(media.mime_type) || "application/octet-stream",
                ...(string(media.filename)
                  ? { filename: string(media.filename) }
                  : {}),
              },
            ]
          : [],
    })
  }
  for (const raw of array(value.statuses)) {
    const data = object(raw),
      status = outboundStatus(data.status),
      externalId = string(data.id)
    if (status && externalId)
      items.push({
        ...base,
        kind: "status",
        externalId,
        sender: string(data.recipient_id),
        status,
        at: timestamp(data.timestamp, fallback),
        data,
      })
  }
  return items
}

/** Page timestamps and read watermarks are already in milliseconds. Native
 * Page message data is retained; it is never converted to WhatsApp wire data. */
export function pageWebhookItems(
  raw: unknown,
  fallback: number
): PageWebhookItem[] {
  const root = object(raw)
  if (root.object !== "page" && root.object !== "instagram") return []
  const channel: PageChannel =
    root.object === "page" ? "messenger" : "instagram"
  const items: PageWebhookItem[] = []
  for (const rawEntry of array(root.entry)) {
    const entry = object(rawEntry),
      accountId = string(entry.id)
    if (!accountId) continue
    for (const rawEvent of array(entry.messaging)) {
      const event = object(rawEvent),
        sender = string(object(event.sender).id)
      if (!sender || string(object(event.recipient).id) !== accountId) continue
      const at = timestamp(event.timestamp, fallback, "milliseconds"),
        base = { channel, accountId, sender, at }
      const message = object(event.message),
        postback = object(event.postback),
        reaction = object(event.reaction)
      if (message.is_echo === true || sender === accountId) continue
      if (event.message || event.postback || event.reaction) {
        const attachments = array(message.attachments).map(object)
        const attachment = attachments[0],
          kind = string(attachment?.type)
        let externalId = string(message.mid) || string(postback.mid)
        let type: InboundItem["type"]
        if (event.reaction) {
          if (!string(reaction.mid)) continue
          externalId = `reaction:${string(reaction.mid)}:${sender}:${at}:${string(reaction.action)}`
          type = "reaction"
        } else if (event.postback) {
          externalId ||= `postback:${sender}:${at}:${string(postback.payload)}`
          type = "button"
        } else {
          if (!externalId) continue
          type =
            typeof message.text === "string"
              ? "text"
              : kind === "file"
                ? "document"
                : (oneOf(kind, MEDIA_TYPES) ?? "unsupported")
        }
        items.push({
          ...base,
          kind: "message",
          externalId,
          type,
          profileName: "",
          preview: (type === "text"
            ? string(message.text)
            : string(object(attachment?.payload).caption) || `[${type}]`
          ).slice(0, 1000),
          data: event,
          files: attachments.flatMap((attachment, index) => {
            const url = string(object(attachment.payload).url)
            return url &&
              ["image", "video", "audio", "file", "sticker"].includes(
                string(attachment.type)
              )
              ? [
                  {
                    mediaId: `${externalId}:${index}`,
                    url,
                    contentType: "application/octet-stream",
                  },
                ]
              : []
          }),
        })
      } else if ((channel === "messenger" && event.delivery) || event.read) {
        const data = object(event.delivery ?? event.read)
        const ids = array(data.mids).map(string).filter(Boolean)
        if (string(data.mid)) ids.push(string(data.mid))
        const status = event.delivery
          ? ("delivered" as const)
          : ("read" as const)
        for (const externalId of ids)
          items.push({ ...base, kind: "status", externalId, status, data })
        const watermark = timestamp(data.watermark, 0, "milliseconds")
        if (watermark)
          items.push({ ...base, kind: "watermark", status, watermark })
      }
    }
  }
  return items
}
