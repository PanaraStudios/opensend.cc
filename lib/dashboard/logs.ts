import type { BadgeTone } from "./format"
import type { ApiLog, LogSource, SentEmail } from "./types"

export const DASHBOARD_USER_AGENT = "Opensend Dashboard"

export const LOG_USER_AGENTS = [
  "opensend-node:1.4.0",
  "opensend-python:0.9.2",
  "curl/8.7.1",
  "Opensend SMTP",
  DASHBOARD_USER_AGENT,
] as const

const LOG_SOURCE_LABEL: Record<LogSource, string> = {
  api: "API",
  smtp: "SMTP",
  dashboard: "Dashboard",
}

export const LOG_SOURCES = Object.keys(LOG_SOURCE_LABEL) as LogSource[]

export function logSourceLabel(source: LogSource): string {
  return LOG_SOURCE_LABEL[source]
}

export const LOG_STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const
export type LogStatusClass = (typeof LOG_STATUS_CLASSES)[number]

export function logStatusClass(status: number): LogStatusClass {
  if (status >= 500) return "5xx"
  if (status >= 400) return "4xx"
  if (status >= 300) return "3xx"
  return "2xx"
}

export function logStatusTone(status: number): BadgeTone {
  if (status >= 400) return "destructive"
  if (status >= 300) return "warning"
  return "success"
}

/** Backfill fields added after a log was persisted. */
export function normalizeLog(log: ApiLog): ApiLog {
  return {
    ...log,
    userAgent: log.userAgent ?? DASHBOARD_USER_AGENT,
    source: log.source ?? "dashboard",
    apiKeyId: log.apiKeyId ?? null,
  }
}

const ERROR_NAMES: Record<number, [name: string, message: string]> = {
  401: ["missing_api_key", "Missing API key in the authorization header."],
  403: ["invalid_api_key", "API key is not allowed to use this resource."],
  404: ["not_found", "The requested resource was not found."],
  422: ["validation_error", "The request body failed validation."],
  429: ["rate_limit_exceeded", "Too many requests. Slow down and retry."],
  500: ["internal_server_error", "An unexpected error occurred."],
}

/** Bodies are derived from the log, not stored, so the persisted state stays
    small. `null` means the request or response carried no body. */
export function logResponseBody(log: ApiLog): object | null {
  if (log.status >= 400) {
    const [name, message] = ERROR_NAMES[log.status] ?? ERROR_NAMES[500]
    return { statusCode: log.status, name, message }
  }
  if (log.method === "DELETE") return { deleted: true }
  if (log.method === "GET" && !log.path.slice(1).includes("/")) {
    return { object: "list", data: [] }
  }
  return { id: log.emailId ?? log.id.replace(/^log_/, "") }
}

export function logRequestBody(
  log: ApiLog,
  email: SentEmail | undefined
): object | null {
  if (log.method === "GET" || log.method === "DELETE") return null
  if (!email || log.path !== "/emails") return {}
  return {
    from: email.from,
    to: [email.to],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: email.subject,
    html: email.html,
    text: email.text,
  }
}

const REDACTED = "[redacted]"

export function logRequestHeaders(
  log: ApiLog,
  requestBody: object | null
): [name: string, value: string][] {
  const headers: [string, string][] = [
    ["accept", "*/*"],
    ["accept-encoding", "gzip, br"],
    ["authorization", REDACTED],
  ]
  if (requestBody) {
    headers.push(
      ["content-length", String(JSON.stringify(requestBody).length)],
      ["content-type", "application/json"]
    )
  }
  headers.push(
    ["host", REDACTED],
    ["user-agent", log.userAgent],
    ["x-forwarded-for", REDACTED],
    ["x-forwarded-proto", REDACTED]
  )
  return headers
}

export type JsonTokenKind = "key" | "string" | "literal" | "punct"
export type JsonToken = { kind: JsonTokenKind; value: string }

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

/** Split pretty-printed JSON into highlightable tokens. */
export function tokenizeJson(source: string): JsonToken[] {
  const tokens: JsonToken[] = []
  let last = 0
  for (const match of source.matchAll(JSON_TOKEN)) {
    if (match.index > last) {
      tokens.push({ kind: "punct", value: source.slice(last, match.index) })
    }
    if (match[1]) {
      tokens.push({ kind: match[2] ? "key" : "string", value: match[1] })
      if (match[2]) tokens.push({ kind: "punct", value: match[2] })
    } else {
      tokens.push({ kind: "literal", value: match[0] })
    }
    last = match.index + match[0].length
  }
  if (last < source.length) {
    tokens.push({ kind: "punct", value: source.slice(last) })
  }
  return tokens
}
