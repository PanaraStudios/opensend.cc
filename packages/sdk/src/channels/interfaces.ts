import type {
  PaginationOptions,
  PaginatedData,
} from "../common/interfaces/pagination-options.interface"
import type { PostOptions } from "../common/interfaces/post-option.interface"
import type { IdempotentRequest } from "../common/interfaces/idempotent-request.interface"
export const MESSAGING_CHANNELS = [
  "whatsapp",
  "messenger",
  "instagram",
] as const
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number]
export type PageChannel = Exclude<MessagingChannel, "whatsapp">
export type ChannelMessageStatus =
  "queued" | "sent" | "delivered" | "read" | "failed" | "received"
export type ChannelRequestOptions = PostOptions & IdempotentRequest
export type ChannelPage<T> = PaginatedData<T[]>
export type ListChannelMessagesOptions<FilterKey extends string = "accountId"> =
  PaginationOptions & {
    status?: ChannelMessageStatus
    direction?: "inbound" | "outbound"
  } & Partial<Record<FilterKey, string>>
export interface ChannelMessage<
  C extends MessagingChannel = MessagingChannel,
  T extends string = string,
> {
  id: string
  channel: C
  account_id: string
  conversation_id: string
  from: string
  to: string
  type: T
  status: ChannelMessageStatus
  direction: "inbound" | "outbound"
  external_id: string | null
  created_at: string
  text?: string
  media?: Record<string, unknown> | ChannelMessageEvents["media"]
  tags: { name: string; value: string }[]
  error?: { code: number | null; title: string | null; message: string }
}
export interface ChannelMessageEvents {
  last_event: ChannelMessageStatus
  events: {
    type: ChannelMessageStatus
    created_at: string
    details: unknown
  }[]
  media: {
    id: string | null
    content_type: string
    filename: string | null
    size: number | null
    download_url: string | null
    expires_at: string | null
    error: string | null
  }[]
}
export interface ChannelConversation<
  C extends MessagingChannel = MessagingChannel,
> {
  id: string
  channel: C
  account_id: string | null
  channel_contact_id: string | null
  contact_id: string | null
  status: "open" | "closed"
  last_message_at: string
  last_preview: string
  last_direction: "inbound" | "outbound"
  window_expires_at: string | null
  unread: boolean
}
/** Meta rejects the legacy Messenger tags since April 27, 2026. */
export type PageMessageTag = "HUMAN_AGENT"
export type PageAttachment = { type: "image" | "video" | "audio" | "file" } & (
  { url: string; id?: never } | { id: string; url?: never }
)
export type PageTemplate = (
  { id: string; alias?: never } | { alias: string; id?: never }
) & { variables?: Record<string, string | number> }
export type QuickReply = { title: string; payload: string }
export type PageMessageBody =
  | { text: string; attachment?: never; template?: never }
  | { attachment: PageAttachment; text?: never; template?: never }
  | { template: PageTemplate; text?: never; attachment?: never }
export type PageMessageOptions = {
  from?: string
  to: string
  replyTo?: string
  tags?: { name: string; value: string }[]
}
export interface PageAccount {
  id: string
  channel: PageChannel
  external_id: string
  name: string
  handle: string
  status: "pending" | "active" | "restricted" | "error" | "disconnected"
  page_id: string
  created_at: string
}
