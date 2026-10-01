import { array, object, string } from "./parse"

export const CALL_TERMINAL = new Set([
  "completed",
  "failed",
  "missed",
  "rejected",
])
export const CALL_PERMISSION_STATUSES = [
  "no_permission",
  "temporary",
  "permanent",
  "granted",
  "pending",
  "denied",
  "expired",
] as const
export const callTime = (value: unknown, fallback: number) => {
  const n = Number(value)
  return value !== undefined &&
    value !== null &&
    value !== "" &&
    Number.isFinite(n) &&
    n >= 0
    ? n * 1000
    : fallback
}
export function callWireStatus(raw: unknown) {
  return string(Array.isArray(raw) ? raw[0] : raw).toUpperCase()
}
export function validateSdp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 96 * 1024 ||
    !value.startsWith("v=0\r\n") ||
    /(^|[^\r])\n/.test(value)
  )
    throw new Error("Supply a complete RFC 8866 SDP with CRLF line endings.")
  const lines = value.split("\r\n")
  if (
    lines.filter((l) => l.startsWith("m=")).length !== 1 ||
    !lines.some((l) => l.startsWith("m=audio ")) ||
    !lines.some((l) => /^a=rtpmap:\d+ opus\/48000/i.test(l)) ||
    !lines.some((l) => l.startsWith("a=fingerprint:")) ||
    !lines.some((l) => l.startsWith("a=candidate:")) ||
    lines.includes("a=ice-lite") ||
    lines.some((l) => /^a=ice-options:.*\btrickle\b/i.test(l)) ||
    new Set(
      lines.filter((l) => l.startsWith("a=ssrc:")).map((l) => l.split(" ")[0])
    ).size > 1
  )
    throw new Error(
      "SDP needs one Opus audio m-line, a DTLS fingerprint, complete ICE candidates and one SSRC; trickle and ICE-lite are unsupported."
    )
  return value
}
export function callOptions(input: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const key of ["recording", "transcription"]) {
    if (input[key] === undefined) continue
    const value = object(input[key])
    if (!["ENABLED", "DISABLED"].includes(string(value.status)))
      throw new Error(`${key}.status must be ENABLED or DISABLED.`)
    if (
      value.status === "ENABLED" &&
      (!string(value.purpose).trim() ||
        string(value.purpose).length > 250 ||
        !string(value.announcement_language))
    )
      throw new Error(
        `${key} needs purpose (1–250 characters) and announcement_language.`
      )
    result[key] = {
      status: value.status,
      ...(value.status === "ENABLED"
        ? {
            purpose: value.purpose,
            announcement_language: value.announcement_language,
          }
        : {}),
    }
  }
  if (input.biz_opaque_callback_data !== undefined) {
    if (
      typeof input.biz_opaque_callback_data !== "string" ||
      input.biz_opaque_callback_data.length > 512
    )
      throw new Error(
        "biz_opaque_callback_data must contain at most 512 characters."
      )
    result.biz_opaque_callback_data = input.biz_opaque_callback_data
  }
  return result
}
export const CALLING_SETTING_FIELDS = [
  "status",
  "call_icon_visibility",
  "call_icons",
  "call_hours",
  "callback_permission_status",
  "audio",
  "voicemail",
] as const
/** Meta reads include SIP, DTLS and restriction metadata that cannot be written by this API. */
export const writableCallingSettings = (input: Record<string, unknown>) =>
  Object.fromEntries(
    CALLING_SETTING_FIELDS.filter((key) => input[key] !== undefined).map(
      (key) => [key, input[key]]
    )
  )
