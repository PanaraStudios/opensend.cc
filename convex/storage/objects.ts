"use node"
import { v } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { callerValue, invalid, type Caller } from "../api/caller"
import { fileReference, uploadInput } from "../tables/storage"
import { verifyUpload } from "../../lib/storage/policy"
import { validateWhatsAppMedia } from "../../lib/meta/media"
import type { FileReference } from "./files"
import { readFile } from "./urls"
export { readFile } from "./urls"
import { normalizeIvrAudio } from "./ivrAudio"
import { uploadMedia } from "../channels/mediaUpload"

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
  const maxBytes = input.maxBytes ?? 100 * 1024 * 1024
  let blob: Blob
  if (input.body instanceof Blob) blob = input.body
  else {
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let size = 0
    for await (const chunk of input.body) {
      size += chunk.byteLength
      if (size > maxBytes)
        throw new RangeError("File exceeds storage size limit")
      chunks.push(new Uint8Array(chunk))
    }
    blob = new Blob(chunks, { type: input.contentType })
  }
  if (blob.size > maxBytes)
    throw new RangeError("File exceeds storage size limit")
  if (input.size !== undefined && blob.size !== input.size)
    throw new Error("File size does not match")
  const storageId = await ctx.storage.store(blob)
  try {
    const fileId: Id<"storedFiles"> = await ctx.runMutation(
      internal.storage.files.insert,
      {
        organizationId: input.organizationId,
        feature: input.feature,
        accountId: input.accountId,
        filename: input.filename,
        contentType: input.contentType,
        storageId,
        size: blob.size,
      }
    )
    return { fileId, storageId }
  } catch (error) {
    await ctx.storage.delete(storageId)
    throw error
  }
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
    return row.storageId ? ctx.storage.getUrl(row.storageId) : null
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
  provider: "convex"
}> {
  const row: Doc<"storedFiles"> = await ctx.runMutation(
    internal.storage.files.createUpload,
    args
  )
  const upload_url = await ctx.storage.generateUploadUrl()
  return {
    id: row._id,
    upload_url,
    expires_at: new Date(row.expiresAt!).toISOString(),
    provider: "convex",
  }
}
export const begin = internalAction({
  args: { ...actor, input: uploadInput },
  returns: v.object({
    id: v.id("storedFiles"),
    upload_url: v.string(),
    expires_at: v.string(),
    provider: v.literal("convex"),
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
    const metadata = row.storageId
      ? await ctx.runQuery(internal.storage.files.metadata, {
          storageId: row.storageId,
        })
      : null
    if (!metadata) throw new Error("Uploaded file is missing")
    verifyUpload(row, {
      size: metadata.size,
      contentType: metadata.contentType ?? "",
    })
    // Size/type are verified from system metadata without loading large documents.
    if (
      row.feature === "whatsapp" &&
      row.contentType.split(";")[0].trim().toLowerCase() === "image/webp"
    ) {
      const blob = await ctx.storage.get(row.storageId!)
      if (!blob) throw new Error("Uploaded file is missing")
      validateWhatsAppMedia(
        new Uint8Array(await blob.arrayBuffer()),
        row.contentType.trim().toLowerCase()
      )
    }
    let normalized: { storageId: Id<"_storage">; size: number } | undefined
    if (row.feature === "ivr") {
      const original = await ctx.storage.get(row.storageId!)
      if (!original) throw new Error("Uploaded prompt is missing")
      const audio = await normalizeIvrAudio(original)
      normalized = {
        storageId: await ctx.storage.store(audio),
        size: audio.size,
      }
    }
    let id: Id<"storedFiles">
    try {
      id = await ctx.runMutation(internal.storage.files.ready, {
        organizationId: args.organizationId,
        caller: args.caller,
        id: row._id,
        normalized,
      })
    } catch (error) {
      if (normalized) await ctx.storage.delete(normalized.storageId)
      throw error
    }
    if (normalized)
      await ctx.storage.delete(row.storageId!).catch(() => undefined)
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
export const createUpload = action({
  args: { organizationId: v.string(), input: uploadInput },
  returns: v.object({
    id: v.id("storedFiles"),
    upload_url: v.string(),
    expires_at: v.string(),
    provider: v.literal("convex"),
  }),
  handler: (
    ctx,
    args
  ): Promise<{
    id: Id<"storedFiles">
    upload_url: string
    expires_at: string
    provider: "convex"
  }> => beginUpload(ctx, args),
})
export const completeUpload = action({
  args: {
    organizationId: v.string(),
    id: v.id("storedFiles"),
    storageId: v.optional(v.id("_storage")),
  },
  returns: v.object({ id: v.id("storedFiles") }),
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
    const metadata = await ctx.runQuery(internal.storage.files.metadata, {
      storageId: args.storageId,
    })
    if (!metadata) throw new Error("Staged file missing")
    if (args.feature === "ivr") {
      const original = await ctx.storage.get(args.storageId)
      if (!original) throw new Error("Staged prompt missing")
      try {
        return await storeFile(ctx, {
          organizationId: args.organizationId,
          feature: "ivr",
          filename: `${(args.filename ?? "prompt").replace(/\.[^.]+$/, "")}.wav`,
          contentType: "audio/wav",
          body: await normalizeIvrAudio(original),
          maxBytes: 16 * 1024 * 1024,
        })
      } finally {
        await ctx.storage.delete(args.storageId)
      }
    }
    try {
      const fileId: Id<"storedFiles"> = await ctx.runMutation(
        internal.storage.files.insert,
        {
          organizationId: args.organizationId,
          feature: args.feature,
          accountId: args.accountId,
          filename: args.filename,
          contentType: args.contentType,
          storageId: args.storageId,
          size: metadata.size,
        }
      )
      return { fileId, storageId: args.storageId }
    } catch (error) {
      await ctx.storage.delete(args.storageId)
      throw error
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

/** Upload stored media to Meta on every send attempt, including template headers. */
export async function mediaLinks(
  ctx: ActionCtx,
  value: unknown,
  organizationId: string,
  accountId?: Id<"channelAccounts">
): Promise<unknown> {
  if (Array.isArray(value))
    return Promise.all(
      value.map((item) => mediaLinks(ctx, item, organizationId, accountId))
    )
  if (!value || typeof value !== "object") return value
  const node = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(node))
    result[key] = await mediaLinks(ctx, item, organizationId, accountId)
  if (typeof node.id === "string") {
    // Unknown ids are Meta ids. Local ids are resolved without exposing other teams.
    const row = await ctx.runQuery(internal.storage.files.byString, {
      id: node.id,
    })
    if (row) {
      if (row.organizationId !== organizationId || row.state !== "ready")
        throw invalid("Media is unavailable")
      const target = await ctx.runQuery(internal.storage.files.mediaTarget, {
        id: row._id,
        accountId,
      })
      if (!target || !row.storageId) throw invalid("Media is unavailable")
      result.id = await uploadMedia(ctx, {
        caller: { organizationId, permission: "full_access", name: "storage" },
        target,
        storageId: row.storageId,
        filename: row.filename ?? "attachment",
        contentType: row.contentType,
        record: false,
      })
    }
  }
  return result
}
