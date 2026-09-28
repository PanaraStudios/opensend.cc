import { retirement } from "../teamLifecycle"
import { smtpSettings } from "../smtp"
import { v } from "convex/values"
import { RateLimiter, SECOND } from "@convex-dev/rate-limiter"
import { components, internal } from "../_generated/api"
import { internalMutation } from "../_generated/server"
import { apiKeyPermissionValue, httpMethodValue } from "../tables/api"
import { callerValue, type Caller } from "./caller"
import { touchKey } from "../apiKeys"
import { patchEmail } from "../emailRows"
import { writeLog } from "../logs"

/** Resend's documented default: 10 requests per second per team, shared by
    all of its keys. */
export const API_RATE = 10
const limiter = new RateLimiter(components.rateLimiter, {
  api: { kind: "fixed window", rate: API_RATE, period: SECOND },
})
const IDEMPOTENCY_WINDOW = 24 * 3_600_000
/** A reservation whose request never finished is released after this. */
const IDEMPOTENCY_STALE = 60_000

const rateValue = v.object({ remaining: v.number(), reset: v.number() })
const errorValue = v.object({
  statusCode: v.number(),
  name: v.string(),
  message: v.string(),
})
const beginResult = v.union(
  v.object({ kind: v.literal("refused"), error: errorValue }),
  v.object({
    kind: v.literal("error"),
    caller: callerValue,
    rate: rateValue,
    error: errorValue,
    retryAfter: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("replay"),
    caller: callerValue,
    rate: rateValue,
    status: v.number(),
    body: v.string(),
  }),
  v.object({
    kind: v.literal("ok"),
    caller: callerValue,
    rate: rateValue,
    idempotencyId: v.optional(v.id("apiIdempotency")),
  })
)
const invalidKey = {
  statusCode: 403,
  name: "invalid_api_key",
  message: "API key is invalid",
}

/** Authenticates, rate-limits and reserves the idempotency key of one REST
    request, in one transaction. */
export const begin = internalMutation({
  args: {
    credential: v.union(
      v.object({ kind: v.literal("key"), tokenHash: v.string() }),
      v.object({
        kind: v.literal("oauth"),
        grantId: v.string(),
        organizationId: v.string(),
        permission: apiKeyPermissionValue,
      })
    ),
    permission: v.union(v.literal("full_access"), v.literal("sending")),
    smtp: v.optional(v.boolean()),
    idempotency: v.optional(
      v.object({ key: v.string(), requestHash: v.string() })
    ),
  },
  returns: beginResult,
  handler: async (ctx, args) => {
    let caller: Caller
    if (args.credential.kind === "key") {
      const { tokenHash } = args.credential
      const key = await ctx.db
        .query("apiKeys")
        .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
        .unique()
      if (!key) return { kind: "refused" as const, error: invalidKey }
      caller = {
        organizationId: key.organizationId,
        permission: key.permission,
        domainId: key.domainId,
        apiKeyId: key._id,
        name: `API key “${key.name}”`,
      }
    } else {
      const { grantId, organizationId, permission } = args.credential
      caller = {
        organizationId,
        permission,
        oauthGrantId: grantId,
        name: "OAuth application",
      }
    }
    if (await retirement(ctx, caller.organizationId))
      return { kind: "refused" as const, error: invalidKey }
    const limit = await limiter.limit(ctx, "api", {
      key: caller.organizationId,
    })
    const window = await limiter.getValue(ctx, "api", {
      key: caller.organizationId,
    })
    const rate = {
      remaining: Math.max(0, Math.floor(window.value)),
      reset: Math.max(1, Math.ceil((window.ts + SECOND - Date.now()) / 1000)),
    }
    const fail = (
      statusCode: number,
      name: string,
      message: string,
      retryAfter?: number
    ) => ({
      kind: "error" as const,
      caller,
      rate,
      error: { statusCode, name, message },
      ...(retryAfter === undefined ? {} : { retryAfter }),
    })
    if (!limit.ok)
      return fail(
        429,
        "rate_limit_exceeded",
        `Too many requests. You can only make ${API_RATE} requests per second. See rate limit response headers for more information.`,
        Math.max(1, Math.ceil(limit.retryAfter / 1000))
      )
    if (
      args.permission === "full_access" &&
      caller.permission !== "full_access"
    )
      return caller.apiKeyId
        ? fail(
            401,
            "restricted_api_key",
            "This API key is restricted to only send emails."
          )
        : fail(
            403,
            "invalid_permission",
            "Access token is missing required scopes."
          )
    if (caller.domainId) {
      const domain = await ctx.db.get("domains", caller.domainId)
      if (!domain || domain.deleted)
        return fail(
          403,
          "restricted_api_key",
          "The domain this API key sends from was removed, so it can no longer send email."
        )
    }
    if (args.smtp) {
      if (!caller.apiKeyId)
        return fail(403, "invalid_api_key", "SMTP requires an API key")
      if (!(await smtpSettings(ctx, caller.organizationId))?.enabled)
        return fail(403, "smtp_disabled", "SMTP is disabled for this team")
    }
    if (!args.idempotency) return { kind: "ok" as const, caller, rate }
    const { key, requestHash } = args.idempotency
    const now = Date.now()
    const existing = await ctx.db
      .query("apiIdempotency")
      .withIndex("by_organizationId_and_key", (q) =>
        q.eq("organizationId", caller.organizationId).eq("key", key)
      )
      .unique()
    if (
      existing &&
      existing.expiresAt > now &&
      (existing.response || existing._creationTime > now - IDEMPOTENCY_STALE)
    ) {
      if (existing.requestHash !== requestHash)
        return fail(
          409,
          "invalid_idempotent_request",
          "This idempotency key has already been used on a request that had a different payload. Retrying this request is useless without changing the idempotency key or payload."
        )
      if (!existing.response)
        return fail(
          409,
          "concurrent_idempotent_requests",
          "Another request with the same idempotency key is currently in progress. As this request is still being processed, retry it later."
        )
      return { kind: "replay" as const, caller, rate, ...existing.response }
    }
    if (existing) await ctx.db.delete("apiIdempotency", existing._id)
    const idempotencyId = await ctx.db.insert("apiIdempotency", {
      organizationId: caller.organizationId,
      key,
      requestHash,
      expiresAt: now + IDEMPOTENCY_WINDOW,
    })
    return { kind: "ok" as const, caller, rate, idempotencyId }
  },
})

