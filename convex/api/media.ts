import type { HttpRouter } from "convex/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { apiRoute, objectBody, stringField } from "./route"
import { invalid } from "./caller"
import { STORAGE_USES, type StorageUse } from "../../lib/storage/policy"
import { uploadInput } from "../tables/storage"
import { v } from "convex/values"
import { internalMutation } from "../_generated/server"
import { callerValue, requireCaller } from "./caller"
import { idempotent } from "./idempotency"

export const record = internalMutation({
  args: { caller: callerValue, reply: v.any() },
  returns: v.null(),
  handler: async (ctx, { caller, reply }) => {
    await requireCaller(ctx, caller)
    await idempotent(
      ctx,
      caller,
      async () => reply,
      (body) => ({ body })
    )
    return null
  },
})
export function registerMediaRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/media/uploads",
    scope: { resource: "media", access: "write" },
    handler: async (ctx, { caller, body }) => {
      const input = objectBody(body)
      const use = stringField(input, "use", true)!
      if (!STORAGE_USES.includes(use as StorageUse) || use === "asset")
        throw invalid("use must be whatsapp, email, or import")
      if (typeof input.size !== "number") throw invalid("size must be a number")
      if (input.animated !== undefined && typeof input.animated !== "boolean")
        throw invalid("animated must be a boolean")
      const args: typeof uploadInput.type = {
        use: use as StorageUse,
        size: input.size,
        contentType: stringField(input, "content_type", true)!,
        filename: stringField(input, "filename", true)!,
        from: stringField(input, "from"),
        animated: input.animated as boolean | undefined,
      }
      const reply = await ctx.runAction(internal.storage.objects.begin, {
        organizationId: caller.organizationId,
        caller,
        input: args,
      })
      await ctx.runMutation(internal.api.media.record, { caller, reply })
      return { body: reply }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/media/uploads/{id}/complete",
    scope: { resource: "media", access: "write" },
    handler: async (ctx, { caller, params, body }) => {
      const input = objectBody(body)
      const reply = await ctx.runAction(internal.storage.objects.complete, {
        organizationId: caller.organizationId,
        caller,
        id: params.id as Id<"storedFiles">,
        storageId: stringField(input, "storage_id") as
          Id<"_storage"> | undefined,
      })
      await ctx.runMutation(internal.api.media.record, { caller, reply })
      return { body: reply }
    },
  })
}
