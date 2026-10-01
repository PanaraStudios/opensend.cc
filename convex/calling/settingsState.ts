import { emitEvent } from "../events"
import { v } from "convex/values"
import { internalQuery, internalMutation, query } from "../_generated/server"
import schema from "../schema"
import { actorArgs, authorize, numberSettings, defaultMode } from "./rows"
import { handlingMode } from "../tables/calling"
import { findMetaApp } from "../meta/app"
import { retirement } from "../teamLifecycle"
import { invalid } from "../api/caller"

export const cached = query({
  args: { organizationId: v.string(), accountId: v.id("channelAccounts") },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const account = await ctx.db.get("channelAccounts", args.accountId)
    if (
      account?.organizationId !== args.organizationId ||
      account.channel !== "whatsapp"
    )
      throw invalid("Phone number not found.")
    const row = await numberSettings(ctx, args.accountId)
    return {
      handling_mode: row?.mode ?? defaultMode(),
      calling: JSON.parse(row?.settings ?? "{}"),
      restrictions: row?.restrictions ? JSON.parse(row.restrictions) : null,
    }
  },
})
export const store = internalMutation({
  args: {
    accountId: v.id("channelAccounts"),
    settings: v.string(),
    mode: v.optional(handlingMode),
    at: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.get("channelAccounts", args.accountId)
    if (!account || (await retirement(ctx, account.organizationId))) return null
    const previous = await numberSettings(ctx, args.accountId)
    if (previous && args.at !== undefined && args.at < previous.updatedAt)
      return null
    const fields = {
      organizationId: account.organizationId,
      accountId: args.accountId,
      mode: args.mode ?? previous?.mode ?? defaultMode(),
      settings: args.settings,
      updatedAt: args.at ?? Date.now(),
    }
    if (previous) await ctx.db.patch("callingSettings", previous._id, fields)
    else await ctx.db.insert("callingSettings", fields)
    if (
      !previous ||
      previous.settings !== fields.settings ||
      previous.mode !== fields.mode
    )
      await emitEvent(
        ctx,
        account.organizationId,
        "whatsapp.phone_number.updated",
        {
          id: account._id,
          account_id: account._id,
          channel: "whatsapp",
          field: "account_settings_update",
          calling: JSON.parse(fields.settings),
          handling_mode: fields.mode,
        }
      )
    return null
  },
})
export const refreshTarget = internalQuery({
  args: { accountId: v.id("channelAccounts") },
  returns: v.union(
    v.null(),
    v.object({
      encryptedToken: v.string(),
      version: v.string(),
      phoneNumberId: v.string(),
    })
  ),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get("channelAccounts", accountId)
    if (!account || (await retirement(ctx, account.organizationId))) return null
    const connection = await ctx.db.get(
        "metaConnections",
        account.connectionId
      ),
      app = await findMetaApp(ctx)
    if (
      account.channel !== "whatsapp" ||
      account.status === "disconnected" ||
      connection?.status !== "active" ||
      !app
    )
      return null
    return {
      encryptedToken: connection.encryptedToken,
      version: app.graphVersion,
      phoneNumberId: account.externalId,
    }
  },
})
export const permission = internalMutation({
  args: {
    ...actorArgs,
    accountId: v.id("channelAccounts"),
    identity: v.string(),
    data: v.string(),
    observedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const account = await ctx.db.get("channelAccounts", args.accountId)
    if (account?.organizationId !== args.organizationId)
      throw invalid("Phone number not found.")
    const data = JSON.parse(args.data),
      previous = await ctx.db
        .query("callPermissions")
        .withIndex("by_accountId_and_identity", (q) =>
          q.eq("accountId", args.accountId).eq("identity", args.identity)
        )
        .unique()
    if (previous && previous.observedAt > args.observedAt) return null
    const expiration =
      data.permission.expiration_time ?? data.permission.expiration
    const fields = {
      organizationId: args.organizationId,
      accountId: args.accountId,
      identity: args.identity,
      status: data.permission.status,
      observedAt: args.observedAt,
      data: args.data,
      ...(typeof expiration === "number"
        ? { expiresAt: expiration * 1000 }
        : {}),
    }
    if (previous)
      await ctx.db.patch("callPermissions", previous._id, {
        ...fields,
        expiresAt:
          typeof expiration === "number" ? expiration * 1000 : undefined,
      })
    else await ctx.db.insert("callPermissions", fields)
    return null
  },
})
export const announcement = internalQuery({
  args: { ...actorArgs, fileId: v.string() },
  returns: schema.doc("storedFiles"),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    const id = ctx.db.normalizeId("storedFiles", args.fileId)
    const file = id ? await ctx.db.get("storedFiles", id) : null
    if (
      !file ||
      file.organizationId !== args.organizationId ||
      file.state !== "ready" ||
      !file.contentType.startsWith("audio/ogg") ||
      file.size > 16 * 1024 * 1024
    )
      throw invalid(
        "Upload an Ogg Opus voicemail announcement under 60 seconds."
      )
    return file
  },
})
