import { defineTable } from "convex/server"
import { RENDERED_HEADER_FORMATS } from "../../lib/meta/templates"
import { v } from "convex/values"
import { tagValue } from "./emails"
import {
  CHANNEL_IDS,
  CHANNEL_MESSAGE_STATUSES,
  PAGE_CHANNELS,
  MESSAGING_CHANNELS as messagingChannels,
} from "../../lib/channels"

export const literals = <T extends string>(values: readonly T[]) =>
  v.union(...values.map((value) => v.literal(value)))

export const renderedTemplateValue = v.object({
  header: v.optional(
    v.object({
      format: literals(RENDERED_HEADER_FORMATS),
      text: v.optional(v.string()),
    })
  ),
  body: v.string(),
  footer: v.optional(v.string()),
  buttons: v.array(v.object({ type: v.string(), text: v.string() })),
})

/** Every channel a conversation can be on. */
export const CHANNELS = CHANNEL_IDS
export const channelValue = literals(CHANNELS)
/** The Meta messaging channels. */
export const MESSAGING_CHANNELS = messagingChannels
export const messagingChannelValue = literals(MESSAGING_CHANNELS)
export const pageChannelValue = literals(PAGE_CHANNELS)

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
export { CHANNEL_MESSAGE_STATUSES }
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
  "order",
  "system",
  "edit",
  "revoke",
] as const
export const channelMessageTypeValue = literals(CHANNEL_MESSAGE_TYPES)
export const DIRECTIONS = ["inbound", "outbound"] as const
export const directionValue = literals(DIRECTIONS)
export const CONVERSATION_STATUSES = ["open", "closed"] as const
export const conversationStatusValue = literals(CONVERSATION_STATUSES)
/** An inbound media reference is pending until its file is fetched. */
export const channelMediaValue = v.object({
  storageId: v.optional(v.id("_storage")),
  contentType: v.string(),
  filename: v.optional(v.string()),
  size: v.optional(v.number()),
  error: v.optional(v.string()),
  /** Meta's media id, when the file came from or went to Meta. */
  mediaId: v.optional(v.string()),
  /** Messenger and Instagram attachments arrive as expiring CDN URLs. */
  url: v.optional(v.string()),
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
    /** The Facebook Page behind a Messenger or linked Instagram account. */
    pageId: v.optional(v.string()),
    displayName: v.string(),
    /** The display phone number, Page name or Instagram username. */
    handle: v.string(),
    status: channelAccountStatusValue,
    quality: v.optional(channelQualityValue),
    /** Messages per second the account may send; Meta's default is 80. */
    throughputMps: v.number(),
    /** Meta's messaging limit tier, like `TIER_1K`. */
    messagingLimit: v.optional(v.string()),
    /** Legacy Page token. New accounts use the token on their connection. */
    encryptedToken: v.optional(v.string()),
    registeredAt: v.optional(v.number()),
    checkedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    /** Set with the `disconnected` status; the lists index on it, so a
        disconnected account keeps its row and messages but leaves them. */
    disconnectedAt: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_channel", ["organizationId", "channel"])
    .index("by_organizationId_and_disconnectedAt", [
      "organizationId",
      "disconnectedAt",
    ])
    .index("by_organizationId_and_channel_and_disconnectedAt", [
      "organizationId",
      "channel",
      "disconnectedAt",
    ])
    .index("by_channel_and_externalId", ["channel", "externalId"])
    .index("by_connectionId", ["connectionId"])
    .index("by_wabaId", ["wabaId"]),
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
    username: v.optional(v.string()),
    userId: v.optional(v.string()),
    parentUserId: v.optional(v.string()),
    userScopeId: v.optional(v.string()),
    identityKeyHash: v.optional(v.string()),
    /** WhatsApp error 131050: the person stopped marketing messages. */
    marketingOptOut: v.boolean(),
    lastInboundAt: v.optional(v.number()),
    profileLookedUpAt: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_channel_and_scopeId_and_externalId", [
      "organizationId",
      "channel",
      "scopeId",
      "externalId",
    ])
    .index("by_contactId", ["contactId"]),
  /** BSUIDs are business-scoped aliases of the stable channel identity. */
  whatsappUserAliases: defineTable({
    organizationId: v.string(),
    businessId: v.string(),
    userId: v.string(),
    channelContactId: v.id("channelContacts"),
    parentUserId: v.optional(v.string()),
    username: v.optional(v.string()),
    identityKeyHash: v.optional(v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_businessId_and_userId", [
      "organizationId",
      "businessId",
      "userId",
    ])
    .index("by_channelContactId_and_businessId", [
      "channelContactId",
      "businessId",
    ]),
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
    /** Keep the existing unread flag; new projections also count unread replies. */
    unreadCount: v.optional(v.number()),
    lastInboundAt: v.optional(v.number()),
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
    .index("by_accountId_and_channelContactId", [
      "accountId",
      "channelContactId",
    ])
    .index("by_channelContactId", ["channelContactId"])
    .index("by_contactId", ["contactId"]),
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
    automationRunId: v.optional(v.id("automationRuns")),
    replyToId: v.optional(v.id("channelMessages")),
    reactionTargetExternalId: v.optional(v.string()),
    observedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    tags: v.optional(v.array(tagValue)),
    source: v.optional(
      v.union(
        v.literal("api"),
        v.literal("dashboard"),
        v.literal("broadcast"),
        v.literal("automation"),
        v.literal("smtp"),
        v.literal("system")
      )
    ),
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
    errorTitle: v.optional(v.string()),
    /** Legacy search text, retained for existing documents. */
    search: v.optional(v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_channel", ["organizationId", "channel"])
    .index("by_team_channel_status_direction", [
      "organizationId",
      "channel",
      "status",
      "direction",
    ])
    .index("by_team_channel_direction", [
      "organizationId",
      "channel",
      "direction",
    ])
    .index("by_team_channel_account_status_direction", [
      "organizationId",
      "channel",
      "accountId",
      "status",
      "direction",
    ])
    .index("by_team_channel_account_direction", [
      "organizationId",
      "channel",
      "accountId",
      "direction",
    ])
    .index("by_conversationId", ["conversationId"])
    .index("by_channel_and_externalId", ["channel", "externalId"])
    .index("by_accountId_and_reactionTargetExternalId", [
      "accountId",
      "reactionTargetExternalId",
    ]),
  channelMediaUploads: defineTable({
    organizationId: v.string(),
    accountId: v.id("channelAccounts"),
    mediaId: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    filename: v.string(),
    size: v.number(),
    expiresAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_team_and_mediaId", ["organizationId", "mediaId"])
    .index("by_expiresAt", ["expiresAt"]),
  channelMessageContents: defineTable({
    messageId: v.id("channelMessages"),
    /** The channel's message object as JSON. */
    payload: v.string(),
    sendResponse: v.optional(v.string()),
    paymentState: v.optional(v.string()),
    statusState: v.optional(v.string()),
    /** What the customer received, independent of later template edits. */
    rendered: v.optional(renderedTemplateValue),
    /** A message carries at most a few files. */
    media: v.optional(v.array(channelMediaValue)),
  }).index("by_messageId", ["messageId"]),
  /** The message's timeline; status webhooks append to it. */
  channelMessageEvents: defineTable({
    messageId: v.id("channelMessages"),
    type: v.union(channelMessageStatusValue, v.literal("payment_updated")),
    at: v.number(),
    webhookEventId: v.optional(v.id("metaWebhookEvents")),
    /** Extra details as JSON, like Meta's error object. */
    details: v.optional(v.string()),
  }).index("by_messageId_and_at", ["messageId", "at"]),
}
