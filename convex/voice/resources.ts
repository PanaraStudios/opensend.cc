import { v } from "convex/values"
import { stream } from "convex-helpers/server/stream"
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import {
  callerValue,
  requireCaller,
  invalid,
  notFound,
  apiError,
  type Caller,
} from "../api/caller"
import { listArgs, cursorPage } from "../api/paging"
import { requireTeam } from "../access"
import { requireActiveTeam } from "../teamLifecycle"
import { encryptSecret } from "../secrets"
import { idempotent } from "../api/idempotency"
import schema from "../schema"
import { validateBot } from "../../lib/voice-bots"
export const actor = {
  organizationId: v.string(),
  caller: v.optional(callerValue),
}
export async function authorize(
  ctx: QueryCtx,
  args: { organizationId: string; caller?: Caller },
  write = false
) {
  if (args.caller) {
    if (args.caller.organizationId !== args.organizationId)
      throw notFound("Team")
    await requireCaller(ctx, args.caller, {
      resource: "voice_bots",
      access: write ? "write" : "read",
    })
  } else await requireTeam(ctx, args.organizationId, write ? "write" : "read")
  await requireActiveTeam(ctx, args.organizationId)
}
export async function ownedBot(ctx: QueryCtx, team: string, id: string) {
  const normalized = ctx.db.normalizeId("voiceBots", id),
    row = normalized ? await ctx.db.get("voiceBots", normalized) : null
  if (!row || row.organizationId !== team) throw notFound("Voice bot")
  return row
}
const publicBot = (row: Doc<"voiceBots">) => {
  const { _id, _creationTime, organizationId, ...config } = row
  void _creationTime
  void organizationId
  return { id: _id, ...config }
}
const publicProvider = (row: Doc<"voiceProviders">) => ({
  id: row._id,
  provider: row.provider,
  label: row.label,
  lastFour: row.lastFour,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})
