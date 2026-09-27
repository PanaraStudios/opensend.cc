import { ConvexError, v, type Infer } from "convex/values"
import { components } from "../_generated/api"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { apiKeyPermissionValue } from "../tables/api"

/** Who signed a REST request: an `os_` API key or an OAuth access token,
    reduced to the same shape. */
export const callerValue = v.object({
  organizationId: v.string(),
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

/** Re-checks the caller inside the transaction that reads or writes team
    data: a key deleted, or an OAuth grant revoked, mid-request stops here.
    Every internal function behind a REST route calls this first. */
export async function requireCaller(
  ctx: QueryCtx | MutationCtx,
  caller: Caller,
  permission: "full_access" | "sending" = "full_access"
) {
  const live = caller.apiKeyId
    ? (await ctx.db.get("apiKeys", caller.apiKeyId))?.organizationId
    : caller.oauthGrantId
      ? (
          await ctx.runQuery(components.betterAuth.oauth.checkGrant, {
            id: caller.oauthGrantId,
          })
        )?.organizationId
      : undefined
  if (live !== caller.organizationId)
    throw apiError(403, "invalid_api_key", "API key is invalid")
  if (permission === "full_access" && caller.permission !== "full_access")
    throw apiError(
      401,
      "restricted_api_key",
      "This API key is restricted to only send emails."
    )
}
