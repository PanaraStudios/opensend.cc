import { SARVAM_PROMPT_VOICES, type IvrPromptVoice } from "./ivr-renderers"
import { webhookEndpointError } from "./dashboard/webhooks"

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
  promptVoice?: IvrPromptVoice
  businessHours?: IvrBusinessHours
}
export const IVR_LIMITS = {
  menus: 50,
  options: 12,
  steps: 100,
  audioBytes: 16 * 1024 * 1024,
  text: 2000,
} as const
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Expected an object")
  return v as Record<string, unknown>
}
const keys = (o: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(o).some((k) => !allowed.includes(k)))
    throw new Error("Unknown IVR field")
}
const str = (v: unknown, max = 256): string => {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    /[\0\r\n]/.test(v)
  )
    throw new Error("Invalid IVR string")
  return v
}
const identifier = (v: unknown) => {
  const s = str(v, 128)
  if (!/^[a-zA-Z0-9._:-]+$/.test(s)) throw new Error("Invalid menu id")
  return s
}
export function parseIvrPrompt(value: unknown): IvrPrompt {
  const p = obj(value)
  if (p.kind === "audio") {
    keys(p, ["kind", "fileId"])
    return { kind: "audio", fileId: str(p.fileId) }
  }
  if (p.kind === "tts") {
    keys(p, ["kind", "text", "voice"])
    if (
      typeof p.text !== "string" ||
      !p.text.trim() ||
      p.text.length > IVR_LIMITS.text ||
      /\0/.test(p.text)
    )
      throw new Error("Invalid TTS text")
    return {
      kind: "tts",
      text: p.text,
      ...(p.voice === undefined ? {} : { voice: str(p.voice, 128) }),
    }
  }
  throw new Error("Invalid prompt kind")
}
/** The same fixed action schema is used for saved definitions and webhook replies. */
export function parseIvrAction(value: unknown, allowWebhook = true): IvrAction {
  const a = obj(value)
  switch (a.kind) {
    case "agents":
    case "voicemail":
    case "hangup":
      keys(a, ["kind"])
      return { kind: a.kind }
    case "submenu":
      keys(a, ["kind", "menuId"])
      return { kind: a.kind, menuId: identifier(a.menuId) }
    case "bot":
      keys(a, ["kind", "botId"])
      return { kind: a.kind, botId: str(a.botId) }
    case "playAndHangup":
      keys(a, ["kind", "prompt"])
      return { kind: a.kind, prompt: parseIvrPrompt(a.prompt) }
    case "webhook": {
      if (!allowWebhook)
        throw new Error("Nested webhook decisions are not allowed")
      keys(a, ["kind", "url", "secretId"])
      const url = str(a.url, 2048),
        error = webhookEndpointError(url)
      if (error) throw new Error(error)
      return {
        kind: a.kind,
        url,
        ...(a.secretId === undefined ? {} : { secretId: str(a.secretId) }),
      }
    }
    default:
      throw new Error("Invalid action kind")
  }
}
const integer = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
) => {
  const v = value === undefined ? fallback : value
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new Error(`Expected integer ${min}–${max}`)
  return v
}
const time = (v: unknown) => {
  const t = str(v, 4)
  if (!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(t))
    throw new Error("Use HHmm for call hours")
  return t
}
function hours(value: unknown): IvrBusinessHours {
  const h = obj(value)
  keys(h, [
    "status",
    "timezone_id",
    "weekly_operating_hours",
    "holiday_schedule",
    "closedAction",
  ])
  if (h.status !== "ENABLED" && h.status !== "DISABLED")
    throw new Error("Invalid call-hours status")
  const timezone_id =
    h.timezone_id === undefined ? undefined : str(h.timezone_id)
  if (
    h.status === "ENABLED" &&
    (!timezone_id || !Array.isArray(h.weekly_operating_hours))
  )
    throw new Error("Enabled call hours need a timezone and weekly hours")
  if (timezone_id)
    new Intl.DateTimeFormat("en", { timeZone: timezone_id }).format()
  const counts = new Map<string, number>()
  const weekly_operating_hours =
    h.weekly_operating_hours === undefined
      ? undefined
      : (() => {
          if (
            !Array.isArray(h.weekly_operating_hours) ||
            h.weekly_operating_hours.length > 14
          )
            throw new Error("At most two intervals per day")
          return h.weekly_operating_hours.map((v) => {
            const r = obj(v)
            keys(r, ["day_of_week", "open_time", "close_time"])
            const day = str(r.day_of_week) as (typeof IVR_DAYS)[number],
              open_time = time(r.open_time),
              close_time = time(r.close_time)
            counts.set(day, (counts.get(day) ?? 0) + 1)
            if (
              !IVR_DAYS.includes(day) ||
              counts.get(day)! > 2 ||
              open_time >= close_time
            )
              throw new Error("Invalid weekly call hours")
            return { day_of_week: day, open_time, close_time }
          })
        })()
  const holiday_schedule =
    h.holiday_schedule === undefined
      ? undefined
      : (() => {
          if (
            !Array.isArray(h.holiday_schedule) ||
            h.holiday_schedule.length > 20
          )
            throw new Error("At most 20 holidays")
          return h.holiday_schedule.map((v) => {
            const r = obj(v)
            keys(r, ["date", "start_time", "end_time"])
            const date = str(r.date, 10),
              start_time = time(r.start_time),
              end_time = time(r.end_time)
            if (
              !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
              !Number.isFinite(Date.parse(date)) ||
              new Date(date).toISOString().slice(0, 10) !== date ||
              start_time > end_time
            )
              throw new Error("Invalid holiday schedule")
            return { date, start_time, end_time }
          })
        })()
  return {
    status: h.status,
    ...(timezone_id ? { timezone_id } : {}),
    ...(weekly_operating_hours ? { weekly_operating_hours } : {}),
    ...(holiday_schedule ? { holiday_schedule } : {}),
    closedAction: parseIvrAction(h.closedAction),
  }
}
export function menuActions(m: IvrMenu): IvrAction[] {
  return [...Object.values(m.options), m.noInputAction, m.failureAction]
}
export function ivrPrompts(d: IvrDefinition): IvrPrompt[] {
  const actions = [
    ...d.menus.flatMap(menuActions),
    ...(d.businessHours ? [d.businessHours.closedAction] : []),
  ]
  return [
    ...d.menus.flatMap((m) => [
      m.prompt,
      ...(m.invalidPrompt ? [m.invalidPrompt] : []),
    ]),
    ...actions.flatMap((a) => (a.kind === "playAndHangup" ? [a.prompt] : [])),
  ]
}
/** Pure, bounded validator shared by REST, Convex and the future editor. */
export function parseIvr(value: unknown): IvrDefinition {
  const d = obj(value)
  keys(d, [
    "name",
    "language",
    "entryMenuId",
    "menus",
    "businessHours",
    "promptVoice",
  ])
  if (
    !Array.isArray(d.menus) ||
    !d.menus.length ||
    d.menus.length > IVR_LIMITS.menus
  )
    throw new Error("Use 1–50 menus")
  const menus = d.menus.map((v) => {
    const m = obj(v)
    keys(m, [
      "id",
      "name",
      "prompt",
      "invalidPrompt",
      "timeoutSeconds",
      "retries",
      "maxDigits",
      "options",
      "noInputAction",
      "failureAction",
    ])
    const options = obj(m.options)
    if (
      Object.keys(options).length > IVR_LIMITS.options ||
      Object.keys(options).some((k) => !/^[0-9*#]$/.test(k))
    )
      throw new Error("Use unique DTMF keys 0–9, * or # (at most 12)")
    return {
      id: identifier(m.id),
      name: str(m.name),
      prompt: parseIvrPrompt(m.prompt),
      ...(m.invalidPrompt === undefined
        ? {}
        : { invalidPrompt: parseIvrPrompt(m.invalidPrompt) }),
      timeoutSeconds: integer(m.timeoutSeconds, 5, 1, 30),
      retries: integer(m.retries, 2, 0, 5),
      maxDigits: integer(m.maxDigits, 1, 1, 12),
      options: Object.fromEntries(
        Object.entries(options).map(([k, a]) => [k, parseIvrAction(a)])
      ),
      noInputAction: parseIvrAction(m.noInputAction),
      failureAction: parseIvrAction(m.failureAction),
    }
  })
  let promptVoice: IvrPromptVoice | undefined
  if (d.promptVoice !== undefined && d.promptVoice !== null) {
    const p = obj(d.promptVoice)
    keys(p, ["provider", "voice", "language", "credentialId"])
    if (p.provider !== "sarvam" && p.provider !== "elevenlabs")
      throw new Error("Choose ElevenLabs or Sarvam for IVR prompts")
    const voice = str(p.voice, 128),
      language = str(p.language, 64),
      credentialId = str(p.credentialId)
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language))
      throw new Error("Invalid prompt language")
    if (
      p.provider === "sarvam" &&
      (!SARVAM_PROMPT_VOICES.includes(
        voice as (typeof SARVAM_PROMPT_VOICES)[number]
      ) ||
        ![
          "en-IN",
          "hi-IN",
          "bn-IN",
          "ta-IN",
          "te-IN",
          "kn-IN",
          "ml-IN",
          "mr-IN",
          "gu-IN",
          "pa-IN",
          "od-IN",
        ].includes(language))
    )
      throw new Error("Unsupported Sarvam prompt voice/language")
    promptVoice = { provider: p.provider, voice, language, credentialId }
  }
  const result = {
    name: str(d.name),
    language: str(d.language, 64),
    entryMenuId: identifier(d.entryMenuId),
    menus,
    ...(promptVoice ? { promptVoice } : {}),
    ...(d.businessHours === undefined || d.businessHours === null
      ? {}
      : { businessHours: hours(d.businessHours) }),
  }
  if (JSON.stringify(result).length > 240_000)
    throw new Error("IVR definition exceeds 240 KB")
  const ids = new Map(menus.map((m) => [m.id, m]))
  if (ids.size !== menus.length) throw new Error("Menu ids must be unique")
  if (!ids.has(result.entryMenuId)) throw new Error("Entry menu is missing")
  const actions = [
    ...menus.flatMap(menuActions),
    ...(result.businessHours ? [result.businessHours.closedAction] : []),
  ]
  for (const a of actions)
    if (a.kind === "submenu" && !ids.has(a.menuId))
      throw new Error(`Dangling menu: ${a.menuId}`)
  const reachable = new Set<string>()
  const visit = (id: string) => {
    if (reachable.has(id)) return
    reachable.add(id)
    for (const a of menuActions(ids.get(id)!))
      if (a.kind === "submenu") visit(a.menuId)
  }
  visit(result.entryMenuId)
  if (result.businessHours?.closedAction.kind === "submenu")
    visit(result.businessHours.closedAction.menuId)
  if (reachable.size !== menus.length)
    throw new Error("All menus must be reachable")
  const done = new Set<string>(),
    active = new Set<string>()
  const automatic = (id: string) => {
    if (active.has(id)) throw new Error("Menu cycle without input")
    if (done.has(id)) return
    active.add(id)
    const m = ids.get(id)!
    for (const a of [m.noInputAction, m.failureAction])
      if (a.kind === "submenu") automatic(a.menuId)
    active.delete(id)
    done.add(id)
  }
  for (const m of menus) automatic(m.id)
  return result
}
export function validateIvr(value: unknown): {
  valid: boolean
  errors: string[]
} {
  try {
    parseIvr(value)
    return { valid: true, errors: [] }
  } catch (e) {
    return {
      valid: false,
      errors: [e instanceof Error ? e.message : "Invalid IVR"],
    }
  }
}
export function isIvrOpen(
  h: IvrBusinessHours | undefined,
  at: number
): boolean {
  if (!h || h.status === "DISABLED") return true
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: h.timezone_id,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  )
  const date = `${parts.year}-${parts.month}-${parts.day}`,
    t = `${parts.hour}${parts.minute}`
  const holiday = h.holiday_schedule?.filter((r) => r.date === date)
  if (holiday?.length)
    return holiday.some((r) => r.start_time <= t && t < r.end_time)
  return !!h.weekly_operating_hours?.some(
    (r) =>
      r.day_of_week === parts.weekday.toUpperCase() &&
      r.open_time <= t &&
      t < r.close_time
  )
}
