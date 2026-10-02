import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { callerValue, notFound } from "../api/caller"
import { elevenLabsVoiceValue } from "../tables/voice"
import { authorize } from "./resources"

const actor = {
  organizationId: v.string(),
  caller: v.optional(callerValue),
  credentialId: v.optional(v.string()),
}

async function elevenLabsKey(
  ctx: QueryCtx,
  organizationId: string,
  credentialId?: string
) {
  if (credentialId) {
    const id = ctx.db.normalizeId("voiceProviders", credentialId)
    const row = id ? await ctx.db.get("voiceProviders", id) : null
    if (
      !row ||
      row.organizationId !== organizationId ||
      row.provider !== "elevenlabs"
    )
      return null
    return row
  }
  const rows = await ctx.db
    .query("voiceProviders")
    .withIndex("by_organizationId_and_provider", (q) =>
      q.eq("organizationId", organizationId).eq("provider", "elevenlabs")
    )
    .order("desc")
    .take(20)
  return rows.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

function savedCache(row: Doc<"elevenLabsVoiceCaches"> | undefined) {
  if (!row) return undefined
  return {
    refreshedAt: row.refreshedAt,
    voices: row.voices,
    ...(row.hasMore ? { hasMore: true as const } : {}),
    ...(row.error ? { error: row.error } : {}),
  }
}

async function cacheFor(
  ctx: QueryCtx,
  credentialId: Doc<"voiceProviders">["_id"]
) {
  return (
    await ctx.db
      .query("elevenLabsVoiceCaches")
      .withIndex("by_credentialId", (q) => q.eq("credentialId", credentialId))
      .take(1)
  )[0]
}

/** Dashboard catalog. The encrypted key stays in the internal prepare query. */
export const dashboardVoices = query({
  args: {
    organizationId: v.string(),
    credentialId: v.optional(v.id("voiceProviders")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const provider = await elevenLabsKey(
      ctx,
      args.organizationId,
      args.credentialId
    )
    if (!provider) return { hasKey: false, voices: [] }
    const saved = savedCache(await cacheFor(ctx, provider._id))
    return {
      hasKey: true,
      voices: saved?.voices ?? [],
      credentialId: provider._id,
      ...(saved ? { refreshedAt: saved.refreshedAt } : {}),
      ...(saved?.hasMore ? { hasMore: true } : {}),
      ...(saved?.error ? { error: saved.error } : {}),
    }
  },
})

export const prepare = internalQuery({
  args: { ...actor, required: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorize(ctx, args, false, !!args.caller)
    const provider = await elevenLabsKey(
      ctx,
      args.organizationId,
      args.credentialId
    )
    if (!provider) {
      if (args.caller || args.required) throw notFound("Voice provider")
      return null
    }
    const saved = savedCache(await cacheFor(ctx, provider._id))
    return {
      organizationId: provider.organizationId,
      credentialId: provider._id,
      encryptedKey: provider.encryptedKey,
      voices: saved?.voices ?? [],
      ...(saved ? { refreshedAt: saved.refreshedAt } : {}),
      ...(saved?.hasMore ? { hasMore: true } : {}),
      ...(saved?.error ? { error: saved.error } : {}),
    }
  },
})

export const store = internalMutation({
  args: {
    organizationId: v.string(),
    credentialId: v.id("voiceProviders"),
    refreshedAt: v.number(),
    voices: v.array(elevenLabsVoiceValue),
    hasMore: v.optional(v.boolean()),
    error: v.optional(v.string()),
    keepVoices: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const provider = await ctx.db.get("voiceProviders", args.credentialId)
    if (!provider || provider.organizationId !== args.organizationId)
      return null
    const rows = await ctx.db
      .query("elevenLabsVoiceCaches")
      .withIndex("by_credentialId", (q) =>
        q.eq("credentialId", args.credentialId)
      )
      .take(5)
    const [row, ...extra] = rows
    for (const stale of extra)
      await ctx.db.delete("elevenLabsVoiceCaches", stale._id)
    const voices = (args.keepVoices ? (row?.voices ?? []) : args.voices).slice(
      0,
      500
    )
    const next = {
      organizationId: args.organizationId,
      credentialId: args.credentialId,
      refreshedAt: args.refreshedAt,
      voices,
      ...(args.hasMore ? { hasMore: true } : {}),
      ...(args.error ? { error: args.error.slice(0, 200) } : {}),
    }
    if (row) await ctx.db.replace(row._id, next)
    else await ctx.db.insert("elevenLabsVoiceCaches", next)
    return null
  },
})
