import { defineTable } from "convex/server"
import { v } from "convex/values"
import { emailSourceValue, tagValue } from "./emails"

const literals = <T extends string>(values: readonly T[]) =>
  v.union(...values.map((value) => v.literal(value)))

/** Every channel a conversation can be on. */
export const CHANNELS = ["email", "whatsapp", "messenger", "instagram"] as const
export const channelValue = literals(CHANNELS)
/** The Meta messaging channels. */
export const MESSAGING_CHANNELS = [
  "whatsapp",
  "messenger",
  "instagram",
] as const
export const messagingChannelValue = literals(MESSAGING_CHANNELS)

/** A sending endpoint's state: a phone number waits for registration. */
export const CHANNEL_ACCOUNT_STATUSES = [
  "pending",
  "active",
  "restricted",
  "error",
  "disconnected",
] as const
export const channelAccountStatusValue = literals(CHANNEL_ACCOUNT_STATUSES)
/** WhatsApp's phone number quality rating, lowercased. */
export const CHANNEL_QUALITIES = ["green", "yellow", "red", "unknown"] as const
export const channelQualityValue = literals(CHANNEL_QUALITIES)

/** Outgoing messages move queued → sent → delivered → read, or fail;
    incoming ones are received. */
export const CHANNEL_MESSAGE_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
] as const
export const channelMessageStatusValue = literals(CHANNEL_MESSAGE_STATUSES)
/** The message kinds the Meta channels carry. */
export const CHANNEL_MESSAGE_TYPES = [
  "text",
  "template",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "button",
  "reaction",
  "unsupported",
] as const
export const channelMessageTypeValue = literals(CHANNEL_MESSAGE_TYPES)
export const DIRECTIONS = ["inbound", "outbound"] as const
export const directionValue = literals(DIRECTIONS)
export const CONVERSATION_STATUSES = ["open", "closed"] as const
export const conversationStatusValue = literals(CONVERSATION_STATUSES)
/** A media file kept in Convex storage. */
export const channelMediaValue = v.object({
  storageId: v.id("_storage"),
  contentType: v.string(),
  filename: v.optional(v.string()),
  size: v.number(),
  /** Meta's media id, when the file came from or went to Meta. */
  mediaId: v.optional(v.string()),
})

/* A channel message mirrors an email: the row lists, search and filters
   read; its content, read only by the detail view and the sender; and its
   timeline. JSON payloads are stored as strings. */
