/** ElevenLabs voice catalog fetched from GET /v2/voices.
 * https://elevenlabs.io/docs/api-reference/voices/search
 * The API key is never stored in a mapped voice or an error string. */
export const ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v2/voices"
export const ELEVENLABS_VOICE_PAGE_SIZE = 100
export const ELEVENLABS_VOICE_MAX_PAGES = 5
export const ELEVENLABS_VOICE_CACHE_MS = 60 * 60 * 1000
/** Sarah. Used when the live catalog has no female premade voice. */
export const ELEVENLABS_FALLBACK_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"
export const PROVIDER_ERROR_LIMIT = 200

export const ELEVENLABS_VOICE_CATEGORIES = [
  "premade",
  "cloned",
  "professional",
  "generated",
  "famous",
  "high_quality",
  "unknown",
] as const
export type ElevenLabsVoiceCategory =
  (typeof ELEVENLABS_VOICE_CATEGORIES)[number]
export type ElevenLabsVoiceGender = "female" | "male" | "unknown"
export type ElevenLabsVoice = {
  value: string
  label: string
  gender: ElevenLabsVoiceGender
  accent?: string
  language?: string
  description?: string
  category: ElevenLabsVoiceCategory
}
export class ProviderVoiceError extends Error {
  constructor(
    message: string,
    readonly retryable = false
  ) {
    super(message)
    this.name = "ProviderVoiceError"
  }
}

const CATEGORIES = new Set<string>(ELEVENLABS_VOICE_CATEGORIES)
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function clip(value: unknown, max: number) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (!trimmed) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}
export function mapElevenLabsVoice(raw: unknown): ElevenLabsVoice | null {
  const voice = record(raw)
  const id = clip(voice?.voice_id, 128)
  if (!voice || !id || /\s/.test(id)) return null
  const labels = record(voice.labels) ?? {}
  const genderRaw = clip(labels.gender, 32)?.toLowerCase()
  const gender: ElevenLabsVoiceGender =
    genderRaw === "female" || genderRaw === "male" ? genderRaw : "unknown"
  const categoryRaw = clip(voice.category, 32) ?? "unknown"
  const category = (
    CATEGORIES.has(categoryRaw) ? categoryRaw : "unknown"
  ) as ElevenLabsVoiceCategory
  return {
    value: id,
    label: clip(voice.name, 80) ?? "Unnamed voice",
    gender,
    accent: clip(labels.accent, 40),
    language: clip(labels.language, 40) ?? clip(labels.locale, 40),
    description: clip(voice.description, 80) ?? clip(labels.description, 80),
    category,
  }
}
export function mapElevenLabsVoicesPage(body: unknown) {
  const root = record(body)
  if (!root || !Array.isArray(root.voices))
    throw new ProviderVoiceError(
      "ElevenLabs: voice list response was not valid"
    )
  const voices = root.voices.flatMap((voice) => {
    const mapped = mapElevenLabsVoice(voice)
    return mapped ? [mapped] : []
  })
  const nextPageToken = clip(root.next_page_token, 512)
  return {
    voices,
    hasMore: root.has_more === true && !!nextPageToken,
    nextPageToken,
  }
}
export function elevenLabsVoiceDetail(voice: {
  gender: string
  accent?: string
  language?: string
  description?: string
  category: string
}) {
  const gender =
    voice.gender === "female"
      ? "Female"
      : voice.gender === "male"
        ? "Male"
        : "Unknown"
  const category =
    voice.category === "high_quality"
      ? "High quality"
      : voice.category === "unknown"
        ? "Other"
        : voice.category.charAt(0).toUpperCase() + voice.category.slice(1)
  return [gender, voice.accent, voice.language ?? voice.description, category]
    .filter((part) => !!part)
    .join(" · ")
}
export function defaultElevenLabsVoice(
  voices: readonly { value: string; gender: string; category: string }[]
) {
  return (
    voices.find(
      (voice) => voice.gender === "female" && voice.category === "premade"
    )?.value ?? ELEVENLABS_FALLBACK_VOICE_ID
  )
}
export function voiceCacheFresh(
  refreshedAt: number | undefined,
  now: number,
  ttl = ELEVENLABS_VOICE_CACHE_MS
) {
  return (
    typeof refreshedAt === "number" &&
    now >= refreshedAt &&
    now - refreshedAt < ttl
  )
}

const SECRET_PATTERN =
  /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{8,}\b|Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g
