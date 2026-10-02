import { hydratedChannelMessage } from "./payload"
import { RateLimiter } from "@convex-dev/rate-limiter"
import { ConvexError, v } from "convex/values"
import { channelStrategies } from "../../lib/meta/payloads"
import { components, internal } from "../_generated/api"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { channelAccountAccess } from "./messages"
import { findMetaApp } from "../access"
import { teamRow } from "../lists"
import { patchRow } from "../counts"
import { emitEvent } from "../events"
import { callerValue, requireCaller, invalid, notFound } from "../api/caller"
import { controlJob, messagingChannelValue } from "../tables/channels"

const limiter = new RateLimiter(components.rateLimiter)

/** Latest inbound via the direction index, without scanning outbound history. */
export async function latestInbound(
  ctx: QueryCtx,
  conversationId: Id<"conversations">
) {
  return ctx.db
    .query("channelMessages")
    .withIndex("by_conversationId_and_direction", (q) =>
      q.eq("conversationId", conversationId).eq("direction", "inbound")
    )
    .order("desc")
    .first()
}
function assertReadable(message: Doc<"channelMessages">) {
  if (message.direction !== "inbound")
    throw invalid("Read receipts and typing require an inbound message.")
  if (!message.externalId)
    throw invalid("The inbound message has no Meta message ID.")
  if (
    (message.observedAt ?? message._creationTime) <
    Date.now() - 30 * 86400_000
  )
    throw invalid(
      "Read receipts and typing require an inbound message received within the last 30 days."
    )
}

/** Shared atomic reservation for REST and dashboard. Capacity one enforces spacing. */
export async function reserveControl(
  ctx: MutationCtx,
  message: Doc<"channelMessages">,
  read: boolean,
  typing?: boolean
) {
  if (read || message.channel === "whatsapp") assertReadable(message)
  if (message.channel === "whatsapp" && typing === false && !read)
    throw invalid(
      "WhatsApp does not support typing_off; its indicator expires after 25 seconds or the next send."
    )
  await channelAccountAccess(
    ctx,
    message.organizationId,
    message.accountId,
    message.channel
  )
  const key = message.conversationId
  if (read || (message.channel === "whatsapp" && typing === true)) {
    const limit = await limiter.limit(ctx, "channelReadReceipt", {
      key,
      config: { kind: "token bucket", rate: 1, period: 2000, capacity: 1 },
    })
    if (!limit.ok) return null
  }
  if (typing !== undefined && (typing || message.channel !== "whatsapp")) {
    const limit = await limiter.limit(ctx, "channelTyping", {
      key,
      config: { kind: "token bucket", rate: 1, period: 5000, capacity: 1 },
    })
    if (!limit.ok) {
      if (!read) return null
      typing = undefined
    }
  } else typing = undefined
  return {
    messageId: message._id,
    read,
    ...(typing !== undefined ? { typing } : {}),
  }
}

/** Page sender actions need a recipient, independent of the inbound message age. */
export async function typingMessage(
  ctx: QueryCtx,
  conversation: Doc<"conversations">
) {
  return conversation.channel === "whatsapp"
    ? latestInbound(ctx, conversation._id)
    : ctx.db
        .query("channelMessages")
        .withIndex("by_conversationId", (q) =>
          q.eq("conversationId", conversation._id)
        )
        .order("desc")
        .first()
}

export const prepare = internalMutation({
  args: {
    caller: callerValue,
    channel: messagingChannelValue,
    id: v.string(),
    read: v.boolean(),
    typing: v.optional(v.boolean()),
  },
  returns: v.union(v.null(), controlJob),
  handler: async (ctx, { caller, channel, id, read, typing }) => {
    await requireCaller(ctx, caller, { resource: channel, access: "write" })
    let message: Doc<"channelMessages"> | null
    if (read) {
      message = await teamRow(
        ctx,
        "channelMessages",
        caller.organizationId,
        id,
        { keep: (m) => m.channel === channel }
      )
      if (!message) throw notFound("Message")
    } else {
      const conversation = await teamRow(
        ctx,
        "conversations",
        caller.organizationId,
        id,
        { keep: (c) => c.channel === channel }
      )
      if (!conversation) throw notFound("Conversation")
      message = await typingMessage(ctx, conversation)
      if (!message)
        throw invalid(
          "Typing requires an inbound message in this conversation."
        )
    }
    return reserveControl(ctx, message, read, typing)
  },
})

