import { ownedBot } from "../voice/resources"
import { v } from "convex/values"
import { stream } from "convex-helpers/server/stream"
import {
  internalMutation,
  internalQuery,
  query,
  action,
  type QueryCtx,
  type MutationCtx,
} from "../_generated/server"
import {
  callerValue,
  requireCaller,
  notFound,
  invalid,
  type Caller,
} from "../api/caller"
import { requireTeam } from "../access"
import { requireActiveTeam } from "../teamLifecycle"
import { idempotent } from "../api/idempotency"
import { listArgs, cursorPage } from "../api/paging"
import schema from "../schema"
import { encryptSecret, decryptSecret } from "../secrets"
import { createWebhookSecret } from "../../lib/dashboard/ids"
import { internal } from "../_generated/api"
import {
  parseIvr,
  ivrPrompts,
  menuActions,
  IVR_LIMITS,
  type IvrDefinition,
  type IvrAction,
} from "../../lib/ivr"
import { renderHash, renderSpec } from "../../lib/ivr-prompts"
import { fileUrl } from "../storage/urls"
import { definition } from "./validators"
import type { Doc } from "../_generated/dataModel"

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
      throw notFound("IVR")
    // Enforce IVR scope even when called from another scoped API route.
    await requireCaller(ctx, {
      ...args.caller,
      scope: { resource: "ivrs", access: write ? "write" : "read" },
    })
  } else await requireTeam(ctx, args.organizationId, write ? "write" : "read")
  await requireActiveTeam(ctx, args.organizationId)
}
export async function own(ctx: QueryCtx, organizationId: string, id: string) {
  const normalized = ctx.db.normalizeId("ivrs", id),
    row = normalized ? await ctx.db.get("ivrs", normalized) : null
  if (!row || row.organizationId !== organizationId) throw notFound("IVR")
  return row
}
export function readDefinition(row: IvrDefinition): IvrDefinition {
  return {
    name: row.name,
    language: row.language,
    entryMenuId: row.entryMenuId,
    menus: row.menus,
    ...(row.promptVoice ? { promptVoice: row.promptVoice } : {}),
    ...(row.businessHours ? { businessHours: row.businessHours } : {}),
  }
}
export async function audioFile(
  ctx: QueryCtx,
  organizationId: string,
  fileId: string
) {
  const id = ctx.db.normalizeId("storedFiles", fileId),
    file = id ? await ctx.db.get("storedFiles", id) : null
  if (
    !file ||
    file.organizationId !== organizationId ||
    file.state !== "ready" ||
    !file.storageId ||
    ![
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg",
      "audio/mp3",
      "audio/ogg",
    ].includes(file.contentType.split(";")[0].trim().toLowerCase()) ||
    file.size < 1 ||
    file.size > IVR_LIMITS.audioBytes
  )
    throw invalid("Use a finalized team WAV, MP3 or OGG file of at most 16 MB.")
  return file
}
export async function checkAction(
  ctx: QueryCtx,
  organizationId: string,
  d: IvrDefinition,
  action: IvrAction
) {
  if (action.kind === "submenu" && !d.menus.some((m) => m.id === action.menuId))
    throw invalid("Unknown submenu")
  if (action.kind === "playAndHangup" && action.prompt.kind === "audio")
    await audioFile(ctx, organizationId, action.prompt.fileId)
  if (action.kind === "webhook" && action.secretId) {
    const id = ctx.db.normalizeId("webhooks", action.secretId),
      row = id ? await ctx.db.get("webhooks", id) : null
    if (!row || row.organizationId !== organizationId)
      throw notFound("Webhook secret")
  }
  if (action.kind === "bot") await ownedBot(ctx, organizationId, action.botId)
}
export async function checked(
  ctx: QueryCtx,
  organizationId: string,
  input: unknown
): Promise<typeof definition.type> {
  let d: IvrDefinition
  try {
    d = parseIvr(input)
  } catch (e) {
    throw invalid((e as Error).message)
  }
  if (d.promptVoice) {
    const id = ctx.db.normalizeId("voiceProviders", d.promptVoice.credentialId),
      key = id ? await ctx.db.get("voiceProviders", id) : null
    if (
      !key ||
      key.organizationId !== organizationId ||
      key.provider !== d.promptVoice.provider
    )
      throw invalid("Choose a team key for the prompt provider")
  }
  for (const p of ivrPrompts(d))
    if (p.kind === "audio") await audioFile(ctx, organizationId, p.fileId)
  for (const a of [
    ...d.menus.flatMap(menuActions),
    ...(d.businessHours ? [d.businessHours.closedAction] : []),
  ])
    await checkAction(ctx, organizationId, d, a)
  // Normalized Convex IDs have been checked above; the shared validator uses portable strings.
  return d as typeof definition.type
}
async function cachePrompts(
  ctx: MutationCtx,
  organizationId: string,
  d: IvrDefinition
) {
  for (const p of ivrPrompts(d))
    if (p.kind === "tts") {
      const hash = await renderHash(d, p),
        spec = renderSpec(d, p)
      if (
        !(await ctx.db
          .query("ivrPromptRenders")
          .withIndex("by_organizationId_and_hash", (q) =>
            q.eq("organizationId", organizationId).eq("hash", hash)
          )
          .unique())
      )
        await ctx.db.insert("ivrPromptRenders", {
          organizationId,
          hash,
          ...spec,
          status: "pending_render",
        })
    }
}
export async function payload(ctx: QueryCtx, row: Doc<"ivrs">) {
  const prompt_renders = await Promise.all(
    ivrPrompts(row).map(async (p) => {
      if (p.kind === "audio") {
        try {
          return {
            kind: p.kind,
            fileId: p.fileId,
            status: "ready" as const,
            audio_url: await fileUrl(
              ctx,
              await audioFile(ctx, row.organizationId, p.fileId)
            ),
          }
        } catch {
          return {
            kind: p.kind,
            fileId: p.fileId,
            status: "failed" as const,
            error: "Audio prompt file is unavailable",
            audio_url: null,
          }
        }
      }
      const hash = await renderHash(row, p),
        cached = await ctx.db
          .query("ivrPromptRenders")
          .withIndex("by_organizationId_and_hash", (q) =>
            q.eq("organizationId", row.organizationId).eq("hash", hash)
          )
          .unique()
      const file = cached?.fileId
        ? await ctx.db.get("storedFiles", cached.fileId)
        : null
      return {
        kind: p.kind,
        text: p.text,
        voice: p.voice ?? row.promptVoice?.voice ?? null,
        hash,
        status: cached?.status ?? "pending_render",
        error: cached?.error ?? null,
        audio_url:
          file?.organizationId === row.organizationId
            ? await fileUrl(ctx, file)
            : null,
      }
    })
  )

  return {
    object: "ivr" as const,
    id: row._id,
    ...readDefinition(row),
    created_at: new Date(row.createdAt).toISOString(),
    updated_at: new Date(row.updatedAt).toISOString(),
    webhook_signing_secret: await decryptSecret(row.webhookSecret),
    prompt_renders,
    prompt_status: prompt_renders.some((p) => p.status === "failed")
      ? "failed"
      : prompt_renders.some((p) => p.status !== "ready")
        ? "pending_render"
        : "ready",
  }
}
async function writeDefinition(
  ctx: MutationCtx,
  args: {
    organizationId: string
    caller?: Caller
    id?: string
    kind: "create" | "update" | "remove"
    body: string
    webhookSecret?: string
  }
): Promise<Record<string, unknown>> {
  await authorize(ctx, args, true)
  const operation = async () => {
    const row =
      args.kind === "create"
        ? null
        : await own(ctx, args.organizationId, args.id!)
    if (args.kind === "remove") {
      // Do not leave settings pointing at a deleted IVR.
      const settings = await ctx.db
        .query("callingSettings")
        .withIndex("by_routingIvrId", (q) =>
          q.eq("routing.kind", "ivr").eq("routing.ivrId", row!._id)
        )
        .take(1)
      if (settings.length)
        throw invalid(
          "Remove this IVR from calling settings before deleting it."
        )
      await ctx.db.delete("ivrs", row!._id)
      return { object: "ivr", id: row!._id, deleted: true }
    }
    const raw = JSON.parse(args.body)
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw invalid("Expected an IVR object")
    if (
      !row &&
      (!args.webhookSecret ||
        !/^whsec_[A-Za-z0-9+/=]+$/.test(args.webhookSecret))
    )
      throw invalid("Missing webhook signing secret")
    const d = await checked(
      ctx,
      args.organizationId,
      row ? { ...readDefinition(row), ...raw } : raw
    )
    await cachePrompts(ctx, args.organizationId, d)
    const now = Date.now()
    const id =
      row?._id ??
      (await ctx.db.insert("ivrs", {
        ...d,
        organizationId: args.organizationId,
        webhookSecret: await encryptSecret(args.webhookSecret!),
        createdAt: now,
        updatedAt: now,
      }))
    if (row)
      await ctx.db.patch("ivrs", id, {
        ...d,
        businessHours: d.businessHours,
        promptVoice: d.promptVoice,
        updatedAt: now,
      })
    if (d.promptVoice)
      await ctx.scheduler.runAfter(0, internal.ivr.rendering.render, { id })
    return payload(ctx, (await ctx.db.get("ivrs", id))!)
  }
  return args.caller
    ? idempotent(ctx, args.caller, operation, (body) => ({
        status: args.kind === "create" ? 201 : 200,
        body,
      }))
    : operation()
}
const writeArgs = {
  ...actor,
  id: v.optional(v.string()),
  kind: v.union(v.literal("create"), v.literal("update"), v.literal("remove")),
  body: v.string(),
  webhookSecret: v.optional(v.string()),
}
export const write = internalMutation({
  args: writeArgs,
  returns: v.record(v.string(), v.any()),
  handler: writeDefinition,
})
export const dashboardWrite = action({
  args: {
    organizationId: v.string(),
    id: writeArgs.id,
    kind: writeArgs.kind,
    body: v.string(),
  },
  returns: v.record(v.string(), v.any()),
  handler: (ctx, args): Promise<Record<string, unknown>> =>
    ctx.runMutation(internal.ivr.definitions.write, {
      ...args,
      ...(args.kind === "create"
        ? { webhookSecret: createWebhookSecret() }
        : {}),
    }),
})
async function getDefinition(
  ctx: QueryCtx,
  args: { organizationId: string; caller?: Caller; id: string }
) {
  await authorize(ctx, args)
  return payload(ctx, await own(ctx, args.organizationId, args.id))
}
export const get = internalQuery({
  args: { ...actor, id: v.string() },
  returns: v.any(),
  handler: getDefinition,
})
export const dashboardGet = query({
  args: { organizationId: v.string(), id: v.string() },
  returns: v.any(),
  handler: getDefinition,
})
async function listDefinitions(
  ctx: QueryCtx,
  args: {
    organizationId: string
    caller?: Caller
    limit: number
    after?: string
    before?: string
  }
) {
  await authorize(ctx, args)
  if (
    !Number.isInteger(args.limit) ||
    args.limit < 1 ||
    args.limit > 100 ||
    (args.after && args.before)
  )
    throw invalid("Use a limit from 1 to 100 and one cursor")
  const page = await cursorPage(
    args,
    async (id) => {
      try {
        return await own(ctx, args.organizationId, id)
      } catch {
        return null
      }
    },
    (order) =>
      stream(ctx.db, schema)
        .query("ivrs")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", args.organizationId)
        )
        .order(order)
  )
  return {
    object: "list",
    has_more: page.has_more,
    data: await Promise.all(page.data.map((row) => payload(ctx, row))),
  }
}
export const list = internalQuery({
  args: { ...actor, ...listArgs },
  returns: v.any(),
  handler: listDefinitions,
})
export const dashboardList = query({
  args: { organizationId: v.string(), ...listArgs },
  returns: v.any(),
  handler: listDefinitions,
})
export const validate = internalQuery({
  args: { ...actor, id: v.string(), body: v.string() },
  returns: v.object({ valid: v.boolean(), errors: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const row = await own(ctx, args.organizationId, args.id)
    try {
      await checked(ctx, args.organizationId, {
        ...readDefinition(row),
        ...JSON.parse(args.body),
      })
      return { valid: true, errors: [] }
    } catch (e) {
      return {
        valid: false,
        errors: [e instanceof Error ? e.message : "Invalid IVR"],
      }
    }
  },
})

export const dashboardValidate = action({
  args: { organizationId: v.string(), id: v.string(), body: v.string() },
  returns: v.object({ valid: v.boolean(), errors: v.array(v.string()) }),
  handler: (ctx, args): Promise<{ valid: boolean; errors: string[] }> =>
    ctx.runQuery(internal.ivr.definitions.validate, args),
})
