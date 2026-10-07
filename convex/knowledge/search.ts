"use node"
import { embedText } from "../../lib/net/embedding"
import { v } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { actor } from "../botToolkitAccess"
import { type Caller, invalid } from "../api/caller"
import { decryptSecret } from "../secrets"
import { knowledgeScope } from "../../lib/bot-toolkit"
export type KnowledgeMatch = {
  id: string
  documentId: string
  knowledgeBaseId: string
  title: string
  text: string
  position: number
  score: number
}
export async function searchKnowledge(
  ctx: ActionCtx,
  args: {
    organizationId: string
    caller?: Caller
    knowledgeBaseIds: Id<"knowledgeBases">[]
    query: string
    limit?: number
    trusted?: boolean
  }
): Promise<{ data: KnowledgeMatch[] }> {
  const limit = args.limit ?? 5
  if (
    !args.query.trim() ||
    args.query.length > 4096 ||
    args.knowledgeBaseIds.length > 16 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20
  )
    throw invalid(
      "Use a query up to 4,096 characters, up to 16 knowledge bases and limit 1–20"
    )
  const encryptedKey: string = await ctx.runQuery(
    internal.knowledge.state.authorizeSearch,
    {
      organizationId: args.organizationId,
      caller: args.caller,
      ids: args.knowledgeBaseIds,
      trusted: args.trusted,
    }
  )
  if (!args.knowledgeBaseIds.length) return { data: [] }
  await ctx.runMutation(internal.botToolkitAccess.reserveOutbound, {
    organizationId: args.organizationId,
    operation: "knowledgeSearch",
  })
  const vector = await embedText(
    await decryptSecret(encryptedKey),
    args.query,
    "RETRIEVAL_QUERY"
  )
  const scopes = args.knowledgeBaseIds.map((id) =>
    knowledgeScope(args.organizationId, id)
  )
  const hits = await ctx.vectorSearch("knowledgeChunks", "by_embedding", {
    vector,
    limit: Math.min(100, limit * 3),
    filter: (q) => q.or(...scopes.map((scope) => q.eq("scope", scope))),
  })
  const data: KnowledgeMatch[] = await ctx.runQuery(
    internal.knowledge.state.hydrate,
    {
      organizationId: args.organizationId,
      knowledgeBaseIds: args.knowledgeBaseIds,
      hits,
    }
  )
  return { data: data.slice(0, limit) }
}
const searchArgs = {
  knowledgeBaseIds: v.array(v.id("knowledgeBases")),
  query: v.string(),
  limit: v.optional(v.number()),
}
export const search = internalAction({
  args: { ...actor, ...searchArgs },
  returns: v.any(),
  handler: searchKnowledge,
})
export const dashboardSearch = action({
  args: { organizationId: v.string(), ...searchArgs },
  returns: v.any(),
  handler: searchKnowledge,
})
