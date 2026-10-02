import { createWebhookSecret } from "../../lib/dashboard/ids"
import type { HttpRouter } from "convex/server"
import { internal } from "../_generated/api"
import { apiRoute, listParams, objectBody } from "../api/route"
export function registerIvrRoutes(http: HttpRouter) {
  for (const kind of ["create", "update", "remove"] as const)
    apiRoute(http, {
      method:
        kind === "create" ? "POST" : kind === "update" ? "PATCH" : "DELETE",
      path: kind === "create" ? "/ivrs" : "/ivrs/{id}",
      scope: { resource: "ivrs", access: "write" },
      handler: async (ctx, { caller, params, body }) => ({
        status: kind === "create" ? 201 : 200,
        body: await ctx.runMutation(internal.ivr.definitions.write, {
          organizationId: caller.organizationId,
          caller,
          id: params.id,
          kind,
          ...(kind === "create"
            ? { webhookSecret: createWebhookSecret() }
            : {}),
          body: JSON.stringify(objectBody(body)),
        }),
      }),
    })
  apiRoute(http, {
    method: "GET",
    path: "/ivrs",
    scope: { resource: "ivrs", access: "read" },
    handler: async (ctx, { caller, query }) => ({
      body: await ctx.runQuery(internal.ivr.definitions.list, {
        organizationId: caller.organizationId,
        caller,
        ...listParams(query),
      }),
    }),
  })
  apiRoute(http, {
    method: "GET",
    path: "/ivrs/{id}",
    scope: { resource: "ivrs", access: "read" },
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runQuery(internal.ivr.definitions.get, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
      }),
    }),
  })
  apiRoute(http, {
    method: "POST",
    path: "/ivrs/{id}/validate",
    scope: { resource: "ivrs", access: "read" },
    handler: async (ctx, { caller, params, body }) => ({
      body: await ctx.runQuery(internal.ivr.definitions.validate, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
        body: JSON.stringify(objectBody(body)),
      }),
    }),
  })
  apiRoute(http, {
    method: "POST",
    path: "/ivrs/{id}/render",
    scope: { resource: "ivrs", access: "write" },
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runMutation(internal.ivr.renderState.retry, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
      }),
    }),
  })
}
