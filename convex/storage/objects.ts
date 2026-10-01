"use node"
import { Readable } from "node:stream"
import { createHash } from "node:crypto"
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { v } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { callerValue, invalid, type Caller } from "../api/caller"
import { objectStorageConfig, publicAssetUrl } from "./config"
import { fileReference, uploadInput } from "../tables/storage"
import { objectKey, verifyUpload } from "../../lib/storage/policy"
import { validateWhatsAppMedia } from "../../lib/meta/media"
import type { FileReference } from "./files"
import { uploadMedia } from "../channels/mediaUpload"
import { signedFileLink } from "../fileDownloads"

function client() {
  const config = objectStorageConfig()
  if (!config) throw new Error("Object storage is not configured")
  // Optional AWS checksums are not implemented by every S3-compatible provider.
  return {
    bucket: config.bucket,
    s3: new S3Client({
      ...config,
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  }
}
export async function presignPut(input: {
  key: string
  contentType: string
  size: number
  expiresIn: number
}) {
  const { s3, bucket } = client()
  return getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.size,
    }),
    {
      expiresIn: input.expiresIn,
      signableHeaders: new Set(["content-type", "content-length"]),
    }
  )
}
export async function presignGet(input: {
  key: string
  filename?: string
  disposition?: "inline" | "attachment"
  expiresIn: number
}) {
  const { s3, bucket } = client()
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: input.key,
      ...(input.filename
        ? {
            ResponseContentDisposition: `${input.disposition ?? "attachment"}; filename*=UTF-8''${encodeURIComponent(input.filename)}`,
          }
        : {}),
    }),
    { expiresIn: input.expiresIn }
  )
}
export async function headObject(key: string) {
  const { s3, bucket } = client()
  const result = await s3.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key })
  )
  return {
    size: result.ContentLength ?? -1,
    contentType: result.ContentType ?? "",
  }
}
export async function deleteObject(key: string) {
  const { s3, bucket } = client()
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
/** At most two 5 MiB parts in flight; never buffer a complete remote file. */
export async function putStream(
  key: string,
  readable: AsyncIterable<Uint8Array>,
  options: { contentType: string; size?: number; maxBytes?: number }
) {
  const { s3, bucket } = client()
  const hash = createHash("sha256")
  let size = 0
  const body = Readable.from(
    (async function* () {
      for await (const chunk of readable) {
        size += chunk.byteLength
        if (size > (options.maxBytes ?? options.size ?? 100 * 1024 * 1024))
          throw new RangeError("File exceeds storage size limit")
        hash.update(chunk)
        yield chunk
      }
      if (options.size !== undefined && size !== options.size)
        throw new Error("File size does not match")
    })()
  )
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      ...(options.size !== undefined ? { ContentLength: options.size } : {}),
    },
    queueSize: 2,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false,
  })
  try {
    await upload.done()
  } catch (e) {
    body.destroy()
    throw e
  }
  return { size, sha256: hash.digest("hex") }
}

export async function storeFile(
  ctx: ActionCtx,
  input: {
    organizationId: string
    feature: string
    accountId?: Id<"channelAccounts">
    filename?: string
    contentType: string
    body: Blob | AsyncIterable<Uint8Array>
    size?: number
    maxBytes?: number
  }
): Promise<FileReference> {
  const key = objectStorageConfig()
    ? objectKey(input.organizationId, input.feature, crypto.randomUUID())
    : undefined
  let storageId: Id<"_storage"> | undefined
  try {
    let size: number, sha256: string | undefined
    if (key) {
      const result = await putStream(
        key,
        input.body instanceof Blob
          ? Readable.fromWeb(
              input.body.stream() as import("node:stream/web").ReadableStream<Uint8Array>
            )
          : input.body,
        input
      )
      size = result.size
      sha256 = result.sha256
    } else {
      let blob: Blob
      if (input.body instanceof Blob) blob = input.body
      else {
        const chunks: Uint8Array<ArrayBuffer>[] = []
        size = 0
        for await (const chunk of input.body) {
          size += chunk.byteLength
          if (size > (input.maxBytes ?? 100 * 1024 * 1024))
            throw new RangeError("File exceeds storage size limit")
          chunks.push(new Uint8Array(chunk))
        }
        blob = new Blob(chunks, { type: input.contentType })
      }
      size = blob.size
      storageId = await ctx.storage.store(blob)
      return { storageId }
    }
    const fileId: Id<"storedFiles"> = await ctx.runMutation(
      internal.storage.files.insert,
      {
        organizationId: input.organizationId,
        feature: input.feature,
        accountId: input.accountId,
        filename: input.filename,
        contentType: input.contentType,
        provider: key ? "object" : "convex",
        key,
        storageId,
        size,
        sha256,
      }
    )
    return { fileId }
  } catch (e) {
    if (key) await deleteObject(key)
    if (storageId) await ctx.storage.delete(storageId)
    throw e
  }
}
export async function readFile(
  ctx: ActionCtx,
  ref: FileReference
): Promise<Blob | null> {
  if (!ref.fileId) return ref.storageId ? ctx.storage.get(ref.storageId) : null
  const row = await ctx.runQuery(internal.storage.files.get, { id: ref.fileId })
  if (!row || row.state !== "ready") return null
  if (row.provider === "convex")
    return row.storageId ? ctx.storage.get(row.storageId) : null
  const { s3, bucket } = client()
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: row.key })
  )
  if (!result.Body) return null
  return new Blob([new Uint8Array(await result.Body.transformToByteArray())], {
    type: row.contentType,
  })
}

