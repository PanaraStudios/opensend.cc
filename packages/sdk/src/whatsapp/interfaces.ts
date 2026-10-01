import type {
  ListChannelMessagesOptions,
  ChannelMessage,
  ChannelMessageEvents,
  ChannelConversation,
  ChannelMessageStatus,
  ChannelRequestOptions,
  ChannelPage,
} from "../channels/interfaces"
export type WhatsAppMessageType =
  | "text"
  | "template"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "interactive"
  | "reaction"
export type WhatsAppMessageStatus = ChannelMessageStatus
export type WhatsAppMediaReference =
  { id: string; link?: never } | { link: string; id?: never }
export type WhatsAppTemplateParameter =
  | { type: "text"; text: string; parameter_name?: string }
  | {
      type: "currency"
      currency: { fallback_value: string; code: string; amount_1000: number }
    }
  | { type: "date_time"; date_time: { fallback_value: string } }
  | ({ type: "image" } & { image: WhatsAppMediaReference })
  | ({ type: "video" } & { video: WhatsAppMediaReference })
  | ({ type: "document" } & {
      document: WhatsAppMediaReference & { filename?: string }
    })
  | { type: "payload"; payload: string }
  | { type: "action"; action: Record<string, unknown> }
export type WhatsAppTemplateComponent = {
  type: "header" | "body" | "button"
  parameters: WhatsAppTemplateParameter[]
  sub_type?: string
  index?: string
}
export type WhatsAppTemplate = {
  name: string
  language: string | { code: string }
} & (
  | { components?: WhatsAppTemplateComponent[]; variables?: never }
  | { variables?: Record<string, string | number>; components?: never }
)
export type WhatsAppInteractive =
  | {
      type: "button"
      body: { text: string }
      action: {
        buttons: { type: "reply"; reply: { id: string; title: string } }[]
      }
      header?:
        | { type: "text"; text: string }
        | { type: "image"; image: WhatsAppMediaReference }
        | { type: "video"; video: WhatsAppMediaReference }
        | { type: "document"; document: WhatsAppMediaReference }
      footer?: { text: string }
    }
  | {
      type: "list"
      body: { text: string }
      action: {
        button: string
        sections: {
          title?: string
          rows: { id: string; title: string; description?: string }[]
        }[]
      }
      header?: { type: "text"; text: string }
      footer?: { text: string }
    }
type Bodies = {
  text: string | { body: string; preview_url?: boolean }
  template: WhatsAppTemplate
  image: WhatsAppMediaReference & { caption?: string }
  video: WhatsAppMediaReference & { caption?: string }
  audio: WhatsAppMediaReference
  document: WhatsAppMediaReference & { caption?: string; filename?: string }
  sticker: WhatsAppMediaReference
  location: {
    latitude: number
    longitude: number
    name?: string
    address?: string
  }
  interactive: WhatsAppInteractive
  reaction: { message_id: string; emoji: string }
}
/** Exactly one message body; type may be inferred. Wire names match Meta. */
export type SendWhatsAppMessageOptions = {
  from?: string
  to: string
  replyTo?: string
  tags?: { name: string; value: string }[]
} & {
  [K in keyof Bodies]: { type?: K } & { [P in K]: Bodies[K] } & {
    [P in Exclude<keyof Bodies, K>]?: never
  }
}[keyof Bodies]
export type WhatsAppRequestOptions = ChannelRequestOptions
export type ListWhatsAppMessagesOptions =
  ListChannelMessagesOptions<"phoneNumberId">
export interface WhatsAppMessage extends ChannelMessage<
  "whatsapp",
  WhatsAppMessageType | "contacts" | "button" | "unsupported"
> {
  template?: WhatsAppTemplate
  location?: Bodies["location"]
  interactive?: WhatsAppInteractive
  reaction?: Bodies["reaction"]
  image?: Bodies["image"]
  video?: Bodies["video"]
  audio?: Bodies["audio"]
  document?: Bodies["document"]
  sticker?: Bodies["sticker"]
}
export interface WhatsAppMessageDetail
  extends Omit<WhatsAppMessage, "media">, ChannelMessageEvents {}
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
