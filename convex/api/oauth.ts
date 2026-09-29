import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import { components, internal } from "../_generated/api"
import { internalMutation, internalQuery } from "../_generated/server"
import { callerValue, requireCaller } from "./caller"
import { listArgs } from "./paging"
import { apiRoute, listParams } from "./route"

const grantValue = v.object({
  id: v.string(),
  client_id: v.string(),
  scopes: v.array(v.string()),
  resource: v.null(),
  created_at: v.string(),
  revoked_at: v.union(v.string(), v.null()),
  revoked_reason: v.union(v.string(), v.null()),
  client: v.object({
    name: v.string(),
    logo_uri: v.union(v.string(), v.null()),
  }),
})
export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({ has_more: v.boolean(), data: v.array(grantValue) }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    return ctx.runQuery(components.betterAuth.oauth.listRest, {
      organizationId: caller.organizationId,
      ...page,
    })
  },
})
export const revoke = internalMutation({
  args: { caller: callerValue, id: v.string() },
  returns: v.object({
    object: v.literal("oauth_grant"),
    id: v.string(),
    revoked_at: v.string(),
    revoked_reason: v.literal("revoked_from_api"),
  }),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    return ctx.runMutation(components.betterAuth.oauth.revokeRest, {
      organizationId: caller.organizationId,
      id,
    })
  },
})
export function registerOAuthGrantRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/oauth/grants",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => ({
      body: {
        object: "list",
        ...(await ctx.runQuery(internal.api.oauth.list, {
          caller,
          ...listParams(query),
        })),
      },
    }),
  })
  apiRoute(http, {
    method: "DELETE",
    path: "/oauth/grants/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runMutation(internal.api.oauth.revoke, {
        caller,
        id: params.id,
      }),
    }),
  })
}
