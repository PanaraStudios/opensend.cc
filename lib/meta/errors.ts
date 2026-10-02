/* Graph API errors, as Meta documents them:
   https://developers.facebook.com/docs/graph-api/guides/error-handling
   https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes */

export type GraphErrorInfo = {
  /** The HTTP status of the response. */
  status: number
  code?: number
  subcode?: number
  isTransient: boolean
  message: string
  title?: string
  userMessage?: string
  details?: string
  fbtraceId?: string
}

/** What a caller does with a failed call:
    - `retry`: try again with backoff;
    - `retry_after`: try again only after a longer pause (131056, too many
      messages to one person);
    - `final`: give up and record the error;
    - `token_invalid`: give up and flag the connection for reconnecting. */
export type GraphErrorAction =
  "retry" | "retry_after" | "final" | "token_invalid"

/** Throttling, temporary outages and "something went wrong". */
const RETRY_CODES = new Set([1, 2, 4, 80007, 130429, 131000])
/** 131047: the 24-hour window closed. 131026: undeliverable. 131050: the
    person stopped marketing messages. 100: invalid parameter. 368:
    blocked for policy. The 132xxx family covers template errors. */
const FINAL_CODES = new Set([
  10, 100, 368, 551, 2018278, 131026, 131047, 131050,
])
const TOKEN_INVALID = 190
const PAIR_RATE_LIMIT = 131056

const isTemplateError = (code: number) => code >= 132000 && code < 133000

export function classifyGraphError(
  error: Pick<GraphErrorInfo, "status" | "code" | "subcode" | "isTransient">
): GraphErrorAction {
  const { code } = error
  if (code === TOKEN_INVALID) return "token_invalid"
  if (code === PAIR_RATE_LIMIT) return "retry_after"
  if (error.subcode === 2018278) return "final"
  if (code !== undefined && (FINAL_CODES.has(code) || isTemplateError(code)))
    return "final"
  if (code !== undefined && RETRY_CODES.has(code)) return "retry"
  if (error.isTransient || error.status >= 500) return "retry"
  return "final"
}

/** A failed Graph API call. */
export class MetaError extends Error {
  readonly status: number
  readonly code?: number
  readonly subcode?: number
  readonly isTransient: boolean
  readonly title?: string
  readonly userMessage?: string
  readonly details?: string
  readonly fbtraceId?: string
  constructor(info: GraphErrorInfo) {
    super(info.message)
    this.name = "MetaError"
    this.status = info.status
    this.code = info.code
    this.subcode = info.subcode
    this.isTransient = info.isTransient
    this.title = info.title
    this.userMessage = info.userMessage
    this.details = info.details
    this.fbtraceId = info.fbtraceId
  }
  get action() {
    return classifyGraphError(this)
  }
}

/** Only the documented reason fields, never the raw response or request. */
export function metaErrorReason(error: MetaError): string {
  return [
    ...new Set([error.title, error.userMessage, error.details, error.message]),
  ]
    .filter(Boolean)
    .join(" — ")
}

const numberOr = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined
const stringOr = (value: unknown) =>
  typeof value === "string" && value ? value : undefined

/** Reads Graph's `{ error: { message, code, error_subcode, is_transient,
    fbtrace_id } }` body; a body that is not one still yields an error. */
export function parseGraphError(
  status: number,
  body: string,
  secrets: readonly string[] = []
): GraphErrorInfo {
  let error: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(body)
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      parsed.error &&
      typeof parsed.error === "object"
    )
      error = parsed.error as Record<string, unknown>
  } catch {}
  const safeString = (value: unknown) => {
    let result = stringOr(value)
    for (const secret of secrets) {
      if (!secret || !result) continue
      result = result
        .replaceAll(secret, "[REDACTED]")
        .replaceAll(encodeURIComponent(secret), "[REDACTED]")
    }
    return result
  }
  const title = safeString(error.error_user_title) ?? safeString(error.title)
  const userMessage = safeString(error.error_user_msg)
  const data = error.error_data
  const details = safeString(
    data && typeof data === "object" && "details" in data
      ? data.details
      : undefined
  )
  return {
    status,
    code: numberOr(error.code),
    subcode: numberOr(error.error_subcode),
    isTransient: error.is_transient === true,
    message:
      safeString(error.message) ??
      userMessage ??
      `Meta returned HTTP ${status}`,
    ...(title ? { title } : {}),
    ...(userMessage ? { userMessage } : {}),
    ...(details ? { details } : {}),
    fbtraceId: safeString(error.fbtrace_id),
  }
}

/** A Graph response body as JSON, or the MetaError it describes. Graph can
    answer 200 with an error body, so both the status and body count. */
export function parseGraphResponse(
  status: number,
  body: string,
  secrets: readonly string[] = []
): unknown {
  let parsed: unknown
  try {
    parsed = body ? JSON.parse(body) : {}
  } catch {
    parsed = undefined
  }
  const failed =
    status < 200 ||
    status >= 300 ||
    parsed === undefined ||
    (!!parsed && typeof parsed === "object" && "error" in parsed)
  if (failed) throw new MetaError(parseGraphError(status, body, secrets))
  return parsed
}