export const url = internalAction({
  args: {
    ...fileReference,
    filename: v.optional(v.string()),
    disposition: v.optional(
      v.union(v.literal("inline"), v.literal("attachment"))
    ),
    expiresIn: v.optional(v.number()),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args): Promise<string | null> => {
    if (!args.fileId)
      return args.storageId ? ctx.storage.getUrl(args.storageId) : null
    const row = await ctx.runQuery(internal.storage.files.get, {
      id: args.fileId,
    })
    if (!row || row.state !== "ready") return null
    if (row.provider === "object" && row.feature === "asset" && row.key) {
      const publicUrl = publicAssetUrl(row.key)
      if (publicUrl) return publicUrl
    }
    return row.provider === "convex"
      ? row.storageId
        ? ctx.storage.getUrl(row.storageId)
        : null
      : presignGet({
          key: row.key!,
          filename: args.filename ?? row.filename,
          disposition: args.disposition,
          expiresIn: args.expiresIn ?? 600,
        })
  },
})
export const remove = internalAction({
  args: {
    id: v.id("storedFiles"),
    key: v.optional(v.string()),
    pendingKey: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { id } = args
    const existing = await ctx.runQuery(internal.storage.files.deletion, { id })
    if (existing && existing.state !== "deleting") return null
    const row = existing ?? args
    if (row.key) await deleteObject(row.key)
    if (row.pendingKey) await deleteObject(row.pendingKey)
    if (row.storageId) await ctx.storage.delete(row.storageId)
    if (existing)
      await ctx.runMutation(internal.storage.files.removeRow, { id })
    return null
  },
})
const actor = { organizationId: v.string(), caller: v.optional(callerValue) }
async function beginUpload(
  ctx: ActionCtx,
  args: {
    organizationId: string
    caller?: Caller
    input: typeof uploadInput.type
  }
): Promise<{
  id: Id<"storedFiles">
  upload_url: string
  expires_at: string
  provider: "convex" | "object"
}> {
  const row: Doc<"storedFiles"> = await ctx.runMutation(
    internal.storage.files.createUpload,
    args
  )
  if (row.pendingKey)
    await ctx.scheduler.runAfter(
      Math.max(0, row.expiresAt! - Date.now()) + 60_000,
      internal.storage.objects.removePending,
      { key: row.pendingKey }
    )
  const upload_url =
    row.provider === "object"
      ? await presignPut({
          key: row.pendingKey!,
          contentType: row.contentType,
          size: row.size,
          expiresIn: Math.max(
            1,
            Math.floor((row.expiresAt! - Date.now()) / 1000)
          ),
        })
      : (
          await signedFileLink(ctx, "/storage-upload/", "storage-upload", {
            fileId: row._id,
          })
        ).download_url
  return {
    id: row._id,
    upload_url,
    expires_at: new Date(row.expiresAt!).toISOString(),
    provider: row.provider,
  }
}
export const begin = internalAction({
  args: { ...actor, input: uploadInput },
  returns: v.object({
    id: v.id("storedFiles"),
    upload_url: v.string(),
    expires_at: v.string(),
    provider: v.union(v.literal("convex"), v.literal("object")),
  }),
  handler: beginUpload,
})
async function completeFile(
  ctx: ActionCtx,
  args: {
    organizationId: string
    caller?: Caller
    id: Id<"storedFiles">
    storageId?: Id<"_storage">
  }
): Promise<{ id: Id<"storedFiles"> }> {
  const row: Doc<"storedFiles"> = await ctx.runMutation(
    internal.storage.files.beginComplete,
    args
  )
  if (row.state === "ready") return { id: row._id }
  try {
    if (row.provider === "object") {
      verifyUpload(row, await headObject(row.pendingKey!))
      // A still-valid PUT cannot overwrite the immutable, finalized object.
      const { s3, bucket } = client()
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: row.key,
          CopySource: `${encodeURIComponent(bucket)}/${row.pendingKey!.split("/").map(encodeURIComponent).join("/")}`,
        })
      )
      verifyUpload(row, await headObject(row.key!))
      if (
        row.feature === "whatsapp" &&
        row.contentType.startsWith("image/webp")
      ) {
        const result = await s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: row.key,
            Range: "bytes=0-31",
          })
        )
        const bytes = await result.Body!.transformToByteArray()
        const animated =
          new TextDecoder().decode(bytes.subarray(12, 16)) === "ANIM" ||
          (new TextDecoder().decode(bytes.subarray(12, 16)) === "VP8X" &&
            (bytes[20] & 2) !== 0)
        if (row.size > (animated ? 500 : 100) * 1024)
          throw new Error("Sticker exceeds its size limit")
      }
    } else {
      const blob = row.storageId ? await ctx.storage.get(row.storageId) : null
      if (!blob) throw new Error("Uploaded file is missing")
      verifyUpload(row, { size: blob.size, contentType: blob.type })
      if (row.feature === "whatsapp")
        validateWhatsAppMedia(
          new Uint8Array(await blob.arrayBuffer()),
          row.contentType
        )
    }
    const id = await ctx.runMutation(internal.storage.files.ready, {
      organizationId: args.organizationId,
      caller: args.caller,
      id: row._id,
    })
    // Pending objects are deleted after the PUT expires by the expiry sweep.
    if (row.pendingKey)
      await ctx.scheduler.runAfter(
        Math.max(0, row.expiresAt! - Date.now()) + 60_000,
        internal.storage.objects.removePending,
        { key: row.pendingKey }
      )
    return { id }
  } catch (e) {
    await ctx.runMutation(internal.storage.files.discard, { fileId: row._id })
    throw invalid(e instanceof Error ? e.message : "Upload verification failed")
  }
}
export const complete = internalAction({
  args: {
    ...actor,
    id: v.id("storedFiles"),
    storageId: v.optional(v.id("_storage")),
  },
  returns: v.object({ id: v.id("storedFiles") }),
  handler: completeFile,
})
export const removePending = internalAction({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (_ctx, { key }) => {
    await deleteObject(key)
    return null
  },
})
export const createUpload = action({
  args: { organizationId: v.string(), input: uploadInput },
  handler: (
    ctx,
    args
  ): Promise<{
    id: Id<"storedFiles">
    upload_url: string
    expires_at: string
    provider: "object" | "convex"
  }> => beginUpload(ctx, args),
})
export const completeUpload = action({
  args: {
    organizationId: v.string(),
    id: v.id("storedFiles"),
    storageId: v.optional(v.id("_storage")),
  },
  handler: (ctx, args): Promise<{ id: Id<"storedFiles"> }> =>
    completeFile(ctx, args),
})
/** Existing HTTP multipart/base64 paths first stage a local file to avoid action argument limits. */
export const adopt = internalAction({
  args: {
    organizationId: v.string(),
    feature: v.string(),
    accountId: v.optional(v.id("channelAccounts")),
    storageId: v.id("_storage"),
    contentType: v.string(),
    filename: v.optional(v.string()),
  },
  returns: v.object(fileReference),
  handler: async (ctx, args): Promise<FileReference> => {
    const blob = await ctx.storage.get(args.storageId)
    if (!blob) throw new Error("Staged file missing")
    if (!objectStorageConfig()) return { storageId: args.storageId }
    try {
      return await storeFile(ctx, { ...args, body: blob, size: blob.size })
    } finally {
      await ctx.storage.delete(args.storageId)
    }
  },
})
export const importText = internalAction({
  args: {
    organizationId: v.string(),
    caller: callerValue,
    id: v.id("storedFiles"),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const row = await ctx.runQuery(internal.storage.files.authorized, args)
    if (
      row.feature !== "import" ||
      row.state !== "ready" ||
      row.size > 256 * 1024
    )
      throw invalid("CSV upload is not ready or exceeds 256 KB")
    const file = await readFile(ctx, { fileId: row._id })
    if (!file) throw invalid("CSV file is missing")
    return file.text()
  },
})