export const get = internalQuery({
  args: { ...actor, id: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    return publicBot(await ownedBot(ctx, args.organizationId, args.id))
  },
})
const pageArgs = { ...actor, ...listArgs, providers: v.optional(v.boolean()) }
async function listResources(
  ctx: QueryCtx,
  args: {
    organizationId: string
    caller?: Caller
    limit: number
    after?: string
    before?: string
    providers?: boolean
  }
) {
  await authorize(ctx, args)
  if (
    !Number.isInteger(args.limit) ||
    args.limit < 1 ||
    args.limit > 100 ||
    (args.after && args.before)
  )
    throw invalid("Use limit 1–100 and one cursor")
  const table = args.providers ? "voiceProviders" : "voiceBots"
  const page = await cursorPage(
    args,
    async (id) => {
      const normalized = ctx.db.normalizeId(table, id)
      const row = normalized ? await ctx.db.get(table, normalized) : null
      return row?.organizationId === args.organizationId ? row : null
    },
    (order) =>
      stream(ctx.db, schema)
        .query(table)
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", args.organizationId)
        )
        .order(order)
  )
  return {
    object: "list",
    has_more: page.has_more,
    data: page.data.map((row) =>
      table === "voiceProviders"
        ? publicProvider(row as Doc<"voiceProviders">)
        : publicBot(row as Doc<"voiceBots">)
    ),
  }
}
export const list = internalQuery({
  args: pageArgs,
  returns: v.any(),
  handler: listResources,
})
export const dashboardList = query({
  args: {
    organizationId: v.string(),
    ...listArgs,
    providers: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: listResources,
})
export const save = internalMutation({
  args: {
    ...actor,
    id: v.optional(v.string()),
    input: v.record(v.string(), v.any()),
  },
  returns: v.object({ id: v.id("voiceBots") }),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    const previous = args.id
      ? await ownedBot(ctx, args.organizationId, args.id)
      : null
    let config
    try {
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...old
      } = previous ? publicBot(previous) : {}
      void _id
      void _createdAt
      void _updatedAt
      config = validateBot({ ...old, ...args.input })
    } catch {
      throw invalid("Invalid voice bot configuration")
    }
    const credentialId = ctx.db.normalizeId(
        "voiceProviders",
        config.credentialId
      ),
      credential = credentialId
        ? await ctx.db.get("voiceProviders", credentialId)
        : null
    if (
      !credential ||
      credential.organizationId !== args.organizationId ||
      credential.provider !== config.provider
    )
      throw invalid("Credential must belong to this team and provider")
    for (const name of ["stt", "llm", "tts"] as const) {
      const stage = config[name]
      if (!stage) continue
      const id = ctx.db.normalizeId("voiceProviders", stage.credentialId),
        key = id ? await ctx.db.get("voiceProviders", id) : null
      if (
        !key ||
        key.organizationId !== args.organizationId ||
        key.provider !== stage.provider
      )
        throw invalid("Stage credential must belong to this team and provider")
      stage.credentialId = id!
    }
    const write = async () => {
      const now = Date.now(),
        fields = {
          ...config,
          stt: config.stt
            ? {
                ...config.stt,
                credentialId: config.stt.credentialId as Id<"voiceProviders">,
              }
            : undefined,
          llm: config.llm
            ? {
                ...config.llm,
                credentialId: config.llm.credentialId as Id<"voiceProviders">,
              }
            : undefined,
          tts: config.tts
            ? {
                ...config.tts,
                credentialId: config.tts.credentialId as Id<"voiceProviders">,
              }
            : undefined,
          credentialId: credential._id,
          updatedAt: now,
        }
      if (previous) {
        await ctx.db.patch("voiceBots", previous._id, fields)
        return previous._id
      }
      return ctx.db.insert("voiceBots", {
        ...fields,
        organizationId: args.organizationId,
        createdAt: now,
      })
    }
    const id = args.caller
      ? await idempotent(ctx, args.caller, write, (id) => ({ body: { id } }))
      : await write()
    return { id }
  },
})
export const credential = internalMutation({
  args: { ...actor, input: v.record(v.string(), v.any()) },
  returns: v.object({ id: v.id("voiceProviders") }),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    const { provider, label, key } = args.input
    if (
      (provider !== "gemini" &&
        provider !== "sarvam" &&
        provider !== "elevenlabs") ||
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 128 ||
      typeof key !== "string" ||
      key.length < 8 ||
      key.length > 4096 ||
      /[\r\n\0]/.test(key) ||
      Object.keys(args.input).some(
        (k) => !["provider", "label", "key"].includes(k)
      )
    )
      throw invalid("Invalid voice provider credential")
    const write = async () => {
      const now = Date.now()
      return ctx.db.insert("voiceProviders", {
        organizationId: args.organizationId,
        provider,
        label,
        encryptedKey: await encryptSecret(key),
        lastFour: key.slice(-4),
        createdAt: now,
        updatedAt: now,
      })
    }
    return {
      id: args.caller
        ? await idempotent(ctx, args.caller, write, (id) => ({ body: { id } }))
        : await write(),
    }
  },
})
export const remove = internalMutation({
  args: { ...actor, id: v.string(), providers: v.optional(v.boolean()) },
  returns: v.object({ id: v.string(), deleted: v.boolean() }),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    if (args.providers) {
      const id = ctx.db.normalizeId("voiceProviders", args.id),
        row = id ? await ctx.db.get("voiceProviders", id) : null
      if (!row || row.organizationId !== args.organizationId)
        throw notFound("Voice provider")
      const references = await Promise.all([
        ctx.db
          .query("voiceBots")
          .withIndex("by_credentialId", (q) => q.eq("credentialId", row._id))
          .first(),
        ctx.db
          .query("voiceBots")
          .withIndex("by_stt_credentialId", (q) =>
            q.eq("stt.credentialId", row._id)
          )
          .first(),
        ctx.db
          .query("voiceBots")
          .withIndex("by_llm_credentialId", (q) =>
            q.eq("llm.credentialId", row._id)
          )
          .first(),
        ctx.db
          .query("voiceBots")
          .withIndex("by_tts_credentialId", (q) =>
            q.eq("tts.credentialId", row._id)
          )
          .first(),
      ])
      if (references.some(Boolean))
        throw apiError(
          409,
          "credential_in_use",
          "Delete bots using this credential first"
        )
      await ctx.db.delete("voiceProviders", row._id)
    } else {
      const row = await ownedBot(ctx, args.organizationId, args.id)
      const routing = await ctx.db
        .query("callingSettings")
        .withIndex("by_routing_botId", (q) => q.eq("routing.botId", row._id))
        .first()
      if (routing)
        throw apiError(
          409,
          "bot_in_use",
          "Remove number routing before deleting this bot"
        )
      await ctx.db.delete("voiceBots", row._id)
    }
    return { id: args.id, deleted: true }
  },
})
export const transcript = internalQuery({
  args: { ...actor, ...listArgs, id: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // Transcripts require the existing WhatsApp scope, independently of bot CRUD.
    if (!args.caller || args.caller.organizationId !== args.organizationId)
      throw notFound("Call")
    await requireCaller(ctx, args.caller, {
      resource: "whatsapp",
      access: "read",
    })
    const id = ctx.db.normalizeId("calls", args.id),
      call = id ? await ctx.db.get("calls", id) : null
    if (!call || call.organizationId !== args.organizationId)
      throw notFound("Call")
    if (
      !Number.isInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > 100 ||
      (args.after && args.before)
    )
      throw invalid("Use limit 1–100 and one cursor")
    const page = await cursorPage(
      args,
      async (cursor) => {
        const id = ctx.db.normalizeId("callTranscripts", cursor),
          row = id ? await ctx.db.get("callTranscripts", id) : null
        return row?.callId === call._id ? row : null
      },
      (order) =>
        stream(ctx.db, schema)
          .query("callTranscripts")
          .withIndex("by_callId", (q) => q.eq("callId", call._id))
          .order(order)
    )
    return {
      object: "list",
      has_more: page.has_more,
      data: page.data.map(({ _id, _creationTime, organizationId, ...line }) => {
        void _creationTime
        void organizationId
        return { id: _id, ...line }
      }),
    }
  },
})