export function redactSecrets(text: string, secrets: readonly string[] = []) {
  let out = text
  for (const secret of secrets) {
    if (secret.length < 4) continue
    out = out.split(secret).join("[redacted]")
  }
  return out
    .replace(SECRET_PATTERN, "[redacted]")
    .replace(LONG_TOKEN, "[redacted]")
}
export function truncateProviderError(text: string) {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= PROVIDER_ERROR_LIMIT) return clean
  return clean.slice(0, PROVIDER_ERROR_LIMIT - 1).trimEnd() + "…"
}
export function extractProviderError(body: unknown) {
  const root = record(body)
  if (!root)
    return { code: "", message: typeof body === "string" ? body.trim() : "" }
  const detail = root.detail
  const detailRecord = record(detail)
  if (detailRecord)
    return {
      code:
        clip(detailRecord.status, 80) ??
        clip(detailRecord.code, 80) ??
        clip(detailRecord.type, 80) ??
        "",
      message:
        clip(detailRecord.message, 500) ?? clip(detailRecord.msg, 500) ?? "",
    }
  if (Array.isArray(detail)) {
    const first = record(detail[0])
    return {
      code: clip(first?.type, 80) ?? "",
      message: clip(first?.msg, 500) ?? clip(first?.message, 500) ?? "",
    }
  }
  if (typeof detail === "string") return { code: "", message: detail.trim() }
  const error = record(root.error)
  if (error)
    return {
      code:
        clip(error.code, 80) ??
        clip(error.status, 80) ??
        clip(error.type, 80) ??
        "",
      message: clip(error.message, 500) ?? clip(error.msg, 500) ?? "",
    }
  if (typeof root.error === "string")
    return { code: "", message: root.error.trim() }
  return {
    code:
      clip(root.code, 80) ?? clip(root.status, 80) ?? clip(root.type, 80) ?? "",
    message: clip(root.message, 500) ?? clip(root.msg, 500) ?? "",
  }
}
export function formatProviderError(
  provider: "ElevenLabs" | "Sarvam",
  status: number,
  body: string,
  secrets: readonly string[] = []
) {
  let code = ""
  let message = ""
  const trimmed = body.trim()
  if (trimmed)
    try {
      const extracted = extractProviderError(JSON.parse(trimmed) as unknown)
      code = extracted.code
      message = extracted.message
    } catch {
      message = trimmed
    }
  if (!message && !code) message = `request failed (${status})`
  const text =
    code && message && code !== message
      ? `${provider}: ${code} — ${message}`
      : `${provider}: ${message || code}`
  return truncateProviderError(redactSecrets(text, secrets))
}

export async function fetchElevenLabsVoices(
  request: typeof fetch,
  apiKey: string,
  options: { pageSize?: number; maxPages?: number } = {}
) {
  const pageSize = options.pageSize ?? ELEVENLABS_VOICE_PAGE_SIZE
  const maxPages = options.maxPages ?? ELEVENLABS_VOICE_MAX_PAGES
  const voices: ElevenLabsVoice[] = []
  const seen = new Set<string>()
  let token: string | undefined
  let hasMore = false
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(ELEVENLABS_VOICES_URL)
    url.searchParams.set("page_size", String(pageSize))
    url.searchParams.set("include_total_count", "false")
    if (token) url.searchParams.set("next_page_token", token)
    const response = await request(url, {
      method: "GET",
      headers: { "xi-api-key": apiKey, accept: "application/json" },
    })
    const body = await response.text()
    if (!response.ok)
      throw new ProviderVoiceError(
        formatProviderError("ElevenLabs", response.status, body, [apiKey]),
        response.status === 429 || response.status >= 500
      )
    const parsed = mapElevenLabsVoicesPage(JSON.parse(body) as unknown)
    for (const voice of parsed.voices)
      if (!voices.some((item) => item.value === voice.value)) voices.push(voice)
    if (!parsed.hasMore || !parsed.nextPageToken) {
      hasMore = false
      break
    }
    if (seen.has(parsed.nextPageToken)) {
      hasMore = false
      break
    }
    seen.add(parsed.nextPageToken)
    token = parsed.nextPageToken
    hasMore = true
  }
  return { voices, hasMore }
}

export async function loadElevenLabsVoiceCatalog(input: {
  request: typeof fetch
  apiKey: string
  now: number
  force?: boolean
  cache?: { refreshedAt: number; voices: ElevenLabsVoice[]; hasMore?: boolean }
}) {
  if (
    !input.force &&
    input.cache &&
    voiceCacheFresh(input.cache.refreshedAt, input.now)
  )
    return {
      voices: input.cache.voices,
      refreshedAt: input.cache.refreshedAt,
      hasMore: input.cache.hasMore ?? false,
      fromCache: true,
    }
  const fetched = await fetchElevenLabsVoices(input.request, input.apiKey)
  return { ...fetched, refreshedAt: input.now, fromCache: false }
}
