import schema from "../schema"
import { stream } from "convex-helpers/server/stream"
import { idempotent } from "./idempotency"
import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import { internalMutation, internalQuery } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import {
  deleteKey,
  insertKey,
  patchKey,
  keyInput,
  keyView,
  mintToken,
  mintedValue,
  viewKey,
} from "../apiKeys"
import { callerValue, notFound, requireCaller } from "./caller"
import { cursorPage, listArgs } from "./paging"
import {
  apiRoute,
  apiTime,
  enumField,
  listParams,
  objectBody,
  stringField,
} from "./route"

export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({ has_more: v.boolean(), data: v.array(keyView) }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    const org = caller.organizationId
    const result = await cursorPage(
      page,
      async (id) => {
        const keyId = ctx.db.normalizeId("apiKeys", id)
        const key = keyId ? await ctx.db.get("apiKeys", keyId) : null
        return key?.organizationId === org ? key : null
      },
      (order) =>
        stream(ctx.db, schema)
          .query("apiKeys")
          .withIndex("by_organizationId", (q) => q.eq("organizationId", org))
          .order(order)
    )
    return {
      ...result,
      data: await Promise.all(result.data.map((key) => viewKey(ctx, key))),
    }
  },
})
export const create = internalMutation({
  args: {
    caller: callerValue,
    input: keyInput,
    minted: mintedValue,
    token: v.optional(v.string()),
  },
  returns: v.id("apiKeys"),
  handler: async (ctx, { caller, input, minted, token }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        return insertKey(ctx, caller.organizationId, input, minted, {
          name: caller.name,
        })
      },
      (id) => ({ status: 201, body: { id, token } })
    )
  },
})
export const update = internalMutation({
  args: { caller: callerValue, id: v.string(), name: v.string() },
  returns: v.id("apiKeys"),
  handler: async (ctx, { caller, id, name }) => {
    await requireCaller(ctx, caller)
    const keyId = ctx.db.normalizeId("apiKeys", id)
    const key = keyId ? await ctx.db.get("apiKeys", keyId) : null
    if (!key || key.organizationId !== caller.organizationId)
      throw notFound("API key")
    await patchKey(ctx, key, { name })
    return key._id
  },
})

export const remove = internalMutation({
  args: { caller: callerValue, id: v.string() },
  returns: v.union(v.null(), v.id("apiKeys")),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    const keyId = ctx.db.normalizeId("apiKeys", id)
    const key = keyId ? await ctx.db.get("apiKeys", keyId) : null
    if (!key || key.organizationId !== caller.organizationId) return null
    await deleteKey(ctx, key)
    return key._id
  },
})

/** `/api-keys`, as Resend documents it. Ids are Convex ids, not UUIDs. */
export function registerApiKeyRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/api-keys",
    permission: "full_access",
    handler: async (ctx, { caller, body }) => {
      const input = objectBody(body)
      const { token, ...minted } = await mintToken()
      const id: Id<"apiKeys"> = await ctx.runMutation(
        internal.api.keys.create,
        {
          caller,
          minted,
          token,
          input: {
            name: stringField(input, "name", true)!,
            permission:
              enumField(input, "permission", [
                "full_access",
                "sending_access",
              ]) ?? "full_access",
            domainId: stringField(input, "domain_id"),
          },
        }
      )
      return { status: 201, body: { id, token } }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/api-keys",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const page = await ctx.runQuery(internal.api.keys.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: {
          object: "list",
          has_more: page.has_more,
          data: page.data.map((key) => ({
            id: key._id,
            name: key.name,
            created_at: apiTime(key._creationTime),
            last_used_at:
              key.lastUsedAt === null ? null : apiTime(key.lastUsedAt),
          })),
        },
      }
    },
  })
  apiRoute(http, {
    method: "PATCH",
    path: "/api-keys/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params, body }) => ({
      body: {
        object: "api_key",
        id: await ctx.runMutation(internal.api.keys.update, {
          caller,
          id: params.id,
          name: stringField(objectBody(body), "name", true)!,
        }),
      },
    }),
  })
  apiRoute(http, {
    method: "DELETE",
    path: "/api-keys/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params }) => {
      const id = await ctx.runMutation(internal.api.keys.remove, {
        caller,
        id: params.id,
      })
      if (!id) throw notFound("API key")
      return { body: { object: "api_key", id, deleted: true } }
    },
  })
}
