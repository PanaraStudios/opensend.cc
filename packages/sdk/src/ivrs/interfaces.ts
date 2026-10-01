export type IvrPrompt =
  | { kind: "audio"; fileId: string }
  | { kind: "tts"; text: string; voice?: string }
export type IvrAction =
  | { kind: "submenu"; menuId: string }
  | { kind: "agents" }
  | { kind: "bot"; botId: string }
  | { kind: "voicemail" }
  | { kind: "playAndHangup"; prompt: IvrPrompt }
  | { kind: "webhook"; url: string; secretId?: string }
  | { kind: "hangup" }
export const IVR_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const
export interface IvrBusinessHours {
  status: "ENABLED" | "DISABLED"
  timezone_id?: string
  weekly_operating_hours?: {
    day_of_week: (typeof IVR_DAYS)[number]
    open_time: string
    close_time: string
  }[]
  holiday_schedule?: { date: string; start_time: string; end_time: string }[]
  closedAction: IvrAction
}
export interface IvrMenu {
  id: string
  name: string
  prompt: IvrPrompt
  invalidPrompt?: IvrPrompt
  timeoutSeconds: number
  retries: number
  maxDigits: number
  options: Record<string, IvrAction>
  noInputAction: IvrAction
  failureAction: IvrAction
}
export interface IvrDefinition {
  name: string
  language: string
  entryMenuId: string
  menus: IvrMenu[]
  promptVoice?: {
    provider: "elevenlabs" | "sarvam"
    voice: string
    language: string
    credentialId: string
  }
  businessHours?: IvrBusinessHours
}
export interface Ivr extends IvrDefinition {
  object: "ivr"
  id: string
  created_at: string
  updated_at: string
  webhook_signing_secret: string
  prompt_status: "ready" | "pending_render" | "failed"
  prompt_renders?: {
    kind: "audio" | "tts"
    status: "ready" | "pending_render" | "rendering" | "failed"
    fileId?: string
    hash?: string
    voice?: string | null
    text?: string
    error?: string | null
    audio_url: string | null
  }[]
}
export interface IvrPathEntry {
  menuId: string
  digits: string
  action: IvrAction
  at: number
}
export type { CallingRouting } from "../whatsapp/calling/routing"
