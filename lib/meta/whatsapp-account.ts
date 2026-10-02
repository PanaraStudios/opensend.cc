import { object as record, array, string } from "./parse"
/* What Meta says about a WhatsApp Business Account's phone numbers and a
   business token, read into the shapes opensend.cc stores.
   https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/phone-number-management-api
   https://developers.facebook.com/docs/graph-api/reference/debug_token/ */

/** The phone number fields every number sync asks for. The messaging limit
    comes from `whatsapp_business_manager_messaging_limit` (Graph v24.0 and
    later), which replaces the deprecated `messaging_limit_tier`. */
export const PHONE_NUMBER_FIELDS = [
  "id",
  "display_phone_number",
  "verified_name",
  "quality_rating",
  "status",
  "code_verification_status",
  "platform_type",
  "throughput",
  "whatsapp_business_manager_messaging_limit",
].join(",")

/** Permissions a business token needs to manage and message a WABA. */
export const WHATSAPP_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const

/** One sync saves at most this many numbers per WABA; Meta allows a
    handful per account. */
export const NUMBER_LIMIT = 100

/** Meta's default Cloud API throughput, and the upgraded one. */
export const DEFAULT_THROUGHPUT_MPS = 80
export const HIGH_THROUGHPUT_MPS = 1000

export type PhoneNumberStatus = "pending" | "active" | "restricted" | "error"
export type PhoneNumberQuality = "green" | "yellow" | "red" | "unknown"

/** A phone number as channelAccounts stores it. */
export type PhoneNumber = {
  externalId: string
  displayName: string
  handle: string
  status: PhoneNumberStatus
  quality: PhoneNumberQuality
  throughputMps: number
  messagingLimit?: string
  /** Registered for Cloud API use (`platform_type` CLOUD_API). Undefined
      when Meta did not say. */
  registered?: boolean
}

const text = (value: unknown) => string(value).trim() || undefined

const RESTRICTED = new Set(["FLAGGED", "RESTRICTED", "RATE_LIMITED"])
const FAILED = new Set(["BANNED", "DELETED", "DISCONNECTED"])
const QUALITIES = new Set(["GREEN", "YELLOW", "RED"])

/** Reads one entry of `GET /{waba-id}/phone_numbers` or `GET /{phone-id}`.
    A number waits for registration until Meta reports it on Cloud API.
    Returns null for an entry without an id. */
export function readPhoneNumber(raw: unknown): PhoneNumber | null {
  const fields = record(raw)
  const externalId = text(fields.id)
  if (!externalId || !/^\d{1,32}$/.test(externalId)) return null
  const handle = text(fields.display_phone_number) ?? externalId
  const status = text(fields.status)?.toUpperCase()
  const platform = text(fields.platform_type)?.toUpperCase()
  const registered =
    platform === undefined ? undefined : platform === "CLOUD_API"
  const quality = text(fields.quality_rating)?.toUpperCase()
  const level = text(record(fields.throughput).level)?.toUpperCase()
  return {
    externalId,
    displayName: text(fields.verified_name) ?? handle,
    handle,
    status:
      status && FAILED.has(status)
        ? "error"
        : status && RESTRICTED.has(status)
          ? "restricted"
          : registered
            ? "active"
            : "pending",
    quality:
      quality && QUALITIES.has(quality)
        ? (quality.toLowerCase() as PhoneNumberQuality)
        : "unknown",
    throughputMps:
      level === "HIGH" ? HIGH_THROUGHPUT_MPS : DEFAULT_THROUGHPUT_MPS,
    messagingLimit: text(fields.whatsapp_business_manager_messaging_limit),
    registered,
  }
}

/** A number's registration time and status once `number` is saved over
    what was stored: Meta's `platform_type` wins when it says; otherwise a
    registration opensend.cc recorded (right after `/register`, before
    Meta's reads catch up) keeps the number active. */
export function registration(
  number: Pick<PhoneNumber, "status" | "registered">,
  registeredAt: number | undefined,
  now: number
): { registeredAt?: number; status: PhoneNumberStatus } {
  const at =
    number.registered === true
      ? (registeredAt ?? now)
      : number.registered === false
        ? undefined
        : registeredAt
  return {
    registeredAt: at,
    status:
      number.status === "pending" && at !== undefined
        ? "active"
        : number.status,
  }
}

/** The numbers in a `phone_numbers` page, skipping malformed entries. */
export function readPhoneNumbers(raw: unknown): PhoneNumber[] {
  return array(record(raw).data).flatMap(
    (entry) => readPhoneNumber(entry) ?? []
  )
}

export type TokenInfo = {
  appId?: string
  valid: boolean
  scopes: string[]
  /** Scope → the asset ids it is limited to; absent means every asset. */
  targets: Record<string, string[]>
  error?: string
}

/** Reads `GET /debug_token`'s `data`. */
export function readTokenInfo(raw: unknown): TokenInfo {
  const data = record(record(raw).data)
  const scopes = Array.isArray(data.scopes)
    ? data.scopes.flatMap((scope) => text(scope) ?? [])
    : []
  const targets: Record<string, string[]> = {}
  if (Array.isArray(data.granular_scopes))
    for (const entry of data.granular_scopes) {
      const scope = text(record(entry).scope)
      const ids = record(entry).target_ids
      if (scope && Array.isArray(ids))
        targets[scope] = ids.map((id) => String(id))
    }
  return {
    appId: data.app_id === undefined ? undefined : String(data.app_id),
    valid: data.is_valid === true,
    scopes,
    targets,
    error: text(record(data.error).message),
  }
}

/** Why a business token cannot run a WABA for this app, or null when it
    can: it must be valid, issued for the app, hold both WhatsApp
    permissions, and (when Meta limits them to assets) include the WABA. */
export function tokenProblem(
  info: TokenInfo,
  /** Without a WABA, only the token itself is checked. */
  expected: { appId: string; wabaId?: string }
): string | null {
  if (!info.valid)
    return info.error
      ? `Meta says the token is not valid: ${info.error}`
      : "Meta says the token is not valid"
  if (info.appId !== undefined && info.appId !== expected.appId)
    return "The token belongs to a different Meta app"
  const missing = WHATSAPP_SCOPES.filter(
    (scope) => !info.scopes.includes(scope)
  )
  if (missing.length)
    return `The token is missing the ${missing.join(" and ")} permission${missing.length > 1 ? "s" : ""}`
  for (const scope of WHATSAPP_SCOPES) {
    const ids = info.targets[scope]
    if (expected.wabaId !== undefined && ids && !ids.includes(expected.wabaId))
      return "The token has no access to this WhatsApp Business Account"
  }
  return null
}

/** The business a token manages, when Meta names exactly one. */
export function tokenBusinessId(info: TokenInfo): string | undefined {
  const ids = info.targets.business_management
  return ids?.length === 1 ? ids[0] : undefined
}

/** The WhatsApp Business Account fields opensend.cc projects. */
export const WHATSAPP_WEBHOOK_FIELDS = [
  "messages",
  "calls",
  "account_settings_update",
  "message_template_status_update",
  "template_category_update",
  "phone_number_quality_update",
  "account_update",
  "phone_number_name_update",
] as const
