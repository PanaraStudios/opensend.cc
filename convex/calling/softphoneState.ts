import { ConvexError, v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../_generated/server"
import { components } from "../_generated/api"
import { createChannelMessage } from "../channels/messages"
import schema from "../schema"
import {
  agentActor,
  agentPresence,
  requireAvailable,
  requireOnline,
  PRESENCE_TTL,
} from "./agentAccess"
import { ownedCall, authorize } from "./rows"
import { CALL_TERMINAL } from "../../lib/meta/calling"
const browserArgs = { organizationId: v.string(), browserId: v.string() }
const status = v.union(v.literal("online"), v.literal("away"))
export const begin = internalMutation({
  args: browserArgs,
  returns: schema.doc("callAgents"),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    const actor = await agentActor(ctx, args.organizationId)
    const old = await ctx.db
      .query("callAgents")
      .withIndex("by_organizationId_and_userId", (q) =>
        q.eq("organizationId", args.organizationId).eq("userId", actor.userId)
      )
      .unique()
    if (
      old &&
      old.browserId !== args.browserId &&
      old.updatedAt + PRESENCE_TTL > Date.now() &&
      old.expiresAt > Date.now()
    )
      throw new ConvexError(
        "Another browser is using your softphone. Set it away first."
      )
    const same =
      old?.browserId === args.browserId &&
      old.authSessionId === actor.authSessionId &&
      old.expiresAt > Date.now()
    const fields = {
      organizationId: args.organizationId,
      userId: actor.userId,
      name: actor.name,
      authSessionId: actor.authSessionId,
      browserId: args.browserId,
      leaseId: same ? old.leaseId : crypto.randomUUID(),
      status: same ? old.status : ("away" as const),
      extension: same ? old.extension : undefined,
      expiresAt: same ? old.expiresAt : 0,
      updatedAt: Date.now(),
    }
    const id = old?._id ?? (await ctx.db.insert("callAgents", fields))
    if (old) await ctx.db.patch("callAgents", id, fields)
    return (await ctx.db.get("callAgents", id))!
  },
})
export const provisioned = internalMutation({
  args: {
    ...browserArgs,
    leaseId: v.string(),
    extension: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await agentPresence(ctx, args.organizationId, args.browserId)
    if (row.leaseId !== args.leaseId)
      throw new ConvexError("Agent session changed")
    await ctx.db.patch("callAgents", row._id, {
      extension: args.extension,
      expiresAt: args.expiresAt,
    })
    return null
  },
})
export const presence = mutation({
  args: { ...browserArgs, status },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await agentPresence(ctx, args.organizationId, args.browserId)
    if (
      args.status === "online" &&
      (!row.extension || row.expiresAt <= Date.now())
    )
      throw new ConvexError("Register the softphone first")
    await ctx.db.patch("callAgents", row._id, {
      status: args.status,
      updatedAt: Date.now(),
    })
    return null
  },
})
export const context = internalQuery({
  args: browserArgs,
  returns: schema.doc("callAgents"),
  handler: async (ctx, args) =>
    agentPresence(ctx, args.organizationId, args.browserId),
})
export const claim = mutation({
  args: { ...browserArgs, id: v.id("calls") },
  returns: v.id("calls"),
  handler: async (ctx, args) => {
    const agent = await agentPresence(ctx, args.organizationId, args.browserId)
    const call = await ownedCall(ctx, args.organizationId, args.id)
    await requireAvailable(ctx, agent, call._id)
    if (
      call.mode !== "gateway" ||
      call.direction !== "inbound" ||
      !["queued", "ringing"].includes(call.status) ||
      (call.offeredAt ?? call._creationTime) + 60000 <= Date.now()
    )
      throw new ConvexError("Call is no longer available")
    if (
      call.assignedAgent &&
      (call.assignedAgent !== agent.userId ||
        call.agentLeaseId !== agent.leaseId)
    )
      throw new ConvexError("Another agent claimed this call")
    await ctx.db.patch("calls", call._id, {
      assignedAgent: agent.userId,
      agentLeaseId: agent.leaseId,
      agentExtension: agent.extension,
    })
    return call._id
  },
})
export const owned = internalQuery({
  args: { ...browserArgs, id: v.id("calls"), online: v.optional(v.boolean()) },
  returns: schema.doc("calls"),
  handler: async (ctx, args) => {
    const agent = await agentPresence(ctx, args.organizationId, args.browserId)
    if (args.online !== false) requireOnline(agent)
    const call = await ownedCall(ctx, args.organizationId, args.id)
    if (
      call.assignedAgent !== agent.userId ||
      call.agentLeaseId !== agent.leaseId ||
      call.mode !== "gateway"
    )
      throw new ConvexError("Claim this call first")
    return call
  },
})
export const state = query({
  args: { organizationId: v.string() },
  returns: v.object({
    agents: v.array(
      v.object({
        id: v.union(v.id("callAgents"), v.null()),
        name: v.string(),
        userId: v.string(),
        status,
        availableUntil: v.number(),
        extension: v.union(v.string(), v.null()),
      })
    ),
    calls: v.array(schema.doc("calls")),
    me: v.union(
      v.null(),
      v.object({ browserId: v.string(), leaseId: v.string(), status })
    ),
  }),
  handler: async (ctx, args) => {
    await authorize(ctx, args)
    const actor = await agentActor(ctx, args.organizationId)
    const rows = await ctx.db
      .query("callAgents")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .take(100)
    const calls = (
      await Promise.all(
        (["queued", "ringing", "connected"] as const).map((status) =>
          ctx.db
            .query("calls")
            .withIndex("by_organizationId_and_mode_and_status", (q) =>
              q
                .eq("organizationId", args.organizationId)
                .eq("mode", "gateway")
                .eq("status", status)
            )
            .take(100)
        )
      )
    ).flat()

    const members = await ctx.runQuery(
      components.betterAuth.policy.callingMembers,
      { sessionId: actor.authSessionId, organizationId: args.organizationId }
    )
    const me = rows.find(
      (r) =>
        r.userId === actor.userId && r.authSessionId === actor.authSessionId
    )
    return {
      agents: members.map((m) => {
        const r = rows.find((r) => r.userId === m.userId)
        return {
          id: r?._id ?? null,
          name: m.name,
          userId: m.userId,
          availableUntil: r
            ? Math.min(r.updatedAt + PRESENCE_TTL, r.expiresAt)
            : 0,
          extension: r?.extension ?? null,
          status:
            r &&
            r.updatedAt + PRESENCE_TTL > Date.now() &&
            r.expiresAt > Date.now()
              ? r.status
              : ("away" as const),
        }
      }),
      calls: calls
        .filter((c) => c.mode === "gateway" && !CALL_TERMINAL.has(c.status))
        .map((c) => ({
          ...c,
          remoteSession: undefined,
          localSession: undefined,
          preAcceptedSdp: undefined,
        })),
      me: me
        ? { browserId: me.browserId, leaseId: me.leaseId, status: me.status }
        : null,
    }
  },
})
export const transferTarget = internalMutation({
  args: { ...browserArgs, id: v.id("calls"), agentId: v.id("callAgents") },
  returns: schema.doc("callAgents"),
  handler: async (ctx, args) => {
    const source = await agentPresence(ctx, args.organizationId, args.browserId)
    const call = await ownedCall(ctx, args.organizationId, args.id)
    if (call.agentLeaseId !== source.leaseId || call.status !== "connected")
      throw new ConvexError("Claim this call first")
    const target = await ctx.db.get("callAgents", args.agentId)
    if (!target || target.organizationId !== args.organizationId)
      throw new ConvexError("Agent not found")
    if (target._id === source._id) throw new ConvexError("Choose another agent")
    await requireAvailable(ctx, target)
    await ctx.db.patch("callAgents", target._id, {
      reservedCallId: call._id,
      reservationUntil: Date.now() + 45000,
    })
    return target
  },
})
export const transferred = internalMutation({
  args: {
    ...browserArgs,
    id: v.id("calls"),
    leaseId: v.string(),
    targetId: v.optional(v.id("callAgents")),
    targetLeaseId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await agentPresence(ctx, args.organizationId, args.browserId)
    const call = await ownedCall(ctx, args.organizationId, args.id)
    if (
      call.agentLeaseId !== agent.leaseId ||
      agent.leaseId !== args.leaseId ||
      CALL_TERMINAL.has(call.status)
    )
      return null
    const target = args.targetId
      ? await ctx.db.get("callAgents", args.targetId)
      : null
    if (
      args.targetId &&
      (!target ||
        target.organizationId !== args.organizationId ||
        target.leaseId !== args.targetLeaseId)
    )
      throw new ConvexError("Transfer agent session changed")
    if (target) requireOnline(target)
    await ctx.db.patch("calls", call._id, {
      assignedAgent: target?.userId,
      agentLeaseId: target?.leaseId,
      agentExtension: target?.extension,
    })
    return null
  },
})
export const release = mutation({
  args: { ...browserArgs, id: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await agentPresence(ctx, args.organizationId, args.browserId)
    const call = await ownedCall(ctx, args.organizationId, args.id)
    if (
      call.agentLeaseId === agent.leaseId &&
      call.status !== "connected" &&
      !CALL_TERMINAL.has(call.status) &&
      !call.operation
    )
      await ctx.db.patch("calls", call._id, {
        assignedAgent: undefined,
        agentLeaseId: undefined,
        agentExtension: undefined,
      })
    return null
  },
})

