import type { HttpRouter } from "convex/server"
import { internal } from "../_generated/api"
import { apiRoute, objectBody, listParams } from "./route"
export function registerVoiceRoutes(http: HttpRouter) {
  const read = { resource: "voice_bots", access: "read" } as const,
    write = { resource: "voice_bots", access: "write" } as const
  for (const [path, providers] of [
    ["voice-bots", false],
    ["voice-providers", true],
  ] as const) {
    apiRoute(http, {
      method: "GET",
      path: `/${path}`,
      scope: providers ? { resource: "voice_providers", access: "read" } : read,
      handler: async (ctx, { caller, query }) => ({
        body: await ctx.runQuery(internal.voice.resources.list, {
          organizationId: caller.organizationId,
          caller,
          providers,
          ...listParams(query),
        }),
      }),
    })
    apiRoute(http, {
      method: "POST",
      path: `/${path}`,
      scope: providers
        ? { resource: "voice_providers", access: "write" }
        : write,
      sensitiveBody: providers,
      maxBody: 24000,
      handler: async (ctx, { caller, body }) => ({
        body: providers
          ? await ctx.runMutation(internal.voice.resources.credential, {
              organizationId: caller.organizationId,
              caller,
              input: objectBody(body),
            })
          : await ctx.runMutation(internal.voice.resources.save, {
              organizationId: caller.organizationId,
              caller,
              input: objectBody(body),
            }),
      }),
    })
    apiRoute(http, {
      method: "DELETE",
      path: `/${path}/{id}`,
      scope: providers
        ? { resource: "voice_providers", access: "write" }
        : write,
      handler: async (ctx, { caller, params }) => ({
        body: await ctx.runMutation(internal.voice.resources.remove, {
          organizationId: caller.organizationId,
          caller,
          id: params.id,
          providers,
        }),
      }),
    })
  }
  apiRoute(http, {
    method: "GET",
    path: "/voice-providers/elevenlabs/voices",
    scope: { resource: "voice_providers", access: "read" },
    handler: async (ctx, { caller, query }) => ({
      body: await ctx.runAction(internal.voice.elevenlabs.refresh, {
        organizationId: caller.organizationId,
        caller,
        credentialId: query.get("credential_id") || undefined,
        force: query.get("refresh") === "true",
      }),
    }),
  })
  apiRoute(http, {
    method: "GET",
    path: "/voice-bots/{id}",
    scope: read,
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runQuery(internal.voice.resources.get, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
      }),
    }),
  })
  apiRoute(http, {
    method: "PATCH",
    path: "/voice-bots/{id}",
    scope: write,
    maxBody: 24000,
    handler: async (ctx, { caller, params, body }) => ({
      body: await ctx.runMutation(internal.voice.resources.save, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
        input: objectBody(body),
      }),
    }),
  })
  apiRoute(http, {
    method: "GET",
    path: "/whatsapp/calls/{id}/transcript",
    scope: { resource: "calling", access: "read" },
    handler: async (ctx, { caller, params, query }) => ({
      body: await ctx.runQuery(internal.voice.resources.transcript, {
        organizationId: caller.organizationId,
        caller,
        id: params.id,
        ...listParams(query),
      }),
    }),
  })
}