/** Refresh storage links on every send attempt, including template headers. */
export async function mediaLinks(
  ctx: ActionCtx,
  value: unknown,
  organizationId: string
): Promise<unknown> {
  if (Array.isArray(value))
    return Promise.all(
      value.map((item) => mediaLinks(ctx, item, organizationId))
    )
  if (!value || typeof value !== "object") return value
  const node = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(node))
    result[key] = await mediaLinks(ctx, item, organizationId)
  if (typeof node.id === "string") {
    // Unknown ids are Meta ids. Local ids are resolved without exposing other teams.
    const row = await ctx.runQuery(internal.storage.files.byString, {
      id: node.id,
    })
    if (row) {
      if (row.organizationId !== organizationId || row.state !== "ready")
        throw invalid("Media is unavailable")
      if (row.provider === "object") {
        delete result.id
        result.link = await presignGet({ key: row.key!, expiresIn: 3600 })
      } else {
        // Local direct uploads use the existing Meta multipart fallback at send time.
        const target = await ctx.runQuery(internal.storage.files.mediaTarget, {
          id: row._id,
        })
        if (!target || !row.storageId) throw invalid("Media is unavailable")
        result.id = await uploadMedia(ctx, {
          caller: {
            organizationId,
            permission: "full_access",
            name: "storage",
          },
          target,
          storageId: row.storageId,
          filename: row.filename ?? "attachment",
          contentType: row.contentType,
          record: false,
        })
      }
    }
  }
  return result
}