export const setAway = internalMutation({
  args: browserArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await agentPresence(ctx, args.organizationId, args.browserId)
    await ctx.db.patch("callAgents", row._id, {
      status: "away",
      expiresAt: 0,
      updatedAt: Date.now(),
    })
    return null
  },
})
export const requestPermission = internalMutation({
  args: {
    organizationId: v.string(),
    accountId: v.id("channelAccounts"),
    recipient: v.string(),
  },
  returns: v.id("channelMessages"),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    return createChannelMessage(
      ctx,
      {
        channel: "whatsapp",
        from: args.accountId,
        body: {
          recipient: args.recipient,
          interactive: {
            type: "call_permission_request",
            action: { name: "call_permission_request" },
            body: { text: "May we call you on WhatsApp?" },
          },
        },
      },
      { organizationId: args.organizationId, source: "dashboard" }
    )
  },
})

export const releaseTransfer = internalMutation({
  args: { ...browserArgs, id: v.id("calls"), targetId: v.id("callAgents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await agentPresence(ctx, args.organizationId, args.browserId)
    const target = await ctx.db.get("callAgents", args.targetId)
    if (
      target?.organizationId === args.organizationId &&
      target.reservedCallId === args.id
    )
      await ctx.db.patch("callAgents", target._id, {
        reservedCallId: undefined,
        reservationUntil: undefined,
      })
    return null
  },
})
