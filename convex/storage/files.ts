import { v } from "convex/values"
import { internalMutation, internalQuery, query } from "../_generated/server"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import schema from "../schema"
import { requireTeam, requireInstallationAdmin } from "../access"
import { callerValue, requireCaller, invalid, type Caller } from "../api/caller"
import { retirement } from "../teamLifecycle"
import { fileReference, uploadInput } from "../tables/storage"
import { UPLOAD_TTL, validateUpload } from "../../lib/storage/policy"
import { resolveChannelAccount } from "../channels/messages"
import { findMetaApp } from "../meta/app"

export type FileReference = {
  fileId?: Id<"storedFiles">
  storageId?: Id<"_storage">
}
const actor = { organizationId: v.string(), caller: v.optional(callerValue) }
async function authorize(
  ctx: QueryCtx,
  organizationId: string,
  caller?: Caller
) {
  if (caller) {
    if (caller.organizationId !== organizationId)
      throw invalid("File not found")
    await requireCaller(ctx, caller)
  } else await requireTeam(ctx, organizationId, "write")
  if (await retirement(ctx, organizationId))
    throw invalid("This team is being retired")
}

export const createUpload = internalMutation({
  args: { ...actor, input: uploadInput },
  returns: schema.doc("storedFiles"),
  handler: async (ctx, { organizationId, caller, input }) => {
    await authorize(ctx, organizationId, caller)
    try {
      validateUpload(input)
    } catch (e) {
      throw invalid((e as Error).message)
    }
    if (!input.filename || input.filename.length > 1024)
      throw invalid("Invalid filename")
    const account =
      input.use === "whatsapp"
        ? await resolveChannelAccount(
            ctx,
            organizationId,
            input.from,
            "whatsapp"
          )
        : null
    if (input.use === "asset") await requireTeam(ctx, organizationId, "admin")
    const id = await ctx.db.insert("storedFiles", {
      organizationId,
      provider: "convex",
      size: input.size,
      contentType: input.contentType,
      filename: input.filename,
      feature: input.use,
      state: "pending",
      expiresAt: Date.now() + UPLOAD_TTL,
      accountId: account?._id,
      animated: input.animated,
    })
    return (await ctx.db.get("storedFiles", id))!
  },
})
export const authorized = internalQuery({
  args: { ...actor, id: v.id("storedFiles") },
  returns: schema.doc("storedFiles"),
  handler: async (ctx, { organizationId, caller, id }) => {
    await authorize(ctx, organizationId, caller)
    const file = await ctx.db.get("storedFiles", id)
    if (
      !file ||
      file.organizationId !== organizationId ||
      file.state === "deleting"
    )
      throw invalid("File not found")
    return file
  },
})
export const get = internalQuery({
  args: { id: v.id("storedFiles") },
  returns: v.union(v.null(), schema.doc("storedFiles")),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("storedFiles", id)
    return row && !(await retirement(ctx, row.organizationId)) ? row : null
  },
})
export const byString = internalQuery({
  args: { id: v.string() },
  returns: v.union(v.null(), schema.doc("storedFiles")),
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("storedFiles", id)
    return normalized ? ctx.db.get("storedFiles", normalized) : null
  },
})
export const mediaTarget = internalQuery({
  args: {
    id: v.id("storedFiles"),
    accountId: v.optional(v.id("channelAccounts")),
  },
  returns: v.union(
    v.null(),
    v.object({
      accountId: v.id("channelAccounts"),
      phoneNumberId: v.string(),
      encryptedToken: v.string(),
      version: v.string(),
    })
  ),
  handler: async (
    ctx,
    { id, accountId }
  ): Promise<{
    accountId: Id<"channelAccounts">
    phoneNumberId: string
    encryptedToken: string
    version: string
  } | null> => {
    const row = await ctx.db.get("storedFiles", id)
    if (
      !row ||
      !(row.feature === "template" ? accountId : row.accountId) ||
      (row.feature !== "template" &&
        accountId &&
        row.accountId !== accountId) ||
      row.state !== "ready" ||
      (await retirement(ctx, row.organizationId))
    )
      return null
    const account = await resolveChannelAccount(
      ctx,
      row.organizationId,
      row.feature === "template" ? accountId : row.accountId,
      "whatsapp"
    )
    const connection = await ctx.db.get("metaConnections", account.connectionId)
    const app = await findMetaApp(ctx)
    return app && connection
      ? {
          accountId: account._id,
          phoneNumberId: account.externalId,
          encryptedToken: account.encryptedToken ?? connection.encryptedToken,
          version: app.graphVersion,
        }
      : null
  },
})

