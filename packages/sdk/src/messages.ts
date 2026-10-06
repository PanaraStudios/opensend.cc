import type { Opensend } from "./resend"
import type { PostOptions } from "./common/interfaces/post-option.interface"

export type MessageChannel = "email" | "whatsapp" | "messenger" | "instagram"
export type MessageTemplate = (
  { id: string; alias?: never } | { alias: string; id?: never }
) & {
  variables?: Record<string, string | number>
}
export interface MessageMedia {
  type?: "image" | "video" | "audio" | "file"
  id?: string
  url?: string
  filename?: string
  content?: string
  path?: string
  content_type?: string
}
interface CommonSend {
  from?: string
  template?: MessageTemplate
  text?: string
  tags?: { name: string; value: string }[]
  media?: MessageMedia[]
}
export type SendMessageOptions =
  | (CommonSend & {
      channel: "email"
      to: string | string[]
      reply_to?: string | string[]
      subject?: string
      html?: string
    })
  | {
      [C in Exclude<MessageChannel, "email">]: CommonSend & {
        channel: C
        to: string
        reply_to?: string
        subject?: never
        html?: never
      }
    }[Exclude<MessageChannel, "email">]
export interface MessageEventBase {
  channel: MessageChannel
  to: string | string[]
  id: string
  object: "message"
  direction: "inbound" | "outbound"
  from: string
  status: string
  preview: string
  created_at: string
  contact_id: string | null
  conversation_id?: string
}
export type Message =
  | (MessageEventBase & {
      channel: "email"
      to: string[]
      subject: string
      html: string | null
      text: string | null
    })
  | {
      [C in Exclude<MessageChannel, "email">]: MessageEventBase & {
        channel: C
        to: string
        type: string
        conversation_id: string
      }
    }[Exclude<MessageChannel, "email">]
export interface ListMessagesOptions {
  limit?: number
  cursor?: string
  channel?: MessageChannel
  direction?: "inbound" | "outbound"
  status?: string
  contact_id?: string
  from?: string
  to?: string
  created_after?: string
  created_before?: string
}
export interface MessageList {
  object: "list"
  data: Message[]
  has_more: boolean
  next_cursor: string | null
}
export class Messages {
  constructor(private readonly resend: Opensend) {}
  send(payload: SendMessageOptions, options: PostOptions = {}) {
    return this.resend.post<{ id: string }>("/messages", payload, options)
  }
  /** Alias matching emails.create and the channel message clients. */
  create(payload: SendMessageOptions, options: PostOptions = {}) {
    return this.send(payload, options)
  }
  list(options: ListMessagesOptions = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value))
    return this.resend.get<MessageList>(
      "/messages" + (query.size ? `?${query}` : "")
    )
  }
  get(id: string) {
    return this.resend.get<Message>(`/messages/${encodeURIComponent(id)}`)
  }
}
