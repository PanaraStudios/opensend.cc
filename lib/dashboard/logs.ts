import type { LogSource } from "./types"

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

/** A stored request or response body for display: JSON when it parses,
    else the text as sent (a body cut to the stored size never parses). */
export function storedBody(text: string | undefined): unknown {
  if (text === undefined) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
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
