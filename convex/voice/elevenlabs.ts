"use node"
import { v } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { callerValue, type Caller } from "../api/caller"
import { decryptSecret } from "../secrets"
import { publicFetch } from "../../lib/net/public-fetch"
import {
  formatProviderError,
  loadElevenLabsVoiceCatalog,
  ProviderVoiceError,
  type ElevenLabsVoice,
} from "../../lib/elevenlabs-voices"

const request: typeof fetch = (url, init) =>
  publicFetch(String(url), {
    method: "GET",
    headers: init?.headers as Record<string, string> | undefined,
    timeoutMs: 20_000,
  })

type Prepared = {
  organizationId: string
  credentialId: Id<"voiceProviders">
  encryptedKey: string
  voices: ElevenLabsVoice[]
  refreshedAt?: number
  hasMore?: boolean
  error?: string
}

function storedVoice(voice: ElevenLabsVoice) {
  return {
    value: voice.value,
    label: voice.label,
    gender: voice.gender,
    category: voice.category,
    ...(voice.accent ? { accent: voice.accent } : {}),
    ...(voice.language ? { language: voice.language } : {}),
    ...(voice.description ? { description: voice.description } : {}),
  }
}

type Listed =
  | {
      object: "list"
      has_more: boolean
      data: ElevenLabsVoice[]
      cached_at: number
      credential_id: string
      error?: string
    }
  | { hasKey: false; voices: [] }

function voiceList(
  credentialId: string,
  voices: ElevenLabsVoice[],
  refreshedAt: number,
  hasMore: boolean | undefined,
  error?: string
) {
  return {
    object: "list" as const,
    has_more: !!hasMore,
    data: voices,
    cached_at: refreshedAt,
    credential_id: credentialId,
    ...(error ? { error } : {}),
  }
}

async function catalog(
  ctx: ActionCtx,
  prepared: Prepared,
  force: boolean
): Promise<Listed> {
  const now = Date.now()
  let key = ""
  try {
    key = await decryptSecret(prepared.encryptedKey)
    const loaded = await loadElevenLabsVoiceCatalog({
      request,
      apiKey: key,
      now,
      force,
      cache:
        typeof prepared.refreshedAt === "number"
          ? {
              refreshedAt: prepared.refreshedAt,
              voices: prepared.voices,
              hasMore: prepared.hasMore,
            }
          : undefined,
    })
    if (loaded.fromCache)
      return voiceList(
        prepared.credentialId,
        loaded.voices,
        loaded.refreshedAt,
        loaded.hasMore,
        prepared.error
      )
    await ctx.runMutation(internal.voice.elevenlabsState.store, {
      organizationId: prepared.organizationId,
      credentialId: prepared.credentialId,
      refreshedAt: loaded.refreshedAt,
      voices: loaded.voices.map(storedVoice),
      ...(loaded.hasMore ? { hasMore: true } : {}),
    })
    return voiceList(
      prepared.credentialId,
      loaded.voices,
      loaded.refreshedAt,
      loaded.hasMore
    )
  } catch (error) {
    const message =
      error instanceof ProviderVoiceError
        ? error.message
        : formatProviderError(
            "ElevenLabs",
            0,
            error instanceof Error ? error.message : "request failed",
            key ? [key] : []
          )
    await ctx.runMutation(internal.voice.elevenlabsState.store, {
      organizationId: prepared.organizationId,
      credentialId: prepared.credentialId,
      refreshedAt: now,
      voices: [],
      keepVoices: true,
      ...(prepared.hasMore ? { hasMore: true } : {}),
      error: message,
    })
    return voiceList(
      prepared.credentialId,
      prepared.voices,
      now,
      prepared.hasMore,
      message
    )
  }
}

async function load(
  ctx: ActionCtx,
  args: {
    organizationId: string
    caller?: Caller
    credentialId?: string
    force?: boolean
  }
): Promise<Listed> {
  const prepared: Prepared | null = await ctx.runQuery(
    internal.voice.elevenlabsState.prepare,
    {
      organizationId: args.organizationId,
      ...(args.caller ? { caller: args.caller } : {}),
      ...(args.credentialId ? { credentialId: args.credentialId } : {}),
      required: !!args.caller,
    }
  )
  if (!prepared) return { hasKey: false, voices: [] }
  return catalog(ctx, prepared, !!args.force)
}

export const dashboardRefresh = action({
  args: {
    organizationId: v.string(),
    credentialId: v.optional(v.id("voiceProviders")),
    force: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: (ctx, args): Promise<Listed> => load(ctx, args),
})

export const refresh = internalAction({
  args: {
    organizationId: v.string(),
    caller: callerValue,
    credentialId: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: (ctx, args): Promise<Listed> => load(ctx, args),
})
