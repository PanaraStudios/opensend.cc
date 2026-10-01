import { v } from "convex/values"
import { internalMutation } from "../_generated/server"
import { internal } from "../_generated/api"
import { authorize, own, payload } from "./definitions"
import { actor } from "./definitions"
import { ivrPrompts } from "../../lib/ivr"
import { renderHash } from "../../lib/ivr-prompts"
import schema from "../schema"
import { retirement } from "../teamLifecycle"
export const claim = internalMutation({
  args: { id: v.id("ivrs") },
  returns: v.union(
    v.null(),
    v.object({
      organizationId: v.string(),
      provider: v.union(v.literal("elevenlabs"), v.literal("sarvam")),
      encryptedKey: v.string(),
      jobs: v.array(schema.doc("ivrPromptRenders")),
    })
  ),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("ivrs", id)
    if (!row?.promptVoice || (await retirement(ctx, row.organizationId)))
      return null
    const key = await ctx.db.get("voiceProviders", row.promptVoice.credentialId)
    const jobs = [],
      seen = new Set<string>()
    for (const p of ivrPrompts(row))
      if (p.kind === "tts") {
        const hash = await renderHash(row, p)
        if (seen.has(hash)) continue
        seen.add(hash)
        const r = await ctx.db
          .query("ivrPromptRenders")
          .withIndex("by_organizationId_and_hash", (q) =>
            q.eq("organizationId", row.organizationId).eq("hash", hash)
          )
          .unique()
        if (
          !r ||
          r.status === "ready" ||
          r.status === "failed" ||
          (r.status === "rendering" && (r.leaseUntil ?? 0) > Date.now())
        )
          continue
        if (
          !key ||
          key.organizationId !== row.organizationId ||
          key.provider !== row.promptVoice.provider
        ) {
          await ctx.db.patch("ivrPromptRenders", r._id, {
            status: "failed",
            error: "Prompt provider key is unavailable",
          })
          continue
        }
        await ctx.db.patch("ivrPromptRenders", r._id, {
          status: "rendering",
          lease: crypto.randomUUID(),
          leaseUntil: Date.now() + 90000,
          error: undefined,
        })
        jobs.push((await ctx.db.get("ivrPromptRenders", r._id))!)
        if (jobs.length === 4) break
      }
    return key && jobs.length
      ? {
          organizationId: row.organizationId,
          provider: row.promptVoice.provider,
          encryptedKey: key.encryptedKey,
          jobs,
        }
      : null
  },
})
export const finish = internalMutation({
  args: {
    id: v.id("ivrPromptRenders"),
    lease: v.string(),
    fileId: v.optional(v.id("storedFiles")),
    error: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("ivrPromptRenders", args.id)
    if (
      !row ||
      row.lease !== args.lease ||
      row.status !== "rendering" ||
      (await retirement(ctx, row.organizationId))
    )
      return false
    if (args.fileId) {
      const file = await ctx.db.get("storedFiles", args.fileId)
      if (
        !file ||
        file.organizationId !== row.organizationId ||
        file.state !== "ready" ||
        file.contentType !== "audio/wav"
      )
        return false
    }
    await ctx.db.patch("ivrPromptRenders", row._id, {
      status: args.fileId ? "ready" : "failed",
      fileId: args.fileId,
      error: args.error,
      lease: undefined,
      leaseUntil: undefined,
    })
    return true
  },
})
export const retry = internalMutation({
  args: { ...actor, id: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    const row = await own(ctx, args.organizationId, args.id)
    for (const p of ivrPrompts(row))
      if (p.kind === "tts") {
        const hash = await renderHash(row, p),
          cached = await ctx.db
            .query("ivrPromptRenders")
            .withIndex("by_organizationId_and_hash", (q) =>
              q.eq("organizationId", row.organizationId).eq("hash", hash)
            )
            .unique()
        if (
          cached &&
          (cached.status === "failed" ||
            (cached.status === "rendering" &&
              (cached.leaseUntil ?? 0) <= Date.now()))
        )
          await ctx.db.patch("ivrPromptRenders", cached._id, {
            status: "pending_render",
            error: undefined,
            lease: undefined,
            leaseUntil: undefined,
          })
      }
    await ctx.scheduler.runAfter(0, internal.ivr.rendering.render, {
      id: row._id,
    })
    return payload(ctx, row)
  },
})
