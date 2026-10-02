import type { HttpRouter } from "convex/server"
import { internal } from "../_generated/api"
import { apiRoute, objectBody, listParams } from "../api/route"
import { invalid } from "../api/caller"
import type { Id } from "../_generated/dataModel"
export function registerKnowledgeRoutes(http: HttpRouter) {
  for (const document of [false, true]) {
    const path = document
      ? "/knowledge-bases/{knowledgeBaseId}/documents"
      : "/knowledge-bases"
    apiRoute(http, {
      method: "GET",
      path,
      scope: { resource: "knowledge", access: "read" },
      handler: async (ctx, { caller, params, query }) => ({
        body: await ctx.runQuery(internal.knowledge.resources.list, {
          organizationId: caller.organizationId,
          caller,
          knowledgeBaseId: document ? params.knowledgeBaseId : undefined,
          ...listParams(query),
        }),
      }),
    })
    for (const method of ["POST", "PATCH"] as const)
      apiRoute(http, {
        method,
        path: method === "PATCH" ? `${path}/{id}` : path,
        scope: { resource: "knowledge", access: "write" },
        maxBody: 850000,
        sensitiveBody: true,
        handler: async (ctx, { caller, params, body }) => ({
          body: await ctx.runMutation(internal.knowledge.resources.save, {
            organizationId: caller.organizationId,
            caller,
            id: method === "PATCH" ? params.id : undefined,
            knowledgeBaseId: document ? params.knowledgeBaseId : undefined,
            input: objectBody(body),
          }),
        }),
      })
    apiRoute(http, {
      method: "GET",
      path: `${path}/{id}`,
      scope: { resource: "knowledge", access: "read" },
      handler: async (ctx, { caller, params }) => ({
        body: await ctx.runQuery(internal.knowledge.resources.get, {
          organizationId: caller.organizationId,
          caller,
          id: params.id,
          document,
          knowledgeBaseId: document ? params.knowledgeBaseId : undefined,
        }),
      }),
    })
    apiRoute(http, {
      method: "DELETE",
      path: `${path}/{id}`,
      scope: { resource: "knowledge", access: "write" },
      handler: async (ctx, { caller, params }) => ({
        body: await ctx.runMutation(internal.knowledge.resources.remove, {
          organizationId: caller.organizationId,
          caller,
          id: params.id,
          document,
          knowledgeBaseId: document ? params.knowledgeBaseId : undefined,
        }),
      }),
    })
  }
  apiRoute(http, {
    method: "POST",
    path: "/knowledge-bases/{id}/search",
    scope: { resource: "knowledge", access: "read" },
    handler: async (ctx, { caller, params, body }) => {
      const input = objectBody(body)
      if (
        typeof input.query !== "string" ||
        (input.limit !== undefined && typeof input.limit !== "number") ||
        Object.keys(input).some((k) => !["query", "limit"].includes(k))
      )
        throw invalid("Supply a query and optional limit")
      return {
        body: await ctx.runAction(internal.knowledge.search.search, {
          organizationId: caller.organizationId,
          caller,
          knowledgeBaseIds: [params.id as Id<"knowledgeBases">],
          query: input.query,
          limit: input.limit as number | undefined,
        }),
      }
    },
  })
}
