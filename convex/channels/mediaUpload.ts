"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { callerValue, invalid, apiError } from "../api/caller"
import { graph } from "../meta/graph"
import { decryptSecret } from "../secrets"
import {
  whatsappMediaMultipart,
  validateWhatsAppMedia,
} from "../../lib/meta/media"
import { object, string } from "../../lib/meta/webhooks"
import { MetaError } from "../../lib/meta/errors"

export const upload = internalAction({
  args: {
    caller: callerValue,
    from: v.optional(v.string()),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const target = await ctx.runQuery(internal.api.whatsapp.uploadTarget, {
      caller: args.caller,
      from: args.from,
    })
    const file = await ctx.storage.get(args.storageId)
    if (!file) throw invalid("Media file not found.")
    const bytes = new Uint8Array(await file.arrayBuffer())
    try {
      validateWhatsAppMedia(bytes, args.contentType)
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : "Invalid media.")
    }
    let result: unknown
    try {
      result = await graph({
        method: "POST",
        path: `${target.phoneNumberId}/media`,
        version: target.version,
        token: await decryptSecret(target.encryptedToken),
        body: whatsappMediaMultipart(
          bytes,
          args.contentType,
          args.filename,
          `opensend_${crypto.randomUUID().replaceAll("-", "")}`
        ),
      })
    } catch (error) {
      if (!(error instanceof MetaError)) throw error
      if (error.action === "token_invalid")
        await ctx.runMutation(internal.channels.mediaUploads.tokenInvalid, {
          caller: args.caller,
          accountId: target.accountId,
          error: error.message,
        })
      throw apiError(
        error.action === "retry" || error.action === "retry_after" ? 503 : 422,
        "meta_api_error",
        error.message
      )
    }
    const id = string(object(result).id)
    if (!id)
      throw apiError(502, "meta_api_error", "Meta did not return a media id.")
    await ctx.runMutation(internal.channels.mediaUploads.complete, {
      caller: args.caller,
      accountId: target.accountId,
      storageId: args.storageId,
      mediaId: id,
      filename: args.filename,
      contentType: args.contentType,
      size: bytes.byteLength,
    })
    return id
  },
})
