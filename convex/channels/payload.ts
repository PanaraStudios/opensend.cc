import type { Doc } from "../_generated/dataModel"

/** The same message contract is used by senders and webhook projections. */
export function channelMessagePayload(
  message: Doc<"channelMessages">,
  payload: Record<string, unknown> = {}
) {
  return {
    id: message._id,
    channel: message.channel,
    account_id: message.accountId,
    conversation_id: message.conversationId,
    from: message.from,
    to: message.to,
    type: message.type,
    status: message.status,
    created_at: new Date(message._creationTime).toISOString(),
    ...(message.type === "text"
      ? {
          text:
            typeof payload.text === "object" &&
            payload.text !== null &&
            "body" in payload.text &&
            typeof payload.text.body === "string"
              ? payload.text.body
              : message.preview,
        }
      : {}),
    ...(payload.template ? { template: payload.template } : {}),
    ...(["image", "audio", "video", "document", "sticker"].includes(
      message.type
    )
      ? { media: payload[message.type] }
      : {}),
    ...(message.error
      ? { error: { code: message.errorCode ?? null, message: message.error } }
      : {}),
  }
}
