import type { ParsedArgs } from "minimist"
import { DEFAULT_HTTP_PORT } from "./constants.js"
import { parseAllowedHosts, parseReplierAddresses } from "./parse.js"
import type { ResolveResult } from "./types.js"

function resolveHost(
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv
): string | undefined {
  if (typeof parsed.host === "string" && parsed.host.trim() !== "")
    return parsed.host.trim()
  if (
    typeof env.OPENSEND_MCP_HOST === "string" &&
    env.OPENSEND_MCP_HOST.trim() !== ""
  )
    return env.OPENSEND_MCP_HOST.trim()
  return undefined
}

function parsePort(parsed: ParsedArgs, env: NodeJS.ProcessEnv): number {
  const fromArg =
    typeof parsed.port === "string" && parsed.port.trim() !== ""
      ? Number.parseInt(parsed.port.trim(), 10)
      : NaN
  if (Number.isInteger(fromArg) && fromArg > 0 && fromArg < 65536)
    return fromArg
  const fromEnv =
    typeof env.OPENSEND_MCP_PORT === "string" &&
    env.OPENSEND_MCP_PORT.trim() !== ""
      ? Number.parseInt(env.OPENSEND_MCP_PORT.trim(), 10)
      : NaN
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536)
    return fromEnv
  return DEFAULT_HTTP_PORT
}

/**
 * Resolve config from parsed argv and env. No side effects, no exit.
 */
export function resolveConfig(
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv = process.env
): ResolveResult {
  const apiKey =
    (typeof parsed.key === "string" ? parsed.key : null) ??
    env.OPENSEND_API_KEY ??
    null

  const http = parsed.http === true

  // Stdio requires an API key at startup. HTTP mode is lenient because
  // each client provides their own key via the Authorization: Bearer header.
  if (!http && (!apiKey || !apiKey.trim())) {
    return {
      ok: false,
      error:
        "No API key. Set OPENSEND_API_KEY or use --key=<your-opensend-api-key>",
    }
  }

  const baseUrl = (
    (typeof parsed["base-url"] === "string" ? parsed["base-url"] : undefined) ??
    env.OPENSEND_BASE_URL ??
    ""
  ).trim()
  if (!baseUrl) {
    return {
      ok: false,
      error:
        "No base URL. Set OPENSEND_BASE_URL or use --base-url=<your-opensend-api-origin>",
    }
  }
  try {
    const url = new URL(baseUrl)
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error()
  } catch {
    return {
      ok: false,
      error:
        "Invalid base URL. Provide an HTTP(S) API origin without credentials, path, query, or fragment.",
    }
  }

  const senderEmailAddress =
    (typeof parsed.sender === "string" ? parsed.sender : null) ??
    (typeof env.OPENSEND_SENDER_EMAIL_ADDRESS === "string"
      ? env.OPENSEND_SENDER_EMAIL_ADDRESS.trim() || undefined
      : undefined)

  const port = parsePort(parsed, env)

  const base = {
    baseUrl,
    senderEmailAddress: senderEmailAddress ?? "",
    replierEmailAddresses: parseReplierAddresses(parsed, env),
    port,
  }

  return {
    ok: true,
    config: http
      ? {
          ...base,
          transport: "http" as const,
          apiKey: apiKey?.trim(),
          host: resolveHost(parsed, env),
          allowedHosts: parseAllowedHosts(parsed, env),
        }
      : { ...base, transport: "stdio" as const, apiKey: apiKey!.trim() },
  }
}