/** Preserve whole call_hours writes, including the intentional deletion of omitted holidays. */
export function validateCallingSettings(input: Record<string, unknown>) {
  const allowed = new Set<string>(CALLING_SETTING_FIELDS)
  for (const key of Object.keys(input))
    if (!allowed.has(key))
      throw new Error(
        `Unsupported calling setting: ${key}. SIP and non-DTLS signaling are unavailable.`
      )
  for (const key of ["status", "callback_permission_status"])
    if (
      input[key] !== undefined &&
      !["ENABLED", "DISABLED"].includes(string(input[key]))
    )
      throw new Error(`${key} must be ENABLED or DISABLED.`)
  if (
    input.call_icon_visibility !== undefined &&
    !["DEFAULT", "DISABLE_ALL"].includes(string(input.call_icon_visibility))
  )
    throw new Error("Invalid call icon visibility.")
  if (input.call_icons !== undefined) {
    const countries = object(input.call_icons).restrict_to_user_countries
    if (
      !Array.isArray(countries) ||
      !countries.every((c) => typeof c === "string" && /^[A-Z]{2}$/.test(c))
    )
      throw new Error("Country restrictions need ISO country codes.")
  }
  if (
    input.audio !== undefined &&
    (!Array.isArray(object(input.audio).additional_codecs) ||
      !array(object(input.audio).additional_codecs).every(
        (c) => c === "PCMA" || c === "PCMU"
      ))
  )
    throw new Error("Additional codecs must be PCMA or PCMU.")
  if (input.call_hours !== undefined) {
    const hours = object(input.call_hours)
    if (!["ENABLED", "DISABLED"].includes(string(hours.status)))
      throw new Error("Invalid call_hours status.")
    if (hours.status === "ENABLED") {
      try {
        new Intl.DateTimeFormat("en", {
          timeZone: string(hours.timezone_id),
        }).format()
      } catch {
        throw new Error("Invalid call_hours timezone_id.")
      }
      if (
        !string(hours.timezone_id) ||
        !Array.isArray(hours.weekly_operating_hours)
      )
        throw new Error(
          "Call hours require timezone_id and weekly_operating_hours."
        )
    }
    const counts = new Map<string, number>()
    for (const raw of array(hours.weekly_operating_hours)) {
      const h = object(raw),
        day = string(h.day_of_week)
      counts.set(day, (counts.get(day) ?? 0) + 1)
      if (
        ![
          "MONDAY",
          "TUESDAY",
          "WEDNESDAY",
          "THURSDAY",
          "FRIDAY",
          "SATURDAY",
          "SUNDAY",
        ].includes(day) ||
        counts.get(day)! > 2 ||
        !validTime(h.open_time) ||
        !validTime(h.close_time) ||
        string(h.open_time) >= string(h.close_time)
      )
        throw new Error(
          "Invalid weekly call hours (at most two intervals per day)."
        )
    }
    if (array(hours.holiday_schedule).length > 20)
      throw new Error("At most 20 holidays are allowed.")
    for (const raw of array(hours.holiday_schedule)) {
      const h = object(raw),
        date = string(h.date)
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        date < new Date().toISOString().slice(0, 10) ||
        !validTime(h.start_time) ||
        !validTime(h.end_time)
      )
        throw new Error("Invalid holiday schedule.")
    }
  }
  if (input.voicemail !== undefined) {
    const voicemail = object(input.voicemail),
      audio = object(object(voicemail.audio).default)
    if (!["ENABLED", "DISABLED"].includes(string(voicemail.status)))
      throw new Error("Invalid voicemail status.")
    if (
      voicemail.status === "ENABLED" &&
      (!Array.isArray(voicemail.triggers) ||
        !array(voicemail.triggers).every(
          (t) => t === "REJECT" || t === "TIMEOUT"
        ) ||
        !String(audio.announcement_media_id ?? "").match(/^\d+$/) ||
        typeof audio.timeout_seconds !== "number" ||
        audio.timeout_seconds < 0 ||
        audio.timeout_seconds > 30)
    )
      throw new Error(
        "Voicemail requires triggers, announcement_media_id and timeout_seconds (0–30)."
      )
  }
  return input
}
const validTime = (value: unknown) =>
  typeof value === "string" && /^(?:[01]\d|2[0-3])[0-5]\d$/.test(value)

export const CALL_ERRORS: Record<number, [string, string, number]> = {
  100: [
    "invalid_call_parameters",
    "Meta refused the call parameters or SDP.",
    422,
  ],
  131044: [
    "payment_required",
    "Add a payment method to the WhatsApp Business Account.",
    422,
  ],
  131055: ["sip_enabled", "Disable SIP before using Graph calling.", 422],
  138000: ["calling_disabled", "Enable calling for this phone number.", 422],
  138001: [
    "recipient_unavailable",
    "This recipient cannot receive calls.",
    422,
  ],
  138002: [
    "call_capacity",
    "The phone number has reached its concurrent call limit.",
    429,
  ],
  138003: ["call_conflict", "A call is already ongoing.", 409],
  138004: ["call_connection_failed", "Call connection failed.", 502],
  138005: ["call_rate_limit", "Meta's call rate limit was reached.", 429],
  138006: [
    "call_permission_required",
    "The recipient has not granted calling permission.",
    422,
  ],
  138007: ["call_timeout", "Call setup timed out.", 504],
  138009: [
    "permission_request_limit",
    "Meta's permission request limit was reached.",
    429,
  ],
  138012: [
    "recipient_call_limit",
    "The recipient's daily call limit was reached.",
    429,
  ],
  138013: [
    "calling_country_unavailable",
    "Business-initiated calling is unavailable for this number's country.",
    422,
  ],
  138014: [
    "calling_quality_restricted",
    "Meta restricted calling due to low quality.",
    422,
  ],
  138015: [
    "calling_messaging_limit",
    "The number needs a messaging limit of at least 2,000.",
    422,
  ],
  138017: [
    "permanent_permission_exists",
    "Permanent calling permission already exists.",
    409,
  ],
  138018: [
    "calls_subscription_required",
    "Subscribe the app to calls webhooks.",
    422,
  ],
  138019: [
    "call_setup_failed",
    "The WhatsApp client failed to set up the call.",
    502,
  ],
  138020: [
    "call_relay_failed",
    "The WhatsApp client could not connect to the media relay.",
    502,
  ],
  138021: [
    "call_media_receive_timeout",
    "The WhatsApp client received no call media.",
    504,
  ],
  138022: [
    "call_media_transmit_timeout",
    "The WhatsApp client stopped sending call media.",
    504,
  ],
  138023: [
    "call_media_missing",
    "The call ended without media connection signals.",
    502,
  ],
  131030: [
    "test_recipient_required",
    "Add the recipient to the test allow-list.",
    422,
  ],
  613: [
    "permission_check_limit",
    "Meta's permission check rate limit was reached.",
    429,
  ],
}
