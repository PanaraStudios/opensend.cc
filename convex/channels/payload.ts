import { normalizeWhatsAppMessage } from "../../packages/sdk/src/whatsapp/normalize"
import type { WhatsAppIdentity } from "../../packages/sdk/src/whatsapp/catalog"
import type { QueryCtx } from "../_generated/server"
import { env } from "../_generated/server"
import { findInstallation } from "../access"
import { signedFileLinkForOrigin } from "../fileDownloads"
import { object, array, string } from "../../lib/meta/parse"
import type { Doc } from "../_generated/dataModel"

/** The same message contract is used by senders and webhook projections. */
export function channelMessagePayload(
  message: Doc<"channelMessages">,
  payload: Record<string, unknown> = {},
  identity: WhatsAppIdentity = {}
) {
  const pageMessage = object(payload.message)
  const attachment = object(
    pageMessage.attachment ?? array(pageMessage.attachments)[0]
  )
  const postback = object(payload.postback)
  const normalized =
    message.channel === "whatsapp"
      ? normalizeWhatsAppMessage(
          { ...payload, type: payload.type ?? message.type },
          identity
        )
      : null
  return {
    ...(normalized ?? {}),
    ...(!normalized
      ? {
          content:
            message.type === "text"
              ? { body: string(pageMessage.text) || message.preview }
              : message.type === "button"
                ? {
                    text: string(postback.title),
                    payload: string(postback.payload),
                  }
                : object(attachment.payload),
        }
      : {}),
    ...(message.channel === "whatsapp" ? { raw: payload } : {}),
    id: message._id,
    channel: message.channel,
    account_id: message.accountId,
    conversation_id: message.conversationId,
    from: message.from,
    to: message.to,
    type:
      normalized?.type ??
      (attachment.type === "template" ? "template" : message.type),
    status: message.status,
    direction: message.direction,
    external_id: message.externalId ?? null,
    read_receipt_sent_at:
      message.readReceiptSentAt === undefined
        ? null
        : new Date(message.readReceiptSentAt).toISOString(),
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
    ...([
      "location",
      "interactive",
      "reaction",
      "contacts",
      "order",
      "system",
      "unsupported",
      "edit",
      "revoke",
    ].includes(message.type)
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
    ...(message.revokedAt !== undefined
      ? { revoked_at: new Date(message.revokedAt).toISOString() }
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

/** Bounded hydration shared by lists, details and customer events. Reactions
 * stay as message rows; latest observation per sender is attached to the target. */
export async function hydratedChannelMessage(
  ctx: QueryCtx,
  message: Doc<"channelMessages">,
  now: number,
  suppliedContent?: Doc<"channelMessageContents"> | null
) {
  const content =
    suppliedContent !== undefined
      ? suppliedContent
      : await ctx.db
          .query("channelMessageContents")
          .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
          .unique()
  const payload = content ? object(JSON.parse(content.payload)) : {}
  const contact = await ctx.db.get("channelContacts", message.channelContactId)
  const account =
    message.channel === "whatsapp"
      ? await ctx.db.get("channelAccounts", message.accountId)
      : null
  const connection = account
    ? await ctx.db.get("metaConnections", account.connectionId)
    : null
  const alias = connection
    ? await ctx.db
        .query("whatsappUserAliases")
        .withIndex("by_channelContactId_and_businessId", (q) =>
          q
            .eq("channelContactId", message.channelContactId)
            .eq("businessId", connection.businessId)
        )
        .order("desc")
        .first()
    : null
  const profile =
    alias ?? (contact?.userScopeId === connection?.businessId ? contact : null)
  const identity: WhatsAppIdentity = {
    ...(contact?.phone ? { wa_id: contact.phone.replace(/^\+/, "") } : {}),
    ...(profile?.userId ? { user_id: profile.userId } : {}),
    ...(profile?.parentUserId ? { parent_user_id: profile.parentUserId } : {}),
    ...((profile?.username ?? contact?.username)
      ? { username: profile?.username ?? contact?.username }
      : {}),
    ...((profile?.identityKeyHash ?? contact?.identityKeyHash)
      ? {
          identity_key_hash:
            profile?.identityKeyHash ?? contact?.identityKeyHash,
        }
      : {}),
  }
  const origin =
    (await findInstallation(ctx))?.callbackOrigin ?? env.CONVEX_SITE_URL
  const attachments = await Promise.all(
    (content?.media ?? []).map(async (file) => ({
      id: file.mediaId ?? null,
      content_type: file.contentType,
      filename: file.filename ?? null,
      size: file.size ?? null,
      ...(file.mediaId
        ? await signedFileLinkForOrigin(
            origin,
            "/channels/media/",
            "channel-media",
            { messageId: message._id, mediaId: file.mediaId },
            now
          )
        : { download_url: null, expires_at: null }),
      error: file.error ?? null,
    }))
  )
  const reactions = []
  if (message.channel === "whatsapp" && message.externalId) {
    const observations = await ctx.db
      .query("channelMessages")
      .withIndex("by_accountId_and_reactionTargetExternalId", (q) =>
        q
          .eq("accountId", message.accountId)
          .eq("reactionTargetExternalId", message.externalId)
      )
      .order("desc")
      .take(100)
    const senders = new Set<string>()
    observations.sort(
      (a, b) =>
        (b.observedAt ?? b._creationTime) - (a.observedAt ?? a._creationTime) ||
        b._creationTime - a._creationTime
    )
    for (const reaction of observations) {
      const senderKey =
        reaction.direction === "inbound"
          ? reaction.channelContactId
          : reaction.from
      if (
        reaction.organizationId !== message.organizationId ||
        reaction.conversationId !== message.conversationId ||
        senders.has(senderKey)
      )
        continue
      senders.add(senderKey)
      const body = await ctx.db
        .query("channelMessageContents")
        .withIndex("by_messageId", (q) => q.eq("messageId", reaction._id))
        .unique()
      const emoji = string(
        object(body ? JSON.parse(body.payload).reaction : {}).emoji
      )
      if (emoji)
        reactions.push({
          id: reaction._id,
          external_id: reaction.externalId ?? null,
          from: reaction.from,
          emoji,
          created_at: new Date(
            reaction.observedAt ?? reaction._creationTime
          ).toISOString(),
        })
    }
  }
  const reactionTargetExternalId =
    message.reactionTargetExternalId ??
    (message.type === "reaction"
      ? string(object(payload.reaction).message_id)
      : undefined)
  let reactionTargetId = null
  if (reactionTargetExternalId) {
    const candidates = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel_and_externalId", (q) =>
        q
          .eq("channel", message.channel)
          .eq("externalId", reactionTargetExternalId)
      )
      .take(10)
    reactionTargetId =
      candidates.find(
        (m) =>
          m.organizationId === message.organizationId &&
          m.accountId === message.accountId &&
          m.conversationId === message.conversationId
      )?._id ?? null
  }
  return {
    ...channelMessagePayload(message, payload, identity),
    ...(content?.rendered ? { rendered: content.rendered } : {}),
    ...(content?.sendResponse
      ? { send_response: JSON.parse(content.sendResponse) }
      : {}),
    ...(content?.statusState
      ? {
          status_raw: JSON.parse(content.statusState),
          ...(string(
            object(JSON.parse(content.statusState)).biz_opaque_callback_data
          )
            ? {
                biz_opaque_callback_data: string(
                  object(JSON.parse(content.statusState))
                    .biz_opaque_callback_data
                ),
              }
            : {}),
        }
      : {}),
    ...(content?.paymentState
      ? { payment: JSON.parse(content.paymentState) }
      : {}),
    attachments,
    ...(message.channel === "whatsapp"
      ? {
          reactions,
          ...(message.type === "reaction"
            ? { reaction_target_id: reactionTargetId }
            : {}),
        }
      : {}),
  }
}
