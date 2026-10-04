import { teamRow, type TeamRowTable, type TeamRowOptions } from "../lists"
import { retirement } from "../teamLifecycle"
import { ConvexError, v, type Infer } from "convex/values"
import { components } from "../_generated/api"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import {
  API_RESOURCES,
  scopeAllows,
  scopeName,
  type RequiredScope,
} from "../../lib/api-scopes"
import { apiKeyPermissionValue } from "../tables/api"

export const requiredScopeValue = v.union(
  v.literal("full_access"),
  v.object({
    resource: v.union(...API_RESOURCES.map(({ id }) => v.literal(id))),
    access: v.union(v.literal("read"), v.literal("write")),
  })
)

/** Who signed a REST request: an `os_` API key or an OAuth access token,
    reduced to the same shape. */
export const callerValue = v.object({
  organizationId: v.string(),
  idempotencyId: v.optional(v.id("apiIdempotency")),
  permission: apiKeyPermissionValue,
  scopes: v.optional(v.array(v.string())),
  scope: v.optional(requiredScopeValue),
  /** Preserve legacy email-send-only grants within the broader email resource. */
  emailSending: v.optional(v.boolean()),
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

/** A dashboard read of one record: a missing (e.g. just deleted) record is
    null, so its page shows "not found" instead of crashing. Other errors throw. */
export async function orNullIfNotFound<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read
  } catch (error) {
    if (
      error instanceof ConvexError &&
      (error.data as { statusCode?: number } | undefined)?.statusCode === 404
    )
      return null
    throw error
  }
}

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
  scope?: RequiredScope | "sending"
) {
  const key = caller.apiKeyId
    ? await ctx.db.get("apiKeys", caller.apiKeyId)
    : null
  if (
    key &&
    (key.permission !== caller.permission ||
      key.domainId !== caller.domainId ||
      JSON.stringify(key.scopes ?? []) !== JSON.stringify(caller.scopes ?? []))
  )
    throw apiError(403, "invalid_api_key", "API key is invalid")
  if (
    key &&
    usesSendingDomain(caller) &&
    (await domainRevoked(ctx, key.organizationId, key.domainId))
  )
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
  const required: RequiredScope =
    caller.scope ??
    (scope === "sending" ? { resource: "emails", access: "write" } : scope) ??
    "full_access"
  if (
    lacksPermission(
      caller,
      required,
      scope === "sending" ? true : caller.emailSending
    )
  )
    throw apiError(
      403,
      "restricted_api_key",
      `This API key needs the \`${scopeName(required)}\` scope.`
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
  caller: Pick<Caller, "permission" | "scopes" | "emailSending">,
  scope: RequiredScope,
  emailSending = caller.emailSending ?? false
) => {
  if (caller.permission === "full_access") return false
  if (scope === "full_access") return true
  if (caller.permission === "sending_access")
    return (
      scope.resource !== "emails" || scope.access !== "write" || !emailSending
    )
  return !scopeAllows(caller.scopes ?? [], scope.resource, scope.access)
}

/** Domain restrictions on custom keys affect email writes only. */
export function usesSendingDomain(caller: Caller) {
  return (
    caller.permission !== "custom" ||
    (caller.scope !== undefined &&
      caller.scope !== "full_access" &&
      caller.scope.resource === "emails" &&
      caller.scope.access === "write")
  )
}

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
