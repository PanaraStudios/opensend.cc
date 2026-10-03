import type { CallingRouting } from "./routing"
import type { IvrPathEntry, IvrAction } from "../../ivrs/interfaces"
import type { BotOutcome, VoiceUsage } from "../../voice/interfaces"
import type { PaginationOptions } from "../../common/interfaces/pagination-options.interface"
import type { WhatsAppTemplate } from "../catalog"
export type CallHandlingMode = "gateway" | "api"
export type WhatsAppCallStatus =
  | "queued"
  | "ringing"
  | "connected"
  | "completed"
  | "failed"
  | "missed"
  | "rejected"
export interface CallSession {
  sdp_type: "offer" | "answer"
  sdp: string
}
export type CallOptIn =
  | { status: "DISABLED" }
  | { status: "ENABLED"; purpose: string; announcement_language: string }
export interface CallOptions {
  recording?: CallOptIn
  transcription?: CallOptIn
  biz_opaque_callback_data?: string
}
export type ConnectWhatsAppCall = CallOptions & { from?: string } & (
    { recipient: string; to?: string } | { to: string; recipient?: string }
  ) &
  (
    | { route?: "gateway"; session?: never }
    | { route?: "api"; session: CallSession & { sdp_type: "offer" } }
  )
export interface AcceptWhatsAppCall extends CallOptions {
  session?: CallSession & { sdp_type: "answer" }
}
export interface CallFile {
  fileId?: string
  storageId?: string
  mediaId?: string
  sha256?: string
  contentType?: string
  error?: string
  download_url: string | null
}
export interface WhatsAppCall {
  object: "whatsapp_call"
  /** Playground calls never signal Meta or emit customer lifecycle webhooks. */
  test?: boolean
  id: string
  account_id: string
  wacid: string | null
  direction: "inbound" | "outbound"
  status: WhatsAppCallStatus
  handling_mode: CallHandlingMode
  user_id: string | null
  from: string | null
  to: string | null
  contact_id: string | null
  contact_name: string
  contact_phone: string | null
  conversation_id: string | null
  created_at: string
  observed_at: number
  connected_at: number | null
  ended_at: number | null
  duration: number | null
  biz_opaque_callback_data: string | null
  cta_payload: string | null
  deeplink_payload: string | null
  session: CallSession | null
  recording: CallFile | null
  transcription: CallFile | null
  outcome?: "answered" | "no_answer" | "rejected" | "failed" | null
  attempt?: number
  purpose?: string | null
  route?: string | null
  error: string | null
  error_code: number | null
  assigned_agent: string | null
  ivr_id: string | null
  ivr_path: IvrPathEntry[]
  ivr_outcome: IvrAction | null
  bot_name?: string | null
  bot_id: string | null
  bot_outcome: BotOutcome | null
  collected?: import("../../voice/toolkit-types").CollectedData | null
  bot_summary: string | null
  bot_duration: number | null
  bot_usage: VoiceUsage | null
  bot_fallback_reason: string | null
}
export interface WhatsAppCallDetail extends WhatsAppCall {
  events: { event: string; at: number; details: Record<string, unknown> }[]
}
export type ListWhatsAppCalls = PaginationOptions & { phoneNumberId?: string }
export interface CallingSettings {
  status?: "ENABLED" | "DISABLED"
  call_icon_visibility?: "DEFAULT" | "DISABLE_ALL"
  call_icons?: { restrict_to_user_countries: string[] }
  callback_permission_status?: "ENABLED" | "DISABLED"
  audio?: { additional_codecs: ("PCMA" | "PCMU")[] }
  call_hours?: {
    status: "ENABLED" | "DISABLED"
    timezone_id?: string
    weekly_operating_hours?: {
      day_of_week:
        | "MONDAY"
        | "TUESDAY"
        | "WEDNESDAY"
        | "THURSDAY"
        | "FRIDAY"
        | "SATURDAY"
        | "SUNDAY"
      open_time: string
      close_time: string
    }[]
    holiday_schedule?: { date: string; start_time: string; end_time: string }[]
  }
  voicemail?: {
    status: "ENABLED" | "DISABLED"
    triggers?: ("REJECT" | "TIMEOUT")[]
    audio?: {
      default: {
        announcement_media_id?: string | number
        timeout_seconds: number
      }
    }
  }
}
export interface UpdateCallingSettings {
  routing?: CallingRouting
  calling?: CallingSettings
  handling_mode?: CallHandlingMode
  announcement_file_id?: string
}
export interface PhoneNumberCalling {
  routing: CallingRouting | null
  account_id: string
  handling_mode: CallHandlingMode
  calling: CallingSettings & {
    restrictions?: Record<string, unknown>
    sip?: { status: string }
    srtp_key_exchange_protocol?: string
  }
}
export interface CallPermissionQuery {
  from?: string
  to?: string
  recipient?: string
}
export interface CallPermission {
  account_id: string
  user_id: string
  messaging_product?: "whatsapp"
  permission: {
    status:
      | "no_permission"
      | "temporary"
      | "permanent"
      | "granted"
      | "pending"
      | "denied"
      | "expired"
    expiration_time?: number
    expiration?: number
  }
  actions?: {
    action_name: "start_call" | "send_call_permission_request"
    can_perform_action: boolean
    limits?: {
      time_period: string
      max_allowed: number
      current_usage: number
      limit_expiration_time?: number
    }[]
  }[]
}
export type RequestCallPermission = CallPermissionQuery &
  (
    | { text: string; template?: never }
    | { template: WhatsAppTemplate; text?: never }
  )

export type PlaceWhatsAppCall = {
  from: string
  route: `bot:${string}` | `ivr:${string}`
  context?: string
  variables?: Record<string, string>
  request_permission?: boolean
  permission_text?: string
  permission_template?: WhatsAppTemplate
} & (
  | { to: string; recipient?: string; contact_id?: string }
  | { contact_id: string; to?: string; recipient?: string }
  | { recipient: string; to?: string; contact_id?: string }
)
export interface PlaceWhatsAppCallResult {
  status:
    | "queued"
    | "ringing"
    | "permission_required"
    | "permission_requested"
    | "calling_limited"
  id?: string
  permission_request_id?: string
  permission?: CallPermission
}
