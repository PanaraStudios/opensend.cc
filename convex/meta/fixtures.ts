import { v } from "convex/values"
import { env, internalMutation } from "../_generated/server"
import { encryptSecret } from "../secrets"
import { localHttpOrigin } from "../../lib/net/public-host"
import { insertRow } from "../counts"

/** Internal/admin-key fixture for the disposable e2e backend. No public API,
    and disabled unless the installation points Graph at a local test server. */
export const seedAccount = internalMutation({
  args: { organizationId: v.string() },
  returns: v.id("channelAccounts"),
  handler: async (ctx, { organizationId }) => {
    if (!env.META_GRAPH_ORIGIN || !localHttpOrigin(env.META_GRAPH_ORIGIN))
      throw new Error("A local fake Graph server is required")
    const existing = await ctx.db
      .query("channelAccounts")
      .withIndex("by_channel_and_externalId", (q) =>
        q.eq("channel", "whatsapp").eq("externalId", "106540352242922")
      )
      .unique()
    if (existing) {
      if (existing.organizationId !== organizationId)
        throw new Error("Fixture account belongs to another team")
      return existing._id
    }
    const connectionId = await ctx.db.insert("metaConnections", {
      organizationId,
      businessId: "meta-inbound-e2e",
      businessName: "Inbound E2E",
      method: "manual_token",
      encryptedToken: await encryptSecret("meta-inbound-e2e-token"),
      tokenLast4: "oken",
      scopes: ["whatsapp_business_messaging"],
      status: "active",
    })
    await ctx.db.insert("whatsappBusinessAccounts", {
      organizationId,
      wabaId: "102290129340398",
      connectionId,
    })
    return await insertRow(ctx, "channelAccounts", {
      organizationId,
      connectionId,
      channel: "whatsapp",
      externalId: "106540352242922",
      wabaId: "102290129340398",
      displayName: "Inbound E2E",
      handle: "+15550783881",
      status: "active",
      throughputMps: 80,
    })
  },
})
export const seedOutbound = internalMutation({
  args: { accountId: v.id("channelAccounts"), externalId: v.string() },
  returns: v.id("channelMessages"),
  handler: async (ctx, args) => {
    if (!env.META_GRAPH_ORIGIN || !localHttpOrigin(env.META_GRAPH_ORIGIN))
      throw new Error("A local fake Graph server is required")
    const account = await ctx.db.get("channelAccounts", args.accountId)
    if (!account || account.externalId !== "106540352242922")
      throw new Error("Fixture account missing")
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_accountId_and_channelContactId", (q) =>
        q.eq("accountId", args.accountId)
      )
      .first()
    if (!conversation?.channelContactId)
      throw new Error("Post an inbound fixture first")
    const identity = (await ctx.db.get(
      "channelContacts",
      conversation.channelContactId
    ))!
    return insertRow(ctx, "channelMessages", {
      organizationId: account.organizationId,
      channel: "whatsapp",
      accountId: account._id,
      conversationId: conversation._id,
      channelContactId: identity._id,
      direction: "outbound",
      from: account.externalId,
      to: identity.externalId,
      type: "text",
      status: "sent",
      preview: "E2E reply",
      externalId: args.externalId,
      generation: 1,
      attempts: 1,
      search: "E2E reply",
    })
  },
})
