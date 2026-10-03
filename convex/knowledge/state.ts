import { v } from "convex/values"
import { internalQuery, internalMutation } from "../_generated/server"
import { actor, authorizeToolkit, ownedToolkit } from "../botToolkitAccess"
import { requireActiveTeam } from "../teamLifecycle"
import { refreshStatus } from "./resources"
import { knowledgeScope } from "../../lib/bot-toolkit"
export const load = internalQuery({
  args: { id: v.id("knowledgeDocuments"), revision: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get("knowledgeDocuments", args.id)
    if (
      !doc ||
      doc.revision !== args.revision ||
      doc.status !== "processing" ||
      !(await ctx.db.get("knowledgeBases", doc.knowledgeBaseId))
    )
      return null
    await requireActiveTeam(ctx, doc.organizationId)
    const credential = await ctx.db
      .query("voiceProviders")
      .withIndex("by_organizationId_and_provider", (q) =>
        q.eq("organizationId", doc.organizationId).eq("provider", "gemini")
      )
      .first()
    const file = doc.fileId ? await ctx.db.get("storedFiles", doc.fileId) : null
    const body = await ctx.db
      .query("knowledgeDocumentTexts")
      .withIndex("by_documentId", (q) => q.eq("documentId", doc._id))
      .unique()
    return {
      doc: { ...doc, text: body?.text ?? doc.text },
      encryptedKey: credential?.encryptedKey ?? null,
      contentType: file?.contentType ?? null,
      filename: file?.filename ?? null,
    }
  },
})
export const complete = internalMutation({
  args: {
    id: v.id("knowledgeDocuments"),
    revision: v.string(),
    error: v.optional(v.string()),
    byteSize: v.number(),
    chunks: v.array(
      v.object({ text: v.string(), embedding: v.array(v.number()) })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get("knowledgeDocuments", args.id)
    if (
      !doc ||
      doc.revision !== args.revision ||
      !(await ctx.db.get("knowledgeBases", doc.knowledgeBaseId))
    )
      return null
    await requireActiveTeam(ctx, doc.organizationId)
    if (args.chunks.length > 100)
      throw new Error("Document has too many chunks")
    const old = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_documentId", (q) => q.eq("documentId", doc._id))
      .take(101)
    for (const chunk of old) await ctx.db.delete("knowledgeChunks", chunk._id)
    for (const [position, chunk] of args.chunks.entries()) {
      if (chunk.embedding.length !== 768 || chunk.text.length > 6400)
        throw new Error("Invalid knowledge chunk")
      await ctx.db.insert("knowledgeChunks", {
        ...chunk,
        position,
        organizationId: doc.organizationId,
        knowledgeBaseId: doc.knowledgeBaseId,
        scope: knowledgeScope(doc.organizationId, doc.knowledgeBaseId),
        documentId: doc._id,
        revision: doc.revision,
      })
    }
    await ctx.db.patch("knowledgeDocuments", doc._id, {
      status: args.error ? "failed" : "ready",
      error: args.error,
      byteSize: args.byteSize,
      updatedAt: Date.now(),
    })
    await refreshStatus(ctx, doc.knowledgeBaseId)
    return null
  },
})
export const authorizeSearch = internalQuery({
  args: {
    ...actor,
    ids: v.array(v.id("knowledgeBases")),
    trusted: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (!args.trusted) await authorizeToolkit(ctx, args, "knowledge")
    else await requireActiveTeam(ctx, args.organizationId)
    for (const id of args.ids)
      await ownedToolkit(ctx, "knowledgeBases", args.organizationId, id)
    const credential = await ctx.db
      .query("voiceProviders")
      .withIndex("by_organizationId_and_provider", (q) =>
        q.eq("organizationId", args.organizationId).eq("provider", "gemini")
      )
      .first()
    if (!credential)
      throw new Error(
        "Add a Gemini provider key in AI providers to search knowledge"
      )
    return credential.encryptedKey
  },
})
export const hydrate = internalQuery({
  args: {
    organizationId: v.string(),
    knowledgeBaseIds: v.array(v.id("knowledgeBases")),
    hits: v.array(
      v.object({ _id: v.id("knowledgeChunks"), _score: v.number() })
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireActiveTeam(ctx, args.organizationId)
    const result = []
    for (const hit of args.hits) {
      const chunk = await ctx.db.get("knowledgeChunks", hit._id)
      if (
        !chunk ||
        chunk.organizationId !== args.organizationId ||
        !args.knowledgeBaseIds.includes(chunk.knowledgeBaseId)
      )
        continue
      const doc = await ctx.db.get("knowledgeDocuments", chunk.documentId)
      const base = await ctx.db.get("knowledgeBases", chunk.knowledgeBaseId)
      if (
        !doc ||
        !base ||
        doc.organizationId !== args.organizationId ||
        base.organizationId !== args.organizationId ||
        doc.status !== "ready" ||
        doc.knowledgeBaseId !== chunk.knowledgeBaseId ||
        doc.revision !== chunk.revision
      )
        continue
      result.push({
        id: chunk._id,
        documentId: doc._id,
        knowledgeBaseId: base._id,
        title: doc.title,
        text: chunk.text,
        position: chunk.position,
        score: hit._score,
      })
    }
    return result
  },
})
