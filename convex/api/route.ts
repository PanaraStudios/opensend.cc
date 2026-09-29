import { ConvexError } from "convex/values"
import type { HttpRouter } from "convex/server"
import { httpAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import { authorizeOAuth } from "../oauthHttp"
import { BodyTooLarge, limitedBody } from "../ses/web"
import { pgTimestamp } from "../../lib/dashboard/exports"
import { tokenHash } from "../../lib/oauth/policy"
import { apiError, type Caller } from "./caller"
import { API_RATE } from "./state"

type Method = "GET" | "POST" | "PATCH" | "DELETE"
export type ApiRequest = {
  caller: Caller
  headers: Headers
  /** The `{named}` segments of the route path. */
  params: Record<string, string>
  query: URLSearchParams
  /** Parsed JSON, or undefined without a body. Narrow before use. */
  body: unknown
}
export type ApiReply = {
  status?: number
  body: unknown
  /** Links the request log to the email it created. */
  emailId?: string
}
export type ApiRouteOptions = {
  method: Method
  /** A path like "/domains/{id}/verify". */
  path: string
  /** "sending" also admits sending-access keys and `emails:send` tokens. */
  permission: "full_access" | "sending"
  /** Largest accepted request body, in bytes. Default 1 MB. */
  maxBody?: number
  bodyFormat?: "multipart"
  source?: "smtp"
  handler: (ctx: ActionCtx, request: ApiRequest) => Promise<ApiReply>
}

/**
 * Adds one Resend-compatible REST endpoint on the Convex site URL:
 *
 *   apiRoute(http, {
 *     method: "GET", path: "/domains/{id}", permission: "full_access",
 *     handler: async (ctx, { caller, params }) => ({ body: {...} }),
 *   })
 *
 * The wrapper authenticates `Authorization: Bearer` (an `os_` API key or an
 * OAuth access token), enforces `permission`, rate-limits the team (Resend's
 * 10 requests a second, with its `ratelimit-*` and `retry-after` headers),
 * replays `Idempotency-Key` POSTs for 24 hours, parses the JSON body and
 * logs every request it can attribute to a team, failures included.
 *
 * The handler runs as an action: call internal functions that start with
 * `requireCaller(ctx, caller)`. Throw `apiError(status, name, message)` for
 * a Resend error; a plain `ConvexError("…")` becomes a 422
 * `validation_error`; anything else is a 500 `application_error`.
 * A sending key's `caller.domainId` limits which domain it may send from;
 * the sending route checks it. No CORS headers are sent: like Resend, the
 * API is for servers.
 */
export function apiRoute(http: HttpRouter, options: ApiRouteOptions) {
  const segments = options.path.split("/")
  const firstParam = segments.findIndex(isParam)
  /* Convex routes by exact path or prefix only, so every pattern under one
     prefix and method shares a Convex route that matches the rest here. */
  const prefix =
    firstParam < 0 ? null : `${segments.slice(0, firstParam).join("/")}/`
  const routeKey = `${options.method} ${prefix ?? options.path}`
  let table = routes.get(http)
  if (!table) routes.set(http, (table = new Map()))
  let patterns = table.get(routeKey)
  if (!patterns) {
    table.set(routeKey, (patterns = []))
    const handler = dispatch(patterns)
    http.route(
      prefix
        ? { pathPrefix: prefix, method: options.method, handler }
        : { path: options.path, method: options.method, handler }
    )
  }
  patterns.push({ segments, options })
}

type Pattern = { segments: string[]; options: ApiRouteOptions }
const routes = new WeakMap<HttpRouter, Map<string, Pattern[]>>()
const MAX_BODY = 1_048_576
/** Convex's runtime types have no iterable `Headers`. */
function headerEntries(headers: Headers) {
  const entries: [string, string][] = []
  headers.forEach((value, name) => entries.push([name, value]))
  return entries
}
const REDACTED = new Set(["authorization", "cookie", "proxy-authorization"])
const isParam = (segment: string) =>
  segment.startsWith("{") && segment.endsWith("}")

function match(patterns: Pattern[], path: string) {
  const parts = path.split("/")
  for (const pattern of patterns) {
    if (pattern.segments.length !== parts.length) continue
    const params: Record<string, string> = {}
    const ok = pattern.segments.every((segment, i) => {
      if (!isParam(segment)) return segment === parts[i]
      if (!parts[i]) return false
      try {
        params[segment.slice(1, -1)] = decodeURIComponent(parts[i])
      } catch {
        return false
      }
      return true
    })
    if (ok) return { options: pattern.options, params }
  }
  return null
}

type Failure = { statusCode: number; name: string; message: string }
function isFailure(value: unknown): value is Failure {
  return (
    !!value &&
    typeof value === "object" &&
    "statusCode" in value &&
    typeof value.statusCode === "number" &&
    "name" in value &&
    typeof value.name === "string" &&
    "message" in value &&
    typeof value.message === "string"
  )
}
/** Any thrown value as a Resend error. */
function failure(error: unknown): Failure {
  if (error instanceof ConvexError) {
    if (isFailure(error.data)) return error.data
    if (typeof error.data === "string")
      return { statusCode: 422, name: "validation_error", message: error.data }
  }
  console.error("API request failed")
  return {
    statusCode: 500,
    name: "application_error",
    message: "An unexpected error occurred.",
  }
}
const reply = (status: number, body: string, headers: HeadersInit = {}) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
const refuse = (error: Failure) =>
  reply(error.statusCode, JSON.stringify(error))
const invalidKey: Failure = {
  statusCode: 403,
  name: "invalid_api_key",
  message: "API key is invalid",
}

/** The bearer token as a credential `begin` can check, or the error. */
async function credential(ctx: ActionCtx, request: Request) {
  const header = request.headers.get("authorization") ?? ""
  const token = header.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token)
    return {
      error: {
        statusCode: 401,
        name: "missing_api_key",
        message: "Missing API key in the authorization header.",
      },
    }
  if (token.startsWith("os_"))
    return {
      credential: { kind: "key" as const, tokenHash: await tokenHash(token) },
    }
  try {
    const auth = await authorizeOAuth(ctx, token)
    const permission = auth.scopes.includes("full_access")
      ? ("full_access" as const)
      : auth.scopes.includes("emails:send")
        ? ("sending_access" as const)
        : null
    if (permission)
      return {
        credential: {
          kind: "oauth" as const,
          grantId: auth.grant,
          organizationId: auth.team,
          permission,
        },
      }
  } catch {
    /* An invalid, expired or revoked token reads as an invalid key. */
  }
  return { error: invalidKey }
}

