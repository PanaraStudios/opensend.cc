import { isPageChannel } from "../../lib/channels"
import { pageChannelValue } from "../tables/channels"
import { conversationSearch } from "../channels/identity"
import { v } from "convex/values"
import { internalMutation, internalQuery } from "../_generated/server"
import { patchRow } from "../counts"
import { findMetaApp } from "./app"
import { live } from "./connect"
import { retirement } from "../teamLifecycle"
import { profileNameParts } from "../../lib/meta/webhooks"
import { emitContact, patchContact } from "../audience"

export const version = internalQuery({
  args: {},
  returns: v.union(v.null(), v.string()),
  handler: async (ctx) => (await findMetaApp(ctx))?.graphVersion ?? null,
})
export const refresh = internalMutation({
  args: {
    accountId: v.id("channelAccounts"),
    pageId: v.string(),
    name: v.string(),
    instagram: v.optional(
      v.object({ id: v.string(), username: v.string(), name: v.string() })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.get("channelAccounts", args.accountId)
    if (!account || !live(account) || account.pageId !== args.pageId)
      return null
    const connection = await ctx.db.get("metaConnections", account.connectionId)
    if (
      connection?.status !== "active" ||
      (await retirement(ctx, account.organizationId))
    )
      return null
    const accounts = await ctx.db
      .query("channelAccounts")
      .withIndex("by_connectionId", (q) =>
        q.eq("connectionId", account.connectionId)
      )
      .take(500)
    for (const row of accounts) {
      if (!live(row) || row.pageId !== args.pageId) continue
      const ig = args.instagram
      await patchRow(ctx, "channelAccounts", row._id, {
        checkedAt: Date.now(),
        ...(row.channel === "messenger"
          ? {
              displayName: args.name,
              handle: args.name,
              status: "active" as const,
              error: undefined,
            }
          : row.channel === "instagram" && ig?.id === row.externalId
            ? {
                displayName: ig.name,
                handle: ig.username,
                status: "active" as const,
                error: undefined,
              }
            : {
                status: "restricted" as const,
                error:
                  "Reconnect this Page to refresh its linked Instagram account",
              }),
      })
    }
    return null
  },
})
export const profileTarget = internalQuery({
  args: {
    identityId: v.id("channelContacts"),
    accountId: v.id("channelAccounts"),
  },
  returns: v.union(
    v.null(),
    v.object({
      externalId: v.string(),
      channel: pageChannelValue,
      encryptedToken: v.string(),
      version: v.string(),
    })
  ),
  handler: async (ctx, { identityId, accountId }) => {
    const identity = await ctx.db.get("channelContacts", identityId),
      account = await ctx.db.get("channelAccounts", accountId),
      app = await findMetaApp(ctx)
    if (
      !identity ||
      !account ||
      !app ||
      !live(account) ||
      identity.profileName ||
      !isPageChannel(identity.channel) ||
      identity.channel !== account.channel ||
      identity.scopeId !== account.externalId ||
      identity.organizationId !== account.organizationId ||
      (await retirement(ctx, account.organizationId))
    )
      return null
    const connection = await ctx.db.get("metaConnections", account.connectionId)
    if (connection?.status !== "active") return null
    return {
      externalId: identity.externalId,
      channel: identity.channel,
      encryptedToken: account.encryptedToken ?? connection.encryptedToken,
      version: app.graphVersion,
    }
  },
})
export const profileComplete = internalMutation({
  args: {
    identityId: v.id("channelContacts"),
    name: v.string(),
    username: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { identityId, name, username }) => {
    const identity = await ctx.db.get("channelContacts", identityId)
    if (
      !identity ||
      (!name.trim() && !username?.trim()) ||
      (await retirement(ctx, identity.organizationId))
    )
      return null
    const profileName = name.trim().slice(0, 256)
    const handle =
      identity.channel === "instagram"
        ? username?.trim().replace(/^@/, "").slice(0, 256)
        : undefined
    await ctx.db.patch("channelContacts", identityId, {
      ...(profileName ? { profileName } : {}),
      ...(handle ? { username: handle } : {}),
    })
    const contact = identity.contactId
      ? await ctx.db.get("contacts", identity.contactId)
      : null
    // Profile enrichment never overwrites a CRM's chosen name.
    if (
      contact?.organizationId === identity.organizationId &&
      !contact.firstName &&
      !contact.lastName &&
      profileName
    ) {
      const parts = profileNameParts(profileName)
      const updated = await patchContact(ctx, contact, parts)
      await emitContact(ctx, "contact.updated", updated)
    }
    const threads = await ctx.db
      .query("conversations")
      .withIndex("by_channelContactId", (q) =>
        q.eq("channelContactId", identityId)
      )
      .take(100)
    for (const thread of threads)
      await patchRow(ctx, "conversations", thread._id, {
        search: conversationSearch(
          identity.phone ?? identity.externalId,
          [profileName, handle].filter(Boolean).join(" ")
        ),
      })
    return null
  },
})
