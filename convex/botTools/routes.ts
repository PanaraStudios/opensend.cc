import type { HttpRouter } from "convex/server"
import { internal } from "../_generated/api"
import { apiRoute, objectBody, listParams } from "../api/route"
export function registerBotToolRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/bot-tools",
    scope: { resource: "bot_tools", access: "read" },
    handler: async (ctx, { caller, query }) => ({
      body: await ctx.runQuery(internal.botTools.resources.list, {
        organizationId: caller.organizationId,
        caller,
        ...listParams(query),
      }),
    }),
  })
  for (const method of ["POST", "PATCH"] as const)
    apiRoute(http, {
      method,
      path: method === "POST" ? "/bot-tools" : "/bot-tools/{id}",
      scope: { resource: "bot_tools", access: "write" },
      sensitiveBody: true,
      maxBody: 100000,
      handler: async (ctx, { caller, params, body }) => ({
        body: await ctx.runMutation(internal.botTools.resources.save, {
          organizationId: caller.organizationId,
          caller,
          id: method === "PATCH" ? params.id : undefined,
          input: objectBody(body),
        }),
      }),
    })
  apiRoute(http, {
    method: "GET",
    path: "/bot-tools/{id}",
    scope: { resource: "bot_tools", access: "read" },
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runQuery(internal.botTools.resources.get, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
      }),
    }),
  })
  apiRoute(http, {
    method: "DELETE",
    path: "/bot-tools/{id}",
    scope: { resource: "bot_tools", access: "write" },
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runMutation(internal.botTools.resources.remove, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
      }),
    }),
  })
  apiRoute(http, {
    method: "POST",
    path: "/bot-tools/{id}/test",
    scope: { resource: "bot_tools", access: "write" },
    sensitiveBody: true,
    handler: async (ctx, { caller, params, body }) => ({
      body: await ctx.runAction(internal.botTools.execute.test, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
        input: objectBody(body),
      }),
    }),
  })
}