/** Recheck the account at execution time. Tokens stay out of scheduled arguments. */
export const credentials = internalQuery({
  args: { messageId: v.id("channelMessages"), read: v.boolean() },
  returns: v.object({
    channel: messagingChannelValue,
    externalId: v.string(),
    recipient: v.string(),
    endpoint: v.string(),
    encryptedToken: v.string(),
    version: v.string(),
    connectionId: v.id("metaConnections"),
  }),
  handler: async (ctx, { messageId, read }) => {
    const message = await ctx.db.get("channelMessages", messageId)
    if (!message) throw new ConvexError("Message not found")
    if (read || message.channel === "whatsapp") assertReadable(message)
    const { account, connection } = await channelAccountAccess(
      ctx,
      message.organizationId,
      message.accountId,
      message.channel
    )
    const app = await findMetaApp(ctx)
    if (!app) throw new ConvexError("Meta configuration is missing")
    return {
      channel: message.channel,
      externalId: message.externalId ?? "",
      recipient: message.direction === "inbound" ? message.from : message.to,
      endpoint: channelStrategies[message.channel].endpoint(account),
      encryptedToken: account.encryptedToken ?? connection.encryptedToken,
      version: app.graphVersion,
      connectionId: connection._id,
    }
  },
})

export async function logControlFailure(
  ctx: MutationCtx,
  messageId: Id<"channelMessages">,
  read: boolean,
  error: string
) {
  const message = await ctx.db.get("channelMessages", messageId)
  if (!message) return
  await emitEvent(
    ctx,
    message.organizationId,
    `${message.channel}.message.${read ? "read_receipt_failed" : "typing_failed"}`,
    {
      ...(await hydratedChannelMessage(ctx, message, Date.now())),
      id: messageId,
      conversation_id: message.conversationId,
      error,
    }
  )
  await ctx.db.insert("channelMessageEvents", {
    messageId,
    type: read ? "read_receipt_failed" : "typing_failed",
    at: Date.now(),
    details: JSON.stringify({
      message: `${read ? "Read receipt" : "Typing indicator"} failed: ${error}`,
    }),
  })
}
export const record = internalMutation({
  args: {
    messageId: v.id("channelMessages"),
    read: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, read, error }) => {
    const message = await ctx.db.get("channelMessages", messageId)
    if (!message) return null
    if (error !== undefined)
      await logControlFailure(ctx, messageId, read, error)
    else if (read) {
      const at = Date.now()
      await patchRow(ctx, "channelMessages", messageId, {
        readReceiptSentAt: at,
      })
      await ctx.db.insert("channelMessageEvents", {
        messageId,
        type: "read_receipt_sent",
        at,
      })
      await emitEvent(
        ctx,
        message.organizationId,
        `${message.channel}.message.read_receipt_sent`,
        {
          ...(await hydratedChannelMessage(ctx, message, at)),
          id: messageId,
          conversation_id: message.conversationId,
          read_receipt_sent_at: new Date(at).toISOString(),
        }
      )
    }
    return null
  },
})

export async function scheduleControl(
  ctx: MutationCtx,
  message: Doc<"channelMessages">,
  read: boolean,
  typing?: boolean
) {
  try {
    const job = await reserveControl(ctx, message, read, typing)
    if (job)
      await ctx.scheduler.runAfter(
        0,
        internal.channels.controlActions.send,
        job
      )
  } catch (error) {
    await logControlFailure(
      ctx,
      message._id,
      read,
      error instanceof ConvexError
        ? JSON.stringify(error.data)
        : error instanceof Error
          ? error.message
          : "Unknown error"
    )
  }
}