export const beginComplete = internalMutation({
  args: {
    ...actor,
    id: v.id("storedFiles"),
    storageId: v.optional(v.id("_storage")),
  },
  returns: schema.doc("storedFiles"),
  handler: async (ctx, args) => {
    await authorize(ctx, args.organizationId, args.caller)
    const row = await ctx.db.get("storedFiles", args.id)
    if (
      !row ||
      row.organizationId !== args.organizationId ||
      row.state === "deleting"
    )
      throw invalid("File not found")
    if (row.state === "ready") {
      if (args.storageId && args.storageId !== row.storageId)
        throw invalid("Unexpected file")
      return row
    }
    if (!row.expiresAt || row.expiresAt <= Date.now())
      throw invalid("Upload expired")
    if (row.state === "completing")
      throw invalid("Upload completion is already in progress")
    const storageId = row.storageId ?? args.storageId
    if (
      !storageId ||
      (row.storageId && args.storageId && row.storageId !== args.storageId)
    )
      throw invalid("Provide storage_id from the Convex upload response")
    const metadata = await ctx.db.system.get("_storage", storageId)
    if (!metadata || metadata._creationTime < row._creationTime)
      throw invalid("Uploaded file is missing or predates this upload")
    const claimed = await ctx.db
      .query("storedFiles")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .first()
    if (claimed && claimed._id !== row._id)
      throw invalid("File is already claimed")
    await ctx.db.patch("storedFiles", row._id, {
      state: "completing",
      storageId,
    })
    return (await ctx.db.get("storedFiles", row._id))!
  },
})
export const ready = internalMutation({
  args: { ...actor, id: v.id("storedFiles") },
  returns: v.id("storedFiles"),
  handler: async (ctx, args) => {
    await authorize(ctx, args.organizationId, args.caller)
    const row = await ctx.db.get("storedFiles", args.id)
    if (
      !row ||
      row.organizationId !== args.organizationId ||
      row.state !== "completing" ||
      !row.expiresAt ||
      row.expiresAt <= Date.now()
    )
      throw invalid("Upload expired")
    await ctx.db.patch("storedFiles", row._id, {
      state: "ready",
      expiresAt: Date.now() + 30 * 86400_000,
      references: 0,
    })
    return row._id
  },
})
export const insert = internalMutation({
  args: {
    organizationId: v.string(),
    feature: v.string(),
    accountId: v.optional(v.id("channelAccounts")),
    storageId: v.optional(v.id("_storage")),
    size: v.number(),
    contentType: v.string(),
    filename: v.optional(v.string()),
    sha256: v.optional(v.string()),
  },
  returns: v.id("storedFiles"),
  handler: async (ctx, args) => {
    if (await retirement(ctx, args.organizationId))
      throw invalid("Team retired")
    return ctx.db.insert("storedFiles", {
      ...args,
      provider: "convex",
      state: "ready",
    })
  },
})

/** File metadata and Convex bytes are deleted together in the mutation. */
export async function deleteFile(
  ctx: MutationCtx,
  file: FileReference,
  force = false
) {
  if (file.fileId) {
    const row = await ctx.db.get("storedFiles", file.fileId)
    if (row) {
      if (!force && (row.references ?? 0) > 1) {
        await ctx.db.patch("storedFiles", row._id, {
          references: row.references! - 1,
        })
        return
      }
      if (row.storageId) await ctx.storage.delete(row.storageId)
      await ctx.db.delete("storedFiles", row._id)
    }
  } else if (file.storageId) await ctx.storage.delete(file.storageId)
}
export const removeRow = internalMutation({
  args: { id: v.id("storedFiles") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete("storedFiles", id)
    return null
  },
})
export const deletion = internalQuery({
  args: { id: v.id("storedFiles") },
  returns: v.union(v.null(), schema.doc("storedFiles")),
  handler: (ctx, { id }) => ctx.db.get("storedFiles", id),
})
export const discard = internalMutation({
  args: fileReference,
  returns: v.null(),
  handler: async (ctx, file) => {
    await deleteFile(ctx, file)
    return null
  },
})
export const expire = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    let count = 0
    for (const state of [
      "pending",
      "completing",
      "deleting",
      "ready",
    ] as const) {
      const rows = await ctx.db
        .query("storedFiles")
        .withIndex("by_state_and_expiresAt", (q) =>
          q.eq("state", state).gt("expiresAt", 0).lte("expiresAt", Date.now())
        )
        .take(100)
      for (const row of rows) {
        if (state === "ready" && (row.references ?? 0) > 0) {
          await ctx.db.patch("storedFiles", row._id, { expiresAt: undefined })
          continue
        }
        await deleteFile(ctx, { fileId: row._id })
      }
      count += rows.length
    }
    if (count >= 100)
      await ctx.scheduler.runAfter(60_000, internal.storage.files.expire, {})
    return null
  },
})
export const settings = query({
  args: {},
  returns: v.object({
    provider: v.string(),
    bucket: v.optional(v.string()),
    host: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    await requireInstallationAdmin(ctx)
    return { provider: "convex" }
  },
})

export async function retainFile(
  ctx: MutationCtx,
  id: Id<"storedFiles">,
  organizationId: string,
  feature?: string
) {
  const row = await ctx.db.get("storedFiles", id)
  if (
    !row ||
    row.organizationId !== organizationId ||
    row.state !== "ready" ||
    (feature && row.feature !== feature)
  )
    throw invalid("File is not ready or does not belong to this team")
  await ctx.db.patch("storedFiles", id, {
    references: (row.references ?? 0) + 1,
    expiresAt: undefined,
  })
  return row
}

/** The system table is the authority for direct-upload size and MIME type. */
export const metadata = internalQuery({
  args: { storageId: v.id("_storage") },
  returns: v.union(
    v.null(),
    v.object({ size: v.number(), contentType: v.optional(v.string()) })
  ),
  handler: async (ctx, { storageId }) => {
    const file = await ctx.db.system.get("_storage", storageId)
    return file ? { size: file.size, contentType: file.contentType } : null
  },
})
