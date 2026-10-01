import { object, array, string } from "../../lib/meta/parse"
import type { Doc } from "../_generated/dataModel"

/** The same message contract is used by senders and webhook projections. */
export function channelMessagePayload(
  message: Doc<"channelMessages">,
  payload: Record<string, unknown> = {}
) {
  const pageMessage = object(payload.message)
  const attachment = object(
    pageMessage.attachment ?? array(pageMessage.attachments)[0]
  )
  const postback = object(payload.postback)
  return {
    id: message._id,
    channel: message.channel,
    account_id: message.accountId,
    conversation_id: message.conversationId,
    from: message.from,
    to: message.to,
    type: message.type,
    status: message.status,
    direction: message.direction,
    external_id: message.externalId ?? null,
    tags: message.tags ?? [],
    created_at: new Date(message._creationTime).toISOString(),
    ...(message.type === "text" ||
    (message.channel !== "whatsapp" && message.type === "template")
      ? {
          text:
            typeof payload.text === "object" &&
            payload.text !== null &&
            "body" in payload.text &&
            typeof payload.text.body === "string"
              ? payload.text.body
              : typeof pageMessage.text === "string"
                ? pageMessage.text
                : message.preview,
        }
      : {}),
    ...(pageMessage.quick_replies
      ? { quick_replies: pageMessage.quick_replies }
      : {}),
    ...(payload.button || payload.postback
      ? {
          button: payload.button ?? {
            text: string(postback.title),
            payload: string(postback.payload),
          },
        }
      : {}),
    ...(payload.quick_reply || pageMessage.quick_reply
      ? { quick_reply: payload.quick_reply ?? pageMessage.quick_reply }
      : {}),
    ...(["location", "interactive", "reaction"].includes(message.type)
      ? { [message.type]: payload[message.type] ?? null }
      : {}),
    ...(payload.template ? { template: payload.template } : {}),
    ...(["image", "audio", "video", "document", "sticker"].includes(
      message.type
    )
      ? {
          media: payload[message.type] ?? attachment.payload,
          [message.type]: payload[message.type] ?? attachment.payload,
        }
      : {}),
    ...(message.error
      ? {
          error: {
            code: message.errorCode ?? null,
            message: message.error,
            title: message.errorTitle ?? null,
          },
        }
      : {}),
  }
}