function dispatch(patterns: Pattern[]) {
  return httpAction(async (ctx, request) => {
    const started = Date.now()
    const url = new URL(request.url)
    const found = match(patterns, url.pathname)
    if (!found)
      return refuse({
        statusCode: 404,
        name: "not_found",
        message: "The requested endpoint does not exist.",
      })
    const { options, params } = found
    const auth = await credential(ctx, request)
    if (auth.error) return refuse(auth.error)
    let text: string
    try {
      text = await limitedBody(request, options.maxBody ?? MAX_BODY)
    } catch (e) {
      if (!(e instanceof BodyTooLarge)) throw e
      return refuse({
        statusCode: 413,
        name: "validation_error",
        message: "The request body is too large.",
      })
    }
    /* Problems found before the handler still reach the team's logs. */
    let problem: Failure | undefined
    let body: unknown
    if (text.trim())
      try {
        if (options.bodyFormat === "multipart") {
          const contentType = request.headers.get("content-type") ?? ""
          if (!contentType.toLowerCase().startsWith("multipart/form-data;"))
            throw new Error("Expected multipart/form-data")
          const form = await new Request(request.url, {
            method: "POST",
            headers: { "content-type": contentType },
            body: text,
          }).formData()
          const fields: Record<string, unknown> = {}
          const entries: [string, FormDataEntryValue][] = []
          form.forEach((value, key) => entries.push([key, value]))
          for (const [key, value] of entries.sort(([a], [b]) =>
            a.localeCompare(b)
          )) {
            if (Object.hasOwn(fields, key))
              throw new Error("Duplicate form field")
            if (typeof value === "string") {
              if (key === "file") throw new Error("Expected CSV file")
              fields[key] = value
            } else {
              if (key !== "file") throw new Error("Unexpected file field")
              fields.file = await value.text()
            }
          }
          body = fields
          // Multipart boundaries change between retries; hash the actual fields.
          text = JSON.stringify(fields)
        } else body = JSON.parse(text)
      } catch {
        problem = {
          statusCode: 400,
          name: "validation_error",
          message:
            options.bodyFormat === "multipart"
              ? "The request body is not valid multipart form data."
              : "The request body is not valid JSON.",
        }
      }
    const idempotencyKey =
      options.method === "POST" ? request.headers.get("idempotency-key") : null
    if (
      idempotencyKey !== null &&
      (idempotencyKey.length < 1 || idempotencyKey.length > 256)
    )
      problem ??= {
        statusCode: 400,
        name: "invalid_idempotency_key",
        message:
          "Idempotency keys, if present, must have between 1 and 256 characters.",
      }
    const begun = await ctx.runMutation(internal.api.state.begin, {
      credential: auth.credential,
      permission: options.permission,
      smtp: options.source === "smtp",
      idempotency:
        idempotencyKey && !problem
          ? {
              key: idempotencyKey,
              requestHash: await tokenHash(
                `${options.method} ${url.pathname}${url.pathname === "/emails/batch" ? ` ${request.headers.get("x-batch-validation") ?? "strict"}` : ""}\n${text}`
              ),
            }
          : undefined,
    })
    if (begun.kind === "refused") return refuse(begun.error)
    let status: number
    let responseBody: string
    let emailId: string | undefined
    if (begun.kind === "error" || problem) {
      const error = begun.kind === "error" ? begun.error : problem!
      status = error.statusCode
      responseBody = JSON.stringify(error)
    } else if (begun.kind === "replay") {
      status = begun.status
      responseBody = begun.body
    } else
      try {
        const result = await options.handler(ctx, {
          caller: { ...begun.caller, idempotencyId: begun.idempotencyId },
          params,
          query: url.searchParams,
          headers: request.headers,
          body,
        })
        status = result.status ?? 200
        responseBody = JSON.stringify(result.body)
        emailId = result.emailId
      } catch (e) {
        const error = failure(e)
        status = error.statusCode
        responseBody = JSON.stringify(error)
      }
    try {
      await ctx.runMutation(internal.api.state.finish, {
        caller: begun.caller,
        idempotencyId:
          begun.kind === "ok" && !problem ? begun.idempotencyId : undefined,
        log: {
          source: options.source,
          method: options.method,
          path: url.pathname,
          status,
          durationMs: Date.now() - started,
          userAgent: request.headers.get("user-agent") ?? "Unknown",
          emailId,
          requestHeaders: headerEntries(request.headers)
            .slice(0, 50)
            .map(([name, value]) => ({
              name,
              value: REDACTED.has(name) ? "[redacted]" : value.slice(0, 1024),
            })),
          requestBody: text || undefined,
          responseBody,
        },
      })
    } catch {
      // A lost log line never fails the request it describes.
      console.error("API request log could not be saved")
    }
    return reply(status, responseBody, {
      "ratelimit-limit": String(API_RATE),
      "ratelimit-remaining": String(begun.rate.remaining),
      "ratelimit-reset": String(begun.rate.reset),
      ...(begun.kind === "error" && begun.retryAfter !== undefined
        ? { "retry-after": String(begun.retryAfter) }
        : {}),
    })
  })
}

