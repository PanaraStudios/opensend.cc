"use node"
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
    if (!row.storageId) {
      const result = await s3.send(new GetObjectCommand(object))
      if (!result.Body) throw new Error("Inbound object body is missing")
      const reader = result.Body.transformToWebStream().getReader()
      const chunks: Uint8Array<ArrayBuffer>[] = []
      let size = 0
      try {
        if ((result.ContentLength ?? 0) > MAX_INBOUND_BYTES)
          throw new RangeError("Inbound message exceeds 40 MiB")
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > MAX_INBOUND_BYTES)
            throw new RangeError("Inbound message exceeds 40 MiB")
          chunks.push(new Uint8Array(chunk.value))
        }
      } catch (error) {
        await reader.cancel()
        if (!(error instanceof RangeError)) throw error
        await ctx.runMutation(internal.ses.inboundMessages.reject, { id })
        return null
      } finally {
        reader.releaseLock()
      }
      const storageId = await ctx.storage.store(
        new Blob(chunks, { type: "message/rfc822" })
      )
      // The mutation also deletes a redundant file from concurrent delivery.
      await ctx.runMutation(internal.ses.inboundMessages.stored, {
        id,
        storageId,
        size,
      })
    }
    await s3.send(new DeleteObjectCommand(object))
    await ctx.runMutation(internal.ses.inboundMessages.deleted, { id })
    return null
  },
})
