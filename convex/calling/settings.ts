"use node"
import { v } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import { actorArgs } from "./rows"
import { callingRouting, handlingMode } from "../tables/calling"
import { graph } from "../meta/graph"
import { decryptSecret } from "../secrets"
import { readFile } from "../storage/objects"
import { whatsappMediaMultipart } from "../../lib/meta/media"
import {
  buildCallingSettingsPayload,
  CALL_PERMISSION_STATUSES,
} from "../../lib/meta/calling"
import { object, string } from "../../lib/meta/parse"
import { invalid, apiError } from "../api/caller"
import { callingFailure } from "./callActions"
import type { Id } from "../_generated/dataModel"

const settingsArgs = {
  ...actorArgs,
  from: v.string(),
  calling: v.optional(v.record(v.string(), v.any())),
  mode: v.optional(handlingMode),
  routing: v.optional(v.record(v.string(), v.any())),
  announcementFileId: v.optional(v.string()),
}
async function settings(
  ctx: ActionCtx,
  args: {
    organizationId: string
    caller?: typeof actorArgs.caller.type
    from: string
    calling?: Record<string, unknown>
    mode?: "gateway" | "api"
    routing?: Record<string, unknown>
    announcementFileId?: string
  }
): Promise<{
  account_id: Id<"channelAccounts">
  handling_mode: "api" | "gateway"
  calling: Record<string, unknown>
  routing: typeof callingRouting.type | null
}> {
  const target = await ctx.runQuery(internal.calling.rows.target, {
    organizationId: args.organizationId,
    caller: args.caller,
    from: args.from,
    write:
      args.calling !== undefined ||
      args.mode !== undefined ||
      args.routing !== undefined ||
      args.announcementFileId !== undefined,
  })
  if (
    (args.mode === "gateway" ||
      (args.routing !== undefined && args.routing.kind !== "api")) &&
    (!process.env.CALL_GATEWAY_URL || !process.env.CALL_GATEWAY_SECRET)
  )
    throw apiError(
      503,
      "gateway_unavailable",
      "The calling gateway is not configured."
    )
  const routing = args.routing
    ? await ctx.runQuery(internal.voice.routing.validate, {
        organizationId: args.organizationId,
        caller: args.caller,
        input: args.routing,
        mode: args.routing.kind === "api" ? "api" : "gateway",
      })
    : undefined
  const at = Date.now(),
    token = await decryptSecret(target.encryptedToken)
  let update = args.calling
  try {
    if (args.announcementFileId) {
      const file = await ctx.runQuery(
        internal.calling.settingsState.announcement,
        {
          organizationId: args.organizationId,
          caller: args.caller,
          fileId: args.announcementFileId,
        }
      )
      const blob = await readFile(ctx, { fileId: file._id })
      if (!blob) throw invalid("Announcement file is unavailable.")
      const bytes = new Uint8Array(await blob.arrayBuffer())
      validateAnnouncement(bytes)
      const reply = object(
        await graph({
          token,
          version: target.version,
          path: `${target.account.externalId}/media`,
          method: "POST",
          body: whatsappMediaMultipart(
            bytes,
            "audio/ogg; codecs=opus",
            file.filename ?? "announcement.ogg",
            `opensend_${crypto.randomUUID().replaceAll("-", "")}`,
            { use_case: "call_voicemail_announcement" }
          ),
        })
      )
      if (!string(reply.id))
        throw apiError(
          502,
          "invalid_meta_response",
          "Meta returned no announcement media id."
        )
      const voicemail = object(update?.voicemail),
        audio = object(voicemail.audio)
      update = {
        ...update,
        voicemail: {
          ...voicemail,
          audio: {
            ...audio,
            default: {
              ...object(audio.default),
              announcement_media_id: reply.id,
            },
          },
        },
      }
    }
    if (update !== undefined) {
      let body: ReturnType<typeof buildCallingSettingsPayload>
      try {
        body = buildCallingSettingsPayload(
          update,
          object(JSON.parse(target.settings?.settings ?? "{}")),
          new Date(at).toISOString().slice(0, 10)
        )
      } catch (e) {
        throw invalid((e as Error).message)
      }
      await graph({
        token,
        version: target.version,
        method: "POST",
        path: `${target.account.externalId}/settings`,
        body: { json: body },
      })
    }
    const remote = object(
      await graph({
        token,
        version: target.version,
        method: "GET",
        path: `${target.account.externalId}/settings`,
      })
    )
    const calling = object(remote.calling)
    await ctx.runMutation(internal.calling.settingsState.store, {
      accountId: target.account._id,
      settings: JSON.stringify(calling),
      mode:
        args.routing?.kind === "api"
          ? "api"
          : args.routing !== undefined && args.routing.kind !== "api"
            ? "gateway"
            : args.mode,
      at,
    })
    if (routing)
      await ctx.runMutation(internal.voice.routing.set, {
        organizationId: args.organizationId,
        caller: args.caller,
        accountId: target.account._id,
        routing,
      })
    return {
      routing: routing ?? target.settings?.routing ?? null,
      account_id: target.account._id,
      handling_mode:
        (args.routing?.kind === "api"
          ? "api"
          : args.routing !== undefined && args.routing.kind !== "api"
            ? "gateway"
            : args.mode) ??
        target.settings?.mode ??
        (process.env.CALL_GATEWAY_URL && process.env.CALL_GATEWAY_SECRET
          ? "gateway"
          : "api"),
      calling,
    }
  } catch (error) {
    callingFailure(error, "settings")
  }
}
/** Opus Ogg's final granule position is its 48k sample count; reject long announcements before upload. */
export function validateAnnouncement(bytes: Uint8Array) {
  if (
    new TextDecoder().decode(bytes.subarray(0, 4)) !== "OggS" ||
    !Buffer.from(bytes).includes(Buffer.from("OpusHead"))
  )
    throw invalid("The announcement must be Ogg Opus.")
  let pos = 0,
    granule = 0n
  while (pos + 27 <= bytes.length) {
    if (new TextDecoder().decode(bytes.subarray(pos, pos + 4)) !== "OggS")
      throw invalid("Invalid Ogg announcement.")
    const view = new DataView(bytes.buffer, bytes.byteOffset + pos, 27)
    const value = view.getBigUint64(6, true)
    if (value !== 0xffffffffffffffffn) granule = value
    const count = bytes[pos + 26]
    if (pos + 27 + count > bytes.length)
      throw invalid("Invalid Ogg announcement.")
    let size = 27 + count
    for (let i = 0; i < count; i++) size += bytes[pos + 27 + i]
    pos += size
  }
  if (pos !== bytes.length || granule === 0n || granule >= 60n * 48000n)
    throw invalid("The announcement must be under 60 seconds.")
}
export const getOrUpdate = internalAction({
  args: settingsArgs,
  returns: v.any(),
  handler: settings,
})
export const dashboardUpdate = action({
  args: {
    organizationId: v.string(),
    from: v.string(),
    calling: v.optional(v.record(v.string(), v.any())),
    mode: v.optional(handlingMode),
    routing: v.optional(callingRouting),
    announcementFileId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: settings,
})
export const permissions = internalAction({
  args: {
    ...actorArgs,
    from: v.optional(v.string()),
    identity: v.string(),
    bsuid: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: checkPermission,
})
export async function checkPermission(
  ctx: ActionCtx,
  {
    identity,
    bsuid,
    ...actor
  }: {
    organizationId: string
    caller?: import("../api/caller").Caller
    from?: string
    identity: string
    bsuid?: boolean
  }
): Promise<Record<string, unknown>> {
  const target = await ctx.runQuery(internal.calling.rows.target, actor)
  const userId = await ctx.runQuery(internal.calling.rows.permissionIdentity, {
    ...actor,
    identity,
    bsuid,
  })
  try {
    const observedAt = Date.now()
    const data = object(
      await graph({
        token: await decryptSecret(target.encryptedToken),
        version: target.version,
        method: "GET",
        path: `${target.account.externalId}/call_permissions`,
        query: { recipient: userId },
      })
    )
    const permission = object(data.permission)
    if (
      !CALL_PERMISSION_STATUSES.includes(
        string(permission.status) as (typeof CALL_PERMISSION_STATUSES)[number]
      )
    )
      throw apiError(
        502,
        "invalid_meta_response",
        "Meta returned an unknown permission status."
      )
    await ctx.runMutation(internal.calling.settingsState.permission, {
      organizationId: actor.organizationId,
      caller: actor.caller,
      accountId: target.account._id,
      identity: userId,
      data: JSON.stringify(data),
      observedAt,
    })
    return { account_id: target.account._id, user_id: userId, ...data }
  } catch (error) {
    callingFailure(error)
  }
}

export const refresh = internalAction({
  args: { accountId: v.id("channelAccounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    const target = await ctx.runQuery(
      internal.calling.settingsState.refreshTarget,
      { accountId }
    )
    if (!target) return null
    const at = Date.now(),
      data = object(
        await graph({
          token: await decryptSecret(target.encryptedToken),
          version: target.version,
          method: "GET",
          path: `${target.phoneNumberId}/settings`,
        })
      )
    await ctx.runMutation(internal.calling.settingsState.store, {
      accountId,
      settings: JSON.stringify(object(data.calling)),
      at,
    })
    return null
  },
})