/* ------------------------------------------------------- handler helpers */

/** The JSON body as an object, or a 422. */
export function objectBody(body: unknown): Record<string, unknown> {
  if (body === undefined) return {}
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw apiError(
      422,
      "validation_error",
      "The request body must be a JSON object."
    )
  return body as Record<string, unknown>
}
export function stringField(
  body: Record<string, unknown>,
  name: string,
  required = false
): string | undefined {
  const value = body[name]
  if (value === undefined || value === null) {
    if (required)
      throw apiError(
        422,
        "missing_required_field",
        `Missing \`${name}\` field.`
      )
    return undefined
  }
  if (typeof value !== "string")
    throw apiError(
      422,
      "validation_error",
      `The \`${name}\` field must be a string.`
    )
  return value
}
export function booleanField(
  body: Record<string, unknown>,
  name: string
): boolean | undefined {
  const value = body[name]
  if (value === undefined || value === null) return undefined
  if (typeof value !== "boolean")
    throw apiError(
      422,
      "validation_error",
      `The \`${name}\` field must be a boolean.`
    )
  return value
}
export function enumField<T extends string>(
  body: Record<string, unknown>,
  name: string,
  values: readonly T[]
): T | undefined {
  const value = stringField(body, name)
  if (value !== undefined && !values.includes(value as T))
    throw apiError(
      422,
      "validation_error",
      `The \`${name}\` field must be one of: ${values.join(", ")}.`
    )
  return value as T | undefined
}

/** Resend's `limit`, `after` and `before` list parameters. */
export function listParams(query: URLSearchParams) {
  const raw = query.get("limit")
  const limit = raw === null ? 20 : Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw apiError(
      422,
      "validation_error",
      "The `limit` parameter must be an integer between 1 and 100."
    )
  const after = query.get("after") ?? undefined
  const before = query.get("before") ?? undefined
  if (after && before)
    throw apiError(
      422,
      "validation_error",
      "The `after` and `before` parameters cannot be used together."
    )
  return { limit, after, before }
}

/** Resend's timestamp format: "2026-04-08 00:11:13.110000+00". */
export const apiTime = pgTimestamp
