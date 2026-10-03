"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import { decryptSecret } from "../secrets"
import { publicFetch } from "../../lib/net/public-fetch"
import { chunkText, embedText } from "../../lib/bot-toolkit"
import { extractKnowledgeText } from "../../lib/net/knowledge-text"
export const ingest = internalAction({
  args: { id: v.id("knowledgeDocuments"), revision: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const loaded: {
      doc: Doc<"knowledgeDocuments">
      encryptedKey: string | null
      contentType: string | null
      filename: string | null
    } | null = await ctx.runQuery(internal.knowledge.state.load, args)
    if (!loaded) return null
    let byteSize = loaded.doc.byteSize
    try {
      if (!loaded.encryptedKey)
        throw new Error(
          "Add a Gemini provider key in Settings → AI providers, then re-index this document"
        )
      let content = loaded.doc.text ?? ""
      if (loaded.doc.source === "upload") {
        const blob = loaded.doc.storageId
          ? await ctx.storage.get(loaded.doc.storageId)
          : null
        if (!blob) throw new Error("The uploaded file is no longer available")
        if (blob.size > 2 * 1024 * 1024)
          throw new Error("Document exceeds the 2 MB limit")
        byteSize = blob.size
        content = await extractKnowledgeText(
          new Uint8Array(await blob.arrayBuffer()),
          loaded.contentType ?? blob.type,
          loaded.filename ?? ""
        )
      } else if (loaded.doc.source === "url") {
        const response = await publicFetch(loaded.doc.url!, {
          maxBytes: 2 * 1024 * 1024,
          timeoutMs: 10000,
        })
        if (!response.ok)
          throw new Error(
            `The source URL returned HTTP ${response.status}; redirects are not followed`
          )
        const bytes = new Uint8Array(await response.arrayBuffer())
        byteSize = bytes.length
        content = await extractKnowledgeText(
          bytes,
          response.headers.get("content-type") ?? "text/plain",
          loaded.doc.url!
        )
      }
      if (!content.trim())
        throw new Error(
          "No readable text found; scanned PDFs need OCR before uploading"
        )
      if (content.length > 200000)
        throw new Error(
          "Extracted text exceeds 200,000 characters; split this document into smaller files"
        )
      const key = await decryptSecret(loaded.encryptedKey),
        chunks = []
      const texts = chunkText(content)
      if (texts.length > 100)
        throw new Error(
          "Document exceeds 100 search chunks; split it into smaller documents"
        )
      for (const text of texts)
        chunks.push({
          text,
          embedding: await embedText(
            key,
            text,
            "RETRIEVAL_DOCUMENT",
            loaded.doc.title
          ),
        })
      await ctx.runMutation(internal.knowledge.state.complete, {
        ...args,
        byteSize,
        chunks,
      })
    } catch (error) {
      // Known local/parser errors are useful; provider bodies and keys are never included.
      const message =
        error instanceof Error ? error.message : "Document processing failed"
      const safe = message
        .replace(/https?:\/\/\S+/g, "source URL")
        .split(await decryptSecret(loaded.encryptedKey ?? "").catch(() => "\0"))
        .join("[redacted]")
      await ctx.runMutation(internal.knowledge.state.complete, {
        ...args,
        byteSize,
        chunks: [],
        error: safe.slice(0, 512),
      })
    }
    return null
  },
})
