import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  query,
  action,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { actor, authorizeToolkit, ownedToolkit } from "../botToolkitAccess"
import { invalid, orNullIfNotFound, type Caller } from "../api/caller"
import { idempotent } from "../api/idempotency"
import { listArgs, cursorPage } from "../api/paging"
import { stream } from "convex-helpers/server/stream"
import schema from "../schema"
import { text } from "../../lib/bot-toolkit"
import { isPublicHostname } from "../../lib/net/public-host"
import { retainFile, deleteFile } from "../storage/files"
export const publicRow = (
  row: Doc<"knowledgeBases"> | Doc<"knowledgeDocuments">
) => {
  const { _id, _creationTime, organizationId, ...fields } = row
  void _creationTime
  void organizationId
  if ("documentCount" in fields) {
    const { documentCount, ...publicFields } = fields
    void documentCount
    return { id: _id, ...publicFields }
  }
  return { id: _id, ...fields }
}
const resourceArgs = { ...actor, knowledgeBaseId: v.optional(v.string()) }
async function listRows(
  ctx: QueryCtx,
  args: {
    organizationId: string
    caller?: Caller
    knowledgeBaseId?: string
    limit: number
    after?: string
    before?: string
  }
) {
  await authorizeToolkit(ctx, args, "knowledge")
  const base = args.knowledgeBaseId
    ? await ownedToolkit(
        ctx,
        "knowledgeBases",
        args.organizationId,
        args.knowledgeBaseId
      )
    : null
  if (
    !Number.isInteger(args.limit) ||
    args.limit < 1 ||
    args.limit > 100 ||
    (args.after && args.before)
  )
    throw invalid("Use limit 1–100 and one cursor")
  const table = base ? "knowledgeDocuments" : "knowledgeBases"
  const page = await cursorPage<
    Doc<"knowledgeBases"> | Doc<"knowledgeDocuments">
  >(
    args,
    async (id) => {
      const normalized = ctx.db.normalizeId(table, id),
        row = normalized ? await ctx.db.get(table, normalized) : null
      return row?.organizationId === args.organizationId &&
        (!base ||
          ("knowledgeBaseId" in row && row.knowledgeBaseId === base._id))
        ? row
        : null
    },
    (order) =>
      base
        ? stream(ctx.db, schema)
            .query("knowledgeDocuments")
            .withIndex("by_knowledgeBaseId", (q) =>
              q.eq("knowledgeBaseId", base._id)
            )
            .order(order)
        : stream(ctx.db, schema)
            .query("knowledgeBases")
            .withIndex("by_organizationId", (q) =>
              q.eq("organizationId", args.organizationId)
            )
            .order(order)
  )
  return {
    object: "list",
    has_more: page.has_more,
    data: page.data.map(publicRow),
  }
}
export const list = internalQuery({
  args: { ...resourceArgs, ...listArgs },
  returns: v.any(),
  handler: listRows,
})
export const dashboardList = query({
  args: {
    organizationId: v.string(),
    knowledgeBaseId: v.optional(v.string()),
    ...listArgs,
  },
  returns: v.any(),
  // A just-deleted knowledge base lists no documents instead of crashing its page.
  handler: async (ctx, args) =>
    (await orNullIfNotFound(listRows(ctx, args))) ?? {
      has_more: false,
      data: [],
    },
})
const getArgs = {
  ...actor,
  id: v.string(),
  document: v.optional(v.boolean()),
  knowledgeBaseId: v.optional(v.string()),
}
async function getRow(
  ctx: QueryCtx,
  args: {
    organizationId: string
    caller?: Caller
    id: string
    document?: boolean
    knowledgeBaseId?: string
  }
) {
  await authorizeToolkit(ctx, args, "knowledge")
  const row = await ownedToolkit(
    ctx,
    args.document ? "knowledgeDocuments" : "knowledgeBases",
    args.organizationId,
    args.id
  )
  if (
    args.knowledgeBaseId &&
    !("knowledgeBaseId" in row && row.knowledgeBaseId === args.knowledgeBaseId)
  )
    throw invalid("Document does not belong to this knowledge base")
  const result = publicRow(row)
  if ("knowledgeBaseId" in row && row.source === "text") {
    const body = await ctx.db
      .query("knowledgeDocumentTexts")
      .withIndex("by_documentId", (q) => q.eq("documentId", row._id))
      .unique()
    return { ...result, text: body?.text ?? row.text ?? "" }
  }
  return result
}
export const get = internalQuery({
  args: getArgs,
  returns: v.any(),
  handler: getRow,
})
export const dashboardGet = query({
  args: { organizationId: v.string(), id: v.string() },
  returns: v.any(),
  handler: (ctx, args) => orNullIfNotFound(getRow(ctx, args)),
})
export async function refreshStatus(
  ctx: MutationCtx,
  id: Id<"knowledgeBases">
) {
  const base = await ctx.db.get("knowledgeBases", id)
  if (!base) return
  const processing = await ctx.db
    .query("knowledgeDocuments")
    .withIndex("by_knowledgeBaseId_and_status", (q) =>
      q.eq("knowledgeBaseId", id).eq("status", "processing")
    )
    .first()
  const failed = await ctx.db
    .query("knowledgeDocuments")
    .withIndex("by_knowledgeBaseId_and_status", (q) =>
      q.eq("knowledgeBaseId", id).eq("status", "failed")
    )
    .first()
  await ctx.db.patch("knowledgeBases", id, {
    status: processing ? "processing" : failed ? "failed" : "ready",
    updatedAt: Date.now(),
  })
}
export const save = internalMutation({
  args: {
    ...resourceArgs,
    id: v.optional(v.string()),
    input: v.record(v.string(), v.any()),
  },
  returns: v.object({ id: v.string() }),
  handler: async (ctx, args) => {
    await authorizeToolkit(ctx, args, "knowledge", true)
    const write = async () => {
      const now = Date.now()
      if (!args.knowledgeBaseId) {
        if (
          Object.keys(args.input).some(
            (k) => !["name", "description"].includes(k)
          )
        )
          throw invalid("Unknown knowledge base field")
        const previous = args.id
          ? await ownedToolkit(
              ctx,
              "knowledgeBases",
              args.organizationId,
              args.id
            )
          : null
        const name = text(args.input.name ?? previous?.name, "Name", 128)
        const description =
          args.input.description ?? previous?.description ?? ""
        if (typeof description !== "string" || description.length > 2000)
          throw invalid("Description must be up to 2,000 characters")
        if (previous) {
          await ctx.db.patch("knowledgeBases", previous._id, {
            name,
            description,
            updatedAt: now,
          })
          return previous._id
        }
        return ctx.db.insert("knowledgeBases", {
          organizationId: args.organizationId,
          name,
          description,
          status: "ready",
          documentCount: 0,
          createdAt: now,
          updatedAt: now,
        })
      }
      const base = await ownedToolkit(
        ctx,
        "knowledgeBases",
        args.organizationId,
        args.knowledgeBaseId
      )
      if (
        Object.keys(args.input).some(
          (k) => !["title", "source", "text", "url", "fileId"].includes(k)
        )
      )
        throw invalid("Unknown document field")
      const previous = args.id
        ? await ownedToolkit(
            ctx,
            "knowledgeDocuments",
            args.organizationId,
            args.id
          )
        : null
      if (previous && previous.knowledgeBaseId !== base._id)
        throw invalid("Document does not belong to this knowledge base")
      if (!previous && (base.documentCount ?? 0) >= 100)
        throw invalid("Use up to 100 documents per knowledge base")
      const previousText = previous
        ? await ctx.db
            .query("knowledgeDocumentTexts")
            .withIndex("by_documentId", (q) => q.eq("documentId", previous._id))
            .unique()
        : null
      const input = {
          ...previous,
          ...(previousText ? { text: previousText.text } : {}),
          ...args.input,
        },
        title = text(input.title, "Title", 256),
        source = input.source
      if (source !== "text" && source !== "url" && source !== "upload")
        throw invalid("Choose pasted text, a URL or a file")
      let fileId: Id<"storedFiles"> | undefined,
        storageId: Id<"_storage"> | undefined,
        byteSize = 0
      let content: string | undefined, url: string | undefined
      if (source === "text") {
        content = text(input.text, "Document text", 200000)
        byteSize = new TextEncoder().encode(content).length
      }
      if (source === "url") {
        url = text(input.url, "URL", 2048)
        const parsed = new URL(url)
        if (
          parsed.protocol !== "https:" ||
          parsed.username ||
          parsed.password ||
          !isPublicHostname(parsed.hostname)
        )
          throw invalid("Use a public HTTPS URL")
      }
      if (source === "upload") {
        fileId =
          typeof input.fileId === "string"
            ? (ctx.db.normalizeId("storedFiles", input.fileId) ?? undefined)
            : undefined
        if (!fileId) throw invalid("Upload a document first")
        const file =
          fileId === previous?.fileId
            ? await ctx.db.get("storedFiles", fileId)
            : await retainFile(ctx, fileId, args.organizationId)
        if (
          !file ||
          file.organizationId !== args.organizationId ||
          file.state !== "ready" ||
          !file.storageId ||
          file.size > 2 * 1024 * 1024
        )
          throw invalid("Use a ready document up to 2 MB")
        storageId = file.storageId
        byteSize = file.size
      }
      if (previous?.fileId && previous.fileId !== fileId)
        await deleteFile(ctx, { fileId: previous.fileId })
      const fields = {
        title,
        source,
        text: undefined,
        url,
        fileId,
        storageId,
        byteSize,
        revision: crypto.randomUUID(),
        status: "processing" as const,
        error: undefined,
        updatedAt: now,
      }
      const id =
        previous?._id ??
        (await ctx.db.insert("knowledgeDocuments", {
          ...fields,
          organizationId: args.organizationId,
          knowledgeBaseId: base._id,
          createdAt: now,
        }))
      if (previous) await ctx.db.patch("knowledgeDocuments", id, fields)
      if (previousText)
        await ctx.db.delete("knowledgeDocumentTexts", previousText._id)
      if (content)
        await ctx.db.insert("knowledgeDocumentTexts", {
          organizationId: args.organizationId,
          documentId: id,
          text: content,
        })
      await ctx.db.patch("knowledgeBases", base._id, {
        status: "processing",
        documentCount: (base.documentCount ?? 0) + (previous ? 0 : 1),
        updatedAt: now,
      })
      await ctx.scheduler.runAfter(0, internal.knowledge.ingest.ingest, {
        id,
        revision: fields.revision,
      })
      return id
    }
    try {
      return {
        id: args.caller
          ? await idempotent(ctx, args.caller, write, (id) => ({
              body: { id },
            }))
          : await write(),
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "ConvexError")
        throw invalid(error.message)
      throw error
    }
  },
})
export const cleanupChunks = internalMutation({
  args: { documentId: v.id("knowledgeDocuments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_documentId", (q) => q.eq("documentId", args.documentId))
      .take(50)
    for (const row of rows) await ctx.db.delete("knowledgeChunks", row._id)
    if (rows.length === 50)
      await ctx.scheduler.runAfter(
        0,
        internal.knowledge.resources.cleanupChunks,
        args
      )
    return null
  },
})
export const remove = internalMutation({
  args: getArgs,
  returns: v.object({ id: v.string(), deleted: v.boolean() }),
  handler: async (ctx, args) => {
    await authorizeToolkit(ctx, args, "knowledge", true)
    const row = await ownedToolkit(
      ctx,
      args.document ? "knowledgeDocuments" : "knowledgeBases",
      args.organizationId,
      args.id
    )
    if ("knowledgeBaseId" in row) {
      if (args.knowledgeBaseId && row.knowledgeBaseId !== args.knowledgeBaseId)
        throw invalid("Document does not belong to this knowledge base")
      if (row.fileId) await deleteFile(ctx, { fileId: row.fileId })
      const body = await ctx.db
        .query("knowledgeDocumentTexts")
        .withIndex("by_documentId", (q) => q.eq("documentId", row._id))
        .unique()
      if (body) await ctx.db.delete("knowledgeDocumentTexts", body._id)
      await ctx.db.delete("knowledgeDocuments", row._id)
      const base = await ctx.db.get("knowledgeBases", row.knowledgeBaseId)
      if (base)
        await ctx.db.patch("knowledgeBases", base._id, {
          documentCount: Math.max(0, (base.documentCount ?? 1) - 1),
        })
      await ctx.scheduler.runAfter(
        0,
        internal.knowledge.resources.cleanupChunks,
        { documentId: row._id }
      )
      await refreshStatus(ctx, row.knowledgeBaseId)
    } else {
      await ctx.db.delete("knowledgeBases", row._id)
      await ctx.scheduler.runAfter(0, internal.botToolkitAccess.detach, {
        organizationId: args.organizationId,
        kind: "knowledge",
        id: row._id,
        paginationOpts: { numItems: 20, cursor: null },
      })
      await ctx.scheduler.runAfter(
        0,
        internal.knowledge.resources.cleanupBase,
        { id: row._id }
      )
    }
    return { id: args.id, deleted: true }
  },
})
export const cleanupBase = internalMutation({
  args: { id: v.id("knowledgeBases") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("knowledgeDocuments")
      .withIndex("by_knowledgeBaseId", (q) => q.eq("knowledgeBaseId", args.id))
      .take(10)
    for (const doc of docs) {
      if (doc.fileId) await deleteFile(ctx, { fileId: doc.fileId })
      const body = await ctx.db
        .query("knowledgeDocumentTexts")
        .withIndex("by_documentId", (q) => q.eq("documentId", doc._id))
        .unique()
      if (body) await ctx.db.delete("knowledgeDocumentTexts", body._id)
      await ctx.db.delete("knowledgeDocuments", doc._id)
      await ctx.scheduler.runAfter(
        0,
        internal.knowledge.resources.cleanupChunks,
        { documentId: doc._id }
      )
    }
    if (docs.length === 10)
      await ctx.scheduler.runAfter(
        0,
        internal.knowledge.resources.cleanupBase,
        args
      )
    return null
  },
})
export const dashboardWrite = action({
  args: {
    organizationId: v.string(),
    id: v.optional(v.string()),
    knowledgeBaseId: v.optional(v.string()),
    remove: v.optional(v.boolean()),
    body: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args): Promise<{ id: string; deleted?: boolean }> =>
    args.remove
      ? ctx.runMutation(internal.knowledge.resources.remove, {
          organizationId: args.organizationId,
          id: args.id!,
          document: !!args.knowledgeBaseId,
          knowledgeBaseId: args.knowledgeBaseId,
        })
      : ctx.runMutation(internal.knowledge.resources.save, {
          organizationId: args.organizationId,
          id: args.id,
          knowledgeBaseId: args.knowledgeBaseId,
          input: JSON.parse(args.body),
        }),
})

export const dashboardDocument = query({
  args: { organizationId: v.string(), id: v.string() },
  returns: v.any(),
  handler: (ctx, args) => getRow(ctx, { ...args, document: true }),
})
