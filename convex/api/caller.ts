import { teamRow, type TeamRowTable, type TeamRowOptions } from "../lists"
import { retirement } from "../teamLifecycle"
import { ConvexError, v, type Infer } from "convex/values"
import { components } from "../_generated/api"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { apiKeyPermissionValue } from "../tables/api"

/** Who signed a REST request: an `os_` API key or an OAuth access token,
    reduced to the same shape. */
export const callerValue = v.object({
  organizationId: v.string(),
  idempotencyId: v.optional(v.id("apiIdempotency")),
  permission: apiKeyPermissionValue,
  /** A sending key limited to one domain. */
  domainId: v.optional(v.id("domains")),
  apiKeyId: v.optional(v.id("apiKeys")),
  oauthGrantId: v.optional(v.string()),
  /** Shown as the creator of what the request makes. */
  name: v.string(),
})
export type Caller = Infer<typeof callerValue>

/** An error in Resend's shape. Thrown anywhere under a REST route (actions,
    queries, mutations), it becomes the response. A plain
    `ConvexError("message")` from shared dashboard logic becomes a 422
    `validation_error` with that message. */
export const apiError = (statusCode: number, name: string, message: string) =>
  new ConvexError({ statusCode, name, message })

export const notFound = (noun: string) =>
  apiError(404, "not_found", `${noun} not found`)

export const invalid = (message: string) =>
  apiError(422, "validation_error", message)
export const missing = (field: string) =>
  apiError(422, "missing_required_field", `Missing \`${field}\` field.`)

/** Re-checks the caller inside the transaction that reads or writes team
    data: a key deleted, or an OAuth grant revoked, mid-request stops here.
    Every internal function behind a REST route calls this first. */
export async function requireCaller(
  ctx: QueryCtx | MutationCtx,
  caller: Caller,
  permission: "full_access" | "sending" = "full_access"
) {
  const key = caller.apiKeyId
    ? await ctx.db.get("apiKeys", caller.apiKeyId)
    : null
  if (
    key &&
    (key.permission !== caller.permission || key.domainId !== caller.domainId)
  )
    throw apiError(403, "invalid_api_key", "API key is invalid")
  if (key && (await domainRevoked(ctx, key.organizationId, key.domainId)))
    throw apiError(403, "invalid_api_key", "API key is invalid")
  const live = caller.apiKeyId
    ? key?.organizationId
    : caller.oauthGrantId
      ? (
          await ctx.runQuery(components.betterAuth.oauth.checkGrant, {
            id: caller.oauthGrantId,
          })
        )?.organizationId
      : undefined
  if (
    live !== caller.organizationId ||
    (await retirement(ctx, caller.organizationId))
  )
    throw apiError(403, "invalid_api_key", "API key is invalid")
  if (lacksPermission(caller, permission))
    throw apiError(
      401,
      "restricted_api_key",
      "This API key is restricted to only send emails."
    )
}

export async function requireTeamRow<T extends TeamRowTable>(
  ctx: QueryCtx,
  table: T,
  organizationId: string,
  id: string,
  noun: string,
  options?: TeamRowOptions<T>
) {
  const row = await teamRow(ctx, table, organizationId, id, options)
  if (!row) throw notFound(noun)
  return row
}

/* Policy checks shared by `begin` and `requireCaller`; each entry point keeps
   its own wire error. */
export const lacksPermission = (
  caller: Pick<Caller, "permission">,
  permission: "full_access" | "sending"
) => permission === "full_access" && caller.permission !== "full_access"

/** A domain-limited key whose domain was removed or left the team. */
export async function domainRevoked(
  ctx: QueryCtx,
  organizationId: string,
  domainId: Caller["domainId"]
) {
  if (!domainId) return false
  const domain = await ctx.db.get("domains", domainId)
  return !domain || domain.deleted || domain.organizationId !== organizationId
}
