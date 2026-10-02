"use node"
import { v } from "convex/values"
import { action, internalAction } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { payload } from "./definitions"
import { internal } from "../_generated/api"
import { decryptSecret } from "../secrets"
import { storeFile } from "../storage/objects"
import {
  ElevenLabsPromptRenderer,
  SarvamPromptRenderer,
  renderWithBackoff,
} from "../../lib/ivr-renderers"
import { publicFetch } from "../../lib/net/public-fetch"
const request: typeof fetch = (url, init) =>
  publicFetch(String(url), {
    method: "POST",
    headers: init?.headers as Record<string, string>,
    body: init?.body as string,
    timeoutMs: 20000,
  })
export const render = internalAction({
  args: { id: v.id("ivrs") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const batch: {
      organizationId: string
      provider: "sarvam" | "elevenlabs"
      encryptedKey: string
      jobs: Doc<"ivrPromptRenders">[]
    } | null = await ctx.runMutation(internal.ivr.renderState.claim, args)
    if (!batch) return null
    await Promise.all(
      batch.jobs.map(async (job) => {
        try {
          const key = await decryptSecret(batch.encryptedKey),
            renderer =
              batch.provider === "sarvam"
                ? new SarvamPromptRenderer(key, request)
                : new ElevenLabsPromptRenderer(key, request)
          const rendered = await renderWithBackoff(
            renderer,
            job.text,
            job.language,
            job.voice!
          )
          if (!("audio" in rendered)) throw new Error("Prompt not rendered")
          const stored = await storeFile(ctx, {
            organizationId: batch.organizationId,
            feature: "ivr",
            filename: `${job.hash}.wav`,
            contentType: "audio/wav",
            body: rendered.audio,
            maxBytes: 16 * 1024 * 1024,
          })
          const accepted = await ctx.runMutation(
            internal.ivr.renderState.finish,
            { id: job._id, lease: job.lease!, fileId: stored.fileId! }
          )
          if (!accepted)
            await ctx.runMutation(internal.storage.files.discard, stored)
        } catch {
          await ctx.runMutation(internal.ivr.renderState.finish, {
            id: job._id,
            lease: job.lease!,
            error:
              "Voice provider could not render this prompt. Check the key, voice and language, then retry.",
          })
        }
      })
    )
    await ctx.scheduler.runAfter(0, internal.ivr.rendering.render, args)
    return null
  },
})
export const dashboardRender = action({
  args: { organizationId: v.string(), id: v.string() },
  returns: v.any(),
  handler: (ctx, args): Promise<Awaited<ReturnType<typeof payload>>> =>
    ctx.runMutation(internal.ivr.renderState.retry, args),
})
