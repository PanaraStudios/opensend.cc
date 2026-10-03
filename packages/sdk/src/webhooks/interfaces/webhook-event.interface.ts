import type { MessageEventBase, Message } from "../../messages"
import type { ContactNote } from "../../contacts/notes/interfaces"
import type {
  WhatsAppCall,
  CallPermission,
} from "../../whatsapp/calling/interfaces"
import type { WhatsAppMessage } from "../../whatsapp/interfaces"
export type WhatsAppCallEventType =
  `whatsapp.call.${"ringing" | "connected" | "completed" | "failed" | "missed" | "recording_ready" | "transcription_ready" | "bot_completed" | "transferred"}`
export type WebhookEvent = import("../../events/catalog").SystemEventName

interface BaseEmailEventData extends MessageEventBase {
  channel: "email"
  broadcast_id?: string
  created_at: string
  email_id: string
  message_id: string
  from: string
  to: string[]
  subject: string
  template_id?: string
  tags?: Record<string, string>
}

interface EmailBounce {
  message: string
  subType: string
  type: string
}

interface EmailClick {
  ipAddress: string
  link: string
  timestamp: string
  userAgent: string
}

interface EmailFailed {
  reason: string
}

interface EmailSuppressed {
  message: string
  type: string
}

interface ReceivedEmailAttachment {
  id: string
  filename: string | null
  content_type: string
  content_disposition: string | null
  content_id: string | null
}

interface ReceivedEmailEventData extends MessageEventBase {
  channel: "email"
  email_id: string
  created_at: string
  from: string
  to: string[]
  bcc: string[]
  cc: string[]
  received_for: string[]
  message_id: string
  subject: string
  attachments: ReceivedEmailAttachment[]
}

interface ContactEventData {
  id: string
  audience_id: string
  segment_ids: string[]
  created_at: string
  updated_at: string
  email: string
  first_name?: string | null
  last_name?: string | null
  unsubscribed: boolean
}

interface DomainRecord {
  record: string
  name: string
  type: string
  ttl: string
  status: string
  value: string
  priority?: number
}

interface DomainEventData {
  id: string
  name: string
  status: string
  created_at: string
  region: string
  records: DomainRecord[]
}

interface SuppressionEventData {
  id: string
  email: string
  origin: "bounce" | "complaint" | "manual"
  source_id: string | null
  created_at: string
}

export interface EmailSentEvent {
  type: "email.sent"
  created_at: string
  data: BaseEmailEventData
}

export interface EmailScheduledEvent {
  type: "email.scheduled"
  created_at: string
  data: BaseEmailEventData
}

export interface EmailDeliveredEvent {
  type: "email.delivered"
  created_at: string
  data: BaseEmailEventData
}

export interface EmailDeliveryDelayedEvent {
  type: "email.delivery_delayed"
  created_at: string
  data: BaseEmailEventData
}

export interface EmailComplainedEvent {
  type: "email.complained"
  created_at: string
  data: BaseEmailEventData
}

export interface EmailBouncedEvent {
  type: "email.bounced"
  created_at: string
  data: BaseEmailEventData & {
    bounce: EmailBounce
  }
}

export interface EmailOpenedEvent {
  type: "email.opened"
  created_at: string
  data: BaseEmailEventData
}

export interface EmailClickedEvent {
  type: "email.clicked"
  created_at: string
  data: BaseEmailEventData & {
    click: EmailClick
  }
}

export interface EmailReceivedEvent {
  type: "email.received"
  created_at: string
  data: ReceivedEmailEventData
}

export interface EmailFailedEvent {
  type: "email.failed"
  created_at: string
  data: BaseEmailEventData & {
    failed: EmailFailed
  }
}

export interface EmailSuppressedEvent {
  type: "email.suppressed"
  created_at: string
  data: BaseEmailEventData & {
    suppressed: EmailSuppressed
  }
}

export interface ContactCreatedEvent {
  type: "contact.created"
  created_at: string
  data: ContactEventData
}

export interface ContactUpdatedEvent {
  type: "contact.updated"
  created_at: string
  data: ContactEventData
}

export interface ContactDeletedEvent {
  type: "contact.deleted"
  created_at: string
  data: ContactEventData
}

export interface DomainCreatedEvent {
  type: "domain.created"
  created_at: string
  data: DomainEventData
}

export interface DomainUpdatedEvent {
  type: "domain.updated"
  created_at: string
  data: DomainEventData
}

export interface DomainDeletedEvent {
  type: "domain.deleted"
  created_at: string
  data: DomainEventData
}

export interface SuppressionAddedEvent {
  type: "suppression.added"
  created_at: string
  data: SuppressionEventData
}

export interface SuppressionRemovedEvent {
  type: "suppression.removed"
  created_at: string
  data: SuppressionEventData
}

export interface WhatsAppMessageEvent {
  type: `whatsapp.message.${"sent" | "delivered" | "read" | "played" | "failed" | "received" | "payment_updated"}`
  created_at: string
  data: WhatsAppMessage &
    MessageEventBase & {
      status_raw?: Record<string, unknown>
      biz_opaque_callback_data?: string
    }
}

export interface PageMessageEvent {
  type: `${"messenger" | "instagram"}.message.${"sent" | "delivered" | "read" | "failed" | "received"}`
  created_at: string
  data: Extract<Message, { channel: "messenger" | "instagram" }>
}

export interface MessageControlEvent {
  type: `${"whatsapp" | "messenger" | "instagram"}.message.${"read_receipt_sent" | "read_receipt_failed" | "typing_failed"}`
  created_at: string
  data: MessageEventBase & {
    id: string
    conversation_id: string
    read_receipt_sent_at?: string
    error?: string
  }
}
export interface WhatsAppCallEvent {
  type: WhatsAppCallEventType
  created_at: string
  data: WhatsAppCall
}
export interface WhatsAppCallPermissionEvent {
  type: "whatsapp.call.permission_updated"
  created_at: string
  data: Pick<CallPermission, "account_id" | "user_id" | "permission"> & {
    response_source: string | null
    context_id: string | null
  }
}
export interface CallDataCollectedEvent {
  type: "call.data_collected"
  created_at: string
  data: import("../../events/catalog").CallDataCollected
}
export type WebhookEventPayload =
  | CallDataCollectedEvent
  | MessageControlEvent
  | WhatsAppCallEvent
  | WhatsAppCallPermissionEvent
  | PageMessageEvent
  | WhatsAppMessageEvent
  | EmailSentEvent
  | EmailScheduledEvent
  | EmailDeliveredEvent
  | EmailDeliveryDelayedEvent
  | EmailComplainedEvent
  | EmailBouncedEvent
  | EmailOpenedEvent
  | EmailClickedEvent
  | EmailReceivedEvent
  | EmailFailedEvent
  | EmailSuppressedEvent
  | ContactCreatedEvent
  | ContactNoteCreatedEvent
  | ContactUpdatedEvent
  | ContactDeletedEvent
  | DomainCreatedEvent
  | DomainUpdatedEvent
  | DomainDeletedEvent
  | SuppressionAddedEvent
  | SuppressionRemovedEvent

export interface ContactNoteCreatedEvent {
  type: "contact.note_created"
  created_at: string
  data: ContactNote
}