export const channelTables = {
  /** Every sending endpoint: a WhatsApp phone number, a Facebook Page or an
      Instagram account. */
  channelAccounts: defineTable({
    organizationId: v.string(),
    channel: messagingChannelValue,
    /** The phone number id, Page id or Instagram account id. */
    externalId: v.string(),
    connectionId: v.id("metaConnections"),
    wabaId: v.optional(v.string()),
    displayName: v.string(),
    /** The display phone number, Page name or Instagram username. */
    handle: v.string(),
    status: channelAccountStatusValue,
    quality: v.optional(channelQualityValue),
    /** Messages per second the account may send; Meta's default is 80. */
    throughputMps: v.number(),
    /** Meta's messaging limit tier, like `TIER_1K`. */
    messagingLimit: v.optional(v.string()),
    /** A Page access token; WhatsApp numbers use their connection's token. */
    encryptedToken: v.optional(v.string()),
    registeredAt: v.optional(v.number()),
    checkedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_channel", ["organizationId", "channel"])
    .index("by_channel_and_externalId", ["channel", "externalId"])
    .index("by_connectionId", ["connectionId"]),
  /** A person's identity on a channel. Messenger and Instagram ids are
      scoped per Page or account, so `scopeId` names that scope. */
  channelContacts: defineTable({
    organizationId: v.string(),
    channel: messagingChannelValue,
    scopeId: v.string(),
    /** The wa_id, PSID or IGSID. */
    externalId: v.string(),
    contactId: v.optional(v.id("contacts")),
    /** E.164, for WhatsApp. */
    phone: v.optional(v.string()),
    profileName: v.optional(v.string()),
    /** WhatsApp error 131050: the person stopped marketing messages. */
    marketingOptOut: v.boolean(),
    lastInboundAt: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_channel_and_scopeId_and_externalId", [
      "organizationId",
      "channel",
      "scopeId",
      "externalId",
    ])
    .index("by_contactId", ["contactId"]),
  /** One thread per person and account, on any channel; received email
      threads are keyed by the sender's address. */
  conversations: defineTable({
    organizationId: v.string(),
    channel: channelValue,
    accountId: v.optional(v.id("channelAccounts")),
    channelContactId: v.optional(v.id("channelContacts")),
    emailAddress: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    status: conversationStatusValue,
    lastMessageAt: v.number(),
    lastPreview: v.string(),
    lastDirection: directionValue,
    /** Free-form replies are allowed until then (Meta's 24-hour window). */
    windowExpiresAt: v.optional(v.number()),
    unread: v.boolean(),
    /** The person's name, handle and address as words, for search. */
    search: v.string(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_lastMessageAt", [
      "organizationId",
      "lastMessageAt",
    ])
    .index("by_organizationId_and_channel_and_lastMessageAt", [
      "organizationId",
      "channel",
      "lastMessageAt",
    ])
    .index("by_organizationId_and_emailAddress", [
      "organizationId",
      "emailAddress",
    ])
    .index("by_channelContactId", ["channelContactId"])
    .searchIndex("search_search", {
      searchField: "search",
      filterFields: ["organizationId", "channel", "status"],
    }),
  channelMessages: defineTable({
    organizationId: v.string(),
    channel: messagingChannelValue,
    accountId: v.id("channelAccounts"),
    conversationId: v.id("conversations"),
    channelContactId: v.id("channelContacts"),
    direction: directionValue,
    /** The sender and recipient as the channel names them. */
    from: v.string(),
    to: v.string(),
    type: channelMessageTypeValue,
    status: channelMessageStatusValue,
    /** A short text for lists and the inbox. */
    preview: v.string(),
    templateId: v.optional(v.id("templates")),
    broadcastId: v.optional(v.id("broadcasts")),
    replyToId: v.optional(v.id("channelMessages")),
    tags: v.optional(v.array(tagValue)),
    source: v.optional(emailSourceValue),
    apiKeyId: v.optional(v.id("apiKeys")),
    apiLogId: v.optional(v.id("apiLogs")),
    /** Meta's message id (wamid, mid): how status webhooks find it. */
    externalId: v.optional(v.string()),
    /* As on emails: each queued run of the sender carries the generation
       it was queued with, so a stale run is a no-op. */
    generation: v.number(),
    claimed: v.optional(v.boolean()),
    attempts: v.number(),
    rateReadyAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
    errorCode: v.optional(v.number()),
    /** Sender, recipient and preview as words, for the list's search. */
    search: v.string(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_status", ["organizationId", "status"])
    .index("by_organizationId_and_channel", ["organizationId", "channel"])
    .index("by_conversationId", ["conversationId"])
    .index("by_channel_and_externalId", ["channel", "externalId"])
    .index("by_expiresAt", ["expiresAt"])
    .searchIndex("search_search", {
      searchField: "search",
      filterFields: ["organizationId", "channel", "status"],
    }),
  channelMessageContents: defineTable({
    messageId: v.id("channelMessages"),
    /** The channel's message object as JSON. */
    payload: v.string(),
    /** A message carries at most a few files. */
    media: v.optional(v.array(channelMediaValue)),
  }).index("by_messageId", ["messageId"]),
  /** The message's timeline; status webhooks append to it. */
  channelMessageEvents: defineTable({
    messageId: v.id("channelMessages"),
    type: channelMessageStatusValue,
    at: v.number(),
    webhookEventId: v.optional(v.id("metaWebhookEvents")),
    /** Extra details as JSON, like Meta's error object. */
    details: v.optional(v.string()),
  }).index("by_messageId_and_at", ["messageId", "at"]),
}
