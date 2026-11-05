/* Validators the schema and the apps share. The schema (convex/tables)
   uses them for its fields; lib/ derives its types from them. */
import { v } from "convex/values"
import {
  CHANNEL_IDS,
  CHANNEL_MESSAGE_STATUSES,
  PAGE_CHANNELS,
  MESSAGING_CHANNELS as messagingChannels,
} from "../channels"

export const literals = <T extends string>(values: readonly T[]) =>
  v.union(...values.map((value) => v.literal(value)))

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
