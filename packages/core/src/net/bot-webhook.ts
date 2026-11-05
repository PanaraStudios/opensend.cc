import { webhookHeaders } from "../webhooks/signing"
import { randomUUID } from "node:crypto"
import { publicFetch, type PublicFetchOptions } from "./public-fetch"
import { validateToolArguments, type ToolSchema, record } from "../bot-toolkit"
export type WebhookConfig = {
  url: string
  method: NonNullable<PublicFetchOptions["method"]>
  headers: Record<string, string>
  signingSecret: string
  parameters: ToolSchema
  timeoutMs: number
  resultFields?: string[]
}
/** Matches the timestamp/nonce/body HMAC convention used by outbound webhooks. */
export async function signToolRequest(
  secret: string,
  body: string,
  timestamp = String(Math.floor(Date.now() / 1000)),
  id: string = randomUUID()
): Promise<Record<string, string>> {
  return webhookHeaders({
    secret: `whsec_${Buffer.from(secret).toString("base64")}`,
    body,
    timestamp: Number(timestamp),
    id,
  })
}
export async function executeBotWebhook(
  config: WebhookConfig,
  input: unknown,
  fetcher = publicFetch
) {
  validateToolArguments(config.parameters, input)
  const args = record(input),
    url = new URL(config.url)
  if (config.method === "GET")
    for (const [key, value] of Object.entries(args))
      url.searchParams.set(key, String(value))
  const body = config.method === "GET" ? "" : JSON.stringify(args)
  const signature = await signToolRequest(config.signingSecret, body)
  try {
    const response = await fetcher(url, {
      method: config.method,
      headers: {
        ...config.headers,
        "content-type": "application/json",
        ...signature,
      },
      ...(body ? { body } : {}),
      maxBytes: 8192,
      timeoutMs: Math.min(10000, config.timeoutMs),
    })
    if (!response.ok)
      return {
        ok: false as const,
        error: `The tool endpoint returned HTTP ${response.status}`,
      }
    let value: unknown = await response.text()
    if (new TextEncoder().encode(value as string).length > 8192)
      return { ok: false as const, error: "The tool response exceeds 8 KB" }
    try {
      value = JSON.parse(value as string)
    } catch {
      /* Text responses are supported. */
    }
    if (config.resultFields) {
      const source = record(value),
        filtered: Record<string, unknown> = {}
      for (const key of config.resultFields)
        if (Object.hasOwn(source, key)) filtered[key] = source[key]
      value = filtered
    }
    // Endpoints sometimes echo request credentials. Redact before returning or storing.
    const secrets = [
      ...new Set([
        config.signingSecret,
        ...Object.values(config.headers).flatMap((value) => [
          value,
          value.replace(/^(Bearer|Basic) /i, ""),
        ]),
        signature["svix-signature"],
      ]),
    ]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
    const redact = (value: unknown): unknown => {
      if (typeof value === "string") {
        for (const secret of secrets)
          value = (value as string).split(secret).join("[redacted]")
        return value
      }
      if (Array.isArray(value)) return value.map(redact)
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [
            String(redact(key)),
            redact(entry),
          ])
        )
      if (value !== null && secrets.includes(String(value))) return "[redacted]"
      return value
    }
    const result = redact(value)
    if (new TextEncoder().encode(JSON.stringify(result)).length > 8192)
      return { ok: false as const, error: "The tool response exceeds 8 KB" }
    return { ok: true as const, result }
  } catch (error) {
    const message =
      error instanceof Error ? `${error.name}: ${error.message}` : ""
    return {
      ok: false as const,
      error: /private network|public HTTPS/.test(message)
        ? "The tool endpoint must resolve to a public HTTPS address"
        : /too large/.test(message)
          ? "The tool response exceeds 8 KB"
          : /timeout|timed out|abort/i.test(message)
            ? "The tool endpoint timed out"
            : "The tool endpoint could not be reached or returned an invalid response",
    }
  }
}
