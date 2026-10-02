import type {
  ListChannelMessagesOptions,
  ChannelMessage,
  ChannelMessageEvents,
  ChannelConversation,
  ChannelMessageStatus,
  ChannelRequestOptions,
  ChannelPage,
} from "../channels/interfaces"
import type {
  WhatsAppSendBodies as Bodies,
  WhatsAppTemplate,
  WhatsAppInteractive,
  WhatsAppNormalized,
} from "./catalog"
export * from "./catalog"
export type WhatsAppMessageType = WhatsAppNormalized["type"]
export type WhatsAppMessageStatus = ChannelMessageStatus
/** Exactly one message body; type may be inferred. Wire names match Meta. */
export type SendWhatsAppMessageOptions = {
  from?: string
  context?: { message_id: string }
  biz_opaque_callback_data?: string
  replyTo?: string
  tags?: { name: string; value: string }[]
} & ({ to: string; recipient?: string } | { recipient: string; to?: string }) &
  {
    [K in keyof Bodies]: { type?: K } & { [P in K]: Bodies[K] } & {
      [P in Exclude<keyof Bodies, K>]?: never
    }
  }[keyof Bodies]
export type WhatsAppRequestOptions = ChannelRequestOptions
export type ListWhatsAppMessagesOptions =
  ListChannelMessagesOptions<"phoneNumberId">
type LegacyWhatsAppMessage = ChannelMessage<
  "whatsapp",
  WhatsAppNormalized["type"]
> & {
  template?: WhatsAppTemplate
  location?: Bodies["location"]
  interactive?: WhatsAppInteractive
  reaction?: { message_id: string; emoji?: string }
  image?: Bodies["image"]
  video?: Bodies["video"]
  audio?: Bodies["audio"]
  document?: Bodies["document"]
  sticker?: Bodies["sticker"]
}
export type WhatsAppMessage = LegacyWhatsAppMessage &
  WhatsAppNormalized & {
    rendered?: {
      header?: {
        format: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION"
        text?: string
      }
      body: string
      footer?: string
      buttons: { type: string; text: string }[]
    }
    payment?: Record<string, unknown> & { type: "payment"; status?: string }
    send_response?: {
      contacts?: { input?: string; wa_id?: string; user_id?: string }[]
      messages: { id: string; message_status?: string }[]
    }
    reactions?: {
      id: string
      external_id: string | null
      from: string
      emoji: string
      created_at: string
    }[]
    revoked_at?: string
    reaction_target_id?: string | null
    attachments?: ChannelMessageEvents["media"]
  }
export type WhatsAppMessageDetail<M = WhatsAppMessage> =
  M extends WhatsAppMessage ? Omit<M, "media"> & ChannelMessageEvents : never
export interface WhatsAppPhoneNumber {
  id: string
  phone_number_id: string
  display_phone_number: string
  verified_name: string
  status: "pending" | "active" | "restricted" | "error" | "disconnected"
  quality: "green" | "yellow" | "red" | "unknown"
  throughput: number
  messaging_limit: string | null
  waba_id: string | null
  created_at: string
}
export type WhatsAppConversation = ChannelConversation<"whatsapp">
export type UploadWhatsAppMediaOptions = {
  file: Blob
  filename?: string
  from?: string
  type?: string
}
export type WhatsAppPage<T> = ChannelPage<T>
