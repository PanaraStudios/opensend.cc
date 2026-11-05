"use node"
import { storeFile } from "../storage/objects"
import { Readable } from "node:stream"
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { connectionClients } from "./aws"

export const MAX_INBOUND_BYTES = 40 * 1024 * 1024

/** S3 is only a drop box. Persist the file and its pointer before deleting
    the object; retries after that point perform only the deletion. */
export const transfer = internalAction({
  args: { id: v.id("inboundMessages") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const row = await ctx.runQuery(internal.ses.inboundMessages.get, { id })
    if (!row || row.deletedFromS3At !== undefined || row.rejected) return null
    if (row.objectKey !== `${row.domainId}/${row.sesMessageId}`)
      throw new Error("Inbound object does not belong to this domain")
    const installation = await ctx.runQuery(
      internal.installation.connection,
      {}
    )
    const { s3 } = connectionClients(installation, row.region)
    const object = {
      Bucket: row.bucket,
      Key: row.objectKey,
      ExpectedBucketOwner: installation.accountId,
    }
    if (!row.storageId && !row.fileId) {
      const result = await s3.send(new GetObjectCommand(object))
      if (!result.Body) throw new Error("Inbound object body is missing")
      if ((result.ContentLength ?? 0) > MAX_INBOUND_BYTES) {
        await ctx.runMutation(internal.ses.inboundMessages.reject, { id })
        return null
      }
      try {
        const file = await storeFile(ctx, {
          organizationId: row.organizationId,
          feature: "inbound",
          contentType: "message/rfc822",
          body: Readable.fromWeb(
            result.Body.transformToWebStream() as import("node:stream/web").ReadableStream<Uint8Array>
          ),
          size: result.ContentLength,
          maxBytes: MAX_INBOUND_BYTES,
        })
        const size = file.fileId
          ? (await ctx.runQuery(internal.storage.files.get, {
              id: file.fileId,
            }))!.size
          : (await ctx.storage.get(file.storageId!))!.size
        await ctx.runMutation(internal.ses.inboundMessages.stored, {
          id,
          ...file,
          size,
        })
      } catch (e) {
        if (!(e instanceof RangeError)) throw e
        await ctx.runMutation(internal.ses.inboundMessages.reject, { id })
        return null
      }
    }
    await s3.send(new DeleteObjectCommand(object))
    await ctx.runMutation(internal.ses.inboundMessages.deleted, { id })
    return null
  },
})
