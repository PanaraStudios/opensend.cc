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