/** Logs a request and settles its idempotency key: a response is kept for
    replay; a server error releases the key so the request can be retried. */
export const finish = internalMutation({
  args: {
    caller: callerValue,
    log: v.object({
      source: v.optional(v.literal("smtp")),
      method: httpMethodValue,
      path: v.string(),
      status: v.number(),
      durationMs: v.number(),
      userAgent: v.string(),
      emailId: v.optional(v.string()),
      requestHeaders: v.array(
        v.object({ name: v.string(), value: v.string() })
      ),
      requestBody: v.optional(v.string()),
      responseBody: v.optional(v.string()),
    }),
    idempotencyId: v.optional(v.id("apiIdempotency")),
  },
  returns: v.null(),
  handler: async (ctx, { caller, log, idempotencyId }) => {
    if (await retirement(ctx, caller.organizationId)) return null
    const logId = await writeLog(ctx, caller.organizationId, {
      ...log,
      source: log.source ?? "api",
      apiKeyId: caller.apiKeyId,
      oauthGrantId: caller.oauthGrantId,
    })
    if (
      log.emailId &&
      log.method === "POST" &&
      (log.path === "/emails" || log.path === "/smtp/emails") &&
      log.status < 300
    ) {
      const id = ctx.db.normalizeId("emails", log.emailId)
      const email = id ? await ctx.db.get("emails", id) : null
      if (email?.organizationId === caller.organizationId && !email.apiLogId)
        await patchEmail(ctx, email._id, { apiLogId: logId })
    }
    if (caller.apiKeyId && (await ctx.db.get("apiKeys", caller.apiKeyId)))
      await touchKey(ctx, caller.apiKeyId)
    if (idempotencyId && (await ctx.db.get("apiIdempotency", idempotencyId))) {
      if (log.status >= 500)
        await ctx.db.delete("apiIdempotency", idempotencyId)
      else
        await ctx.db.patch("apiIdempotency", idempotencyId, {
          response: { status: log.status, body: log.responseBody ?? "" },
        })
    }
    return null
  },
})

/** Drops expired idempotency keys, a batch at a time. */
export const expireIdempotency = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("apiIdempotency")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now()))
      .take(500)
    for (const row of rows) await ctx.db.delete("apiIdempotency", row._id)
    if (rows.length === 500)
      await ctx.scheduler.runAfter(0, internal.api.state.expireIdempotency, {})
    return null
  },
})
