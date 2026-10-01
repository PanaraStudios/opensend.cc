"use node"
import { storeFile } from "./storage/objects"
import { Readable } from "node:stream"
import { v, type Infer } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { callerValue, apiError } from "./api/caller"
import { attachmentValue } from "./tables/emails"
import { publicFetch } from "../lib/net/public-fetch"

export const fetchFile = internalAction({
  args: {
    caller: callerValue,
    path: v.string(),
    filename: v.string(),
    contentType: v.string(),
    contentId: v.optional(v.string()),
    maxBytes: v.number(),
  },
  returns: attachmentValue,
  handler: async (
    ctx,
    { caller, path, maxBytes, ...metadata }
  ): Promise<Infer<typeof attachmentValue>> => {
    await ctx.runQuery(internal.api.emails.authorizeSending, { caller })
    try {
      if (maxBytes < 0) throw new Error("Attachment limit exceeded")
      let url = path
      for (let redirects = 0; redirects <= 3; redirects++) {
        const response = await publicFetch(url, {
          maxBytes,
          timeoutMs: 60_000,
          stream: true,
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const target = response.headers.get("location")
          if (!target) break
          url = new URL(target, url).href
          continue
        }
        if (!response.ok) break
        if (!response.body) break
        const file = await storeFile(ctx, {
          organizationId: caller.organizationId,
          feature: "email",
          ...metadata,
          body: Readable.fromWeb(
            response.body as import("node:stream/web").ReadableStream<Uint8Array>
          ),
          maxBytes,
        })
        const size = file.fileId
          ? (await ctx.runQuery(internal.storage.files.get, {
              id: file.fileId,
            }))!.size
          : (await ctx.storage.get(file.storageId!))!.size
        return { ...metadata, ...file, size }
      }
    } catch {
      throw apiError(
        422,
        "invalid_attachment",
        "Attachment could not be downloaded from a public HTTPS URL within the size limit."
      )
    }
    throw apiError(
      422,
      "invalid_attachment",
      "Attachment URL returned an unsuccessful response."
    )
  },
})
