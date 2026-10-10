import { selectBot } from "../voice/routing"
import { ConvexError } from "convex/values"
import schema from "../schema"
import { internal } from "../_generated/api"
import { agentPresence, requireAvailable } from "./agentAccess"
import { own as ownIvr } from "../ivr/definitions"
import { v } from "convex/values"
import {
  query,
  internalQuery,
  internalMutation,
  env,
} from "../_generated/server"
import {
  authorize,
  ownedCall,
  payload,
  defaultMode,
  gatewayConfigured,
} from "./rows"
import { validAgentWssUrl } from "../../lib/calling/configuration"
import { callDetailValue } from "./values"
import { audioFile } from "../ivr/definitions"
import { fileUrl } from "../storage/urls"
export const setup = query({
  args: { organizationId: v.string() },
  returns: v.object({
    configured: v.boolean(),
    routingConfigured: v.boolean(),
    numbers: v.array(
      v.object({
        id: v.id("channelAccounts"),
        label: v.string(),
        routing: v.union(v.null(), v.string()),
        mode: v.union(v.literal("gateway"), v.literal("api")),
      })
    ),
  }),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const accounts = await ctx.db
      .query("channelAccounts")
      .withIndex("by_organizationId_and_channel_and_disconnectedAt", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("channel", "whatsapp")
          .eq("disconnectedAt", undefined)
      )
      .take(100)
    return {
      routingConfigured: gatewayConfigured(),
      configured:
        gatewayConfigured() && validAgentWssUrl(env.CALL_AGENT_WSS_URL),
      numbers: await Promise.all(
        accounts
          .filter((a) => a.status !== "disconnected")
          .map(async (a) => {
            const s = await ctx.db
              .query("callingSettings")
              .withIndex("by_accountId", (q) => q.eq("accountId", a._id))
              .unique()
            return {
              id: a._id,
              label: a.handle || a.displayName,
              mode: s?.mode ?? defaultMode(),
              routing:
                s?.routing?.kind === "ivr"
                  ? `ivr:${s.routing.ivrId}`
                  : s?.routing?.kind === "bot"
                    ? `bot:${s.routing.botId}`
                    : (s?.routing?.kind ?? null),
            }
          })
      ),
    }
  },
})
export const detail = query({
  args: { organizationId: v.string(), id: v.id("calls") },
  returns: callDetailValue,
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const row = await ownedCall(ctx, args.organizationId, args.id)
    const events = await ctx.db
      .query("callEvents")
      .withIndex("by_callId", (q) => q.eq("callId", row._id))
      .order("desc")
      .take(100)
    return {
      ...(await payload(ctx, row)),
      events: events.map((e) => ({
        event: e.event,
        at: e.at,
        details: JSON.parse(e.details),
      })),
    }
  },
})
export const audio = query({
  args: { organizationId: v.string(), fileId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    return fileUrl(ctx, await audioFile(ctx, args.organizationId, args.fileId))
  },
})

export const create = internalMutation({
  args: {
    organizationId: v.string(),
    browserId: v.string(),
    accountId: v.id("channelAccounts"),
    ivrId: v.optional(v.id("ivrs")),
    botId: v.optional(v.id("voiceBots")),
    contactId: v.optional(v.id("contacts")),
  },
  returns: schema.doc("calls"),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    const agent = await agentPresence(ctx, args.organizationId, args.browserId)
    await requireAvailable(ctx, agent)
    if (Number(!!args.ivrId) + Number(!!args.botId) !== 1)
      throw new ConvexError("Choose an IVR or a voice bot")
    if (args.ivrId) await ownIvr(ctx, args.organizationId, args.ivrId)
    const account = await ctx.db.get("channelAccounts", args.accountId)
    if (
      !account ||
      account.organizationId !== args.organizationId ||
      account.channel !== "whatsapp" ||
      account.status === "disconnected"
    )
      throw new ConvexError("Choose a connected team WhatsApp number")
    if (args.contactId) {
      const contact = await ctx.db.get("contacts", args.contactId)
      if (!contact || contact.organizationId !== args.organizationId)
        throw new ConvexError("Contact not found")
    }
    const id = await ctx.db.insert("calls", {
      organizationId: args.organizationId,
      accountId: args.accountId,
      direction: "inbound",
      status: "ringing",
      mode: "gateway",
      test: true,
      testUserId: agent.userId,
      testBrowserId: args.browserId,
      assignedAgent: agent.userId,
      agentLeaseId: agent.leaseId,
      agentExtension: agent.extension,
      ivrId: args.ivrId,
      contactId: args.contactId,
      observedAt: Date.now(),
      offeredAt: Date.now(),
    })
    if (args.botId) {
      const selected = await selectBot(
        ctx,
        (await ctx.db.get("calls", id))!,
        args.botId
      )
      if (selected.target !== "bot")
        throw new ConvexError("Bot provider credentials are unavailable")
    }
    await ctx.scheduler.runAfter(330000, internal.calling.playground.ended, {
      id,
      at: Date.now() + 330000,
      reason: "Test duration cap",
    })
    return (await ctx.db.get("calls", id))!
  },
})
export const owned = internalQuery({
  args: {
    organizationId: v.string(),
    browserId: v.string(),
    id: v.id("calls"),
  },
  returns: schema.doc("calls"),
  handler: async (ctx, args) => {
    const agent = await agentPresence(ctx, args.organizationId, args.browserId)
    const call = await ownedCall(ctx, args.organizationId, args.id)
    if (
      !call.test ||
      call.testUserId !== agent.userId ||
      call.testBrowserId !== args.browserId
    )
      throw new ConvexError("Test call belongs to another browser")
    return call
  },
})

export const contacts = query({
  args: { organizationId: v.string() },
  returns: v.array(v.object({ id: v.id("contacts"), label: v.string() })),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .take(100)
    return rows.map((c) => ({
      id: c._id,
      label:
        [c.firstName, c.lastName].filter(Boolean).join(" ") ||
        c.email ||
        c.phone ||
        "Contact",
    }))
  },
})
