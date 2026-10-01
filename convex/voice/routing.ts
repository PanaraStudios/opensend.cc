import { emitEvent } from "../events"
import { validateRouting } from "../../lib/voice-bots"
import { minuteUsage } from "./usage"
import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { callingRouting, handlingMode } from "../tables/calling"
import { actorArgs, authorize, numberSettings } from "../calling/rows"
import { ownedBot } from "./resources"
import { requireAvailable } from "../calling/agentAccess"
import { invalid, notFound } from "../api/caller"
import { CALL_TERMINAL } from "../../lib/meta/calling"
import { requireActiveTeam } from "../teamLifecycle"
import { internal } from "../_generated/api"
export const validate = internalQuery({
  args: {
    ...actorArgs,
    input: v.record(v.string(), v.any()),
    mode: handlingMode,
  },
  returns: callingRouting,
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    let routing
    try {
      routing = validateRouting(args.input)
    } catch {
      throw invalid("Invalid calling routing")
    }
    if (routing.kind !== "api" && args.mode !== "gateway")
      throw invalid("Agents and bots require gateway handling mode")
    if (routing.kind === "bot")
      return {
        kind: "bot" as const,
        botId: (await ownedBot(ctx, args.organizationId, routing.botId))._id,
      }
    return routing
  },
})
export const set = internalMutation({
  args: {
    ...actorArgs,
    accountId: v.id("channelAccounts"),
    routing: callingRouting,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    const account = await ctx.db.get("channelAccounts", args.accountId)
    if (
      account?.organizationId !== args.organizationId ||
      account.channel !== "whatsapp"
    )
      throw notFound("Phone number")
    if (args.routing.kind === "bot")
      await ownedBot(ctx, args.organizationId, args.routing.botId)
    const row = await numberSettings(ctx, args.accountId)
    if (!row) throw invalid("Save calling settings first")
    if (args.routing.kind !== "api" && row.mode !== "gateway")
      throw invalid("Bot routing requires gateway handling mode")
    await ctx.db.patch("callingSettings", row._id, {
      routing: args.routing,
      updatedAt: Date.now(),
    })
    if (JSON.stringify(row.routing) !== JSON.stringify(args.routing))
      await emitEvent(
        ctx,
        args.organizationId,
        "whatsapp.phone_number.updated",
        {
          id: account._id,
          account_id: account._id,
          channel: "whatsapp",
          field: "calling_routing",
          routing: args.routing,
          handling_mode: row.mode,
        }
      )
    return null
  },
})
export async function availableAgent(ctx: MutationCtx, call: Doc<"calls">) {
  const agents = await ctx.db
    .query("callAgents")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", call.organizationId)
    )
    .take(100)
  for (const agent of agents) {
    try {
      await requireAvailable(ctx, agent, call._id)
    } catch {
      continue
    }
    await ctx.db.patch("callAgents", agent._id, {
      reservedCallId: call._id,
      reservationUntil: Date.now() + 60000,
    })
    await ctx.db.patch("calls", call._id, {
      assignedAgent: agent.userId,
      agentLeaseId: agent.leaseId,
      agentExtension: agent.extension,
    })
    return agent
  }
  return null
}
export const select = internalMutation({
  args: { id: v.id("calls") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const call = await ctx.db.get("calls", id)
    if (!call || call.mode !== "gateway" || CALL_TERMINAL.has(call.status))
      throw notFound("Gateway call")
    await requireActiveTeam(ctx, call.organizationId)
    const settings = await numberSettings(ctx, call.accountId),
      route = settings?.routing
    if (call.botActive && call.botId && call.botConfig)
      return {
        callId: id,
        target: "bot" as const,
        botId: call.botId,
        organizationId: call.organizationId,
        record: call.botConfig.recording,
        silenceTimeoutSeconds: call.botConfig.silenceTimeoutSeconds,
        maxDurationSeconds: call.botConfig.maxDurationSeconds,
      }
    if (!route || call.direction !== "inbound")
      return {
        callId: id,
        target: call.agentExtension ? ("agent" as const) : ("ivr" as const),
        ...(call.agentExtension ? { extension: call.agentExtension } : {}),
      }
    if (route.kind === "api")
      throw invalid(
        "API routing requires API handling mode before the call starts"
      )
    let reason: string | undefined
    if (route.kind === "bot") {
      const bot = await ownedBot(ctx, call.organizationId, route.botId)
      const now = Date.now(),
        date = new Date(now),
        monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
      const cap = bot.maxConcurrentCalls ?? 100
      const active = await ctx.db
        .query("calls")
        .withIndex("by_organizationId_and_botActive", (q) =>
          q.eq("organizationId", call.organizationId).eq("botActive", true)
        )
        .take(cap)
      if (active.length >= cap) reason = "concurrency_exhausted"
      if (!reason && bot.monthlyMinuteBudget !== undefined) {
        const seconds = await minuteUsage.sum(ctx, {
          namespace: call.organizationId,
          bounds: {
            lower: { key: monthStart, inclusive: true },
            upper: { key: now, inclusive: true },
          },
        })
        if (seconds + bot.maxDurationSeconds > bot.monthlyMinuteBudget * 60)
          reason = "budget_exhausted"
      }
      const credential = await ctx.db.get("voiceProviders", bot.credentialId)
      if (
        !credential ||
        credential.organizationId !== call.organizationId ||
        credential.provider !== bot.provider
      )
        reason = "credential_unavailable"
      if (!reason) {
        const {
          _id,
          _creationTime,
          organizationId,
          createdAt,
          updatedAt,
          ...config
        } = bot
        void _creationTime
        void organizationId
        void createdAt
        void updatedAt
        await ctx.db.patch("calls", id, {
          botId: _id,
          botConfig: config,
          botActive: true,
          botStartedAt: now,
        })
        await minuteUsage.insertIfDoesNotExist(
          ctx,
          (await ctx.db.get("calls", id))!
        )
        // Release orphaned reservations even if the gateway never starts or callbacks are lost.
        await ctx.scheduler.runAfter(
          (bot.maxDurationSeconds + 30) * 1000,
          internal.voice.routing.expire,
          { id }
        )
        return {
          callId: id,
          target: "bot" as const,
          botId: _id,
          organizationId: call.organizationId,
          record: bot.recording,
          silenceTimeoutSeconds: bot.silenceTimeoutSeconds,
          maxDurationSeconds: bot.maxDurationSeconds,
        }
      }
      await ctx.db.patch("calls", id, {
        botId: bot._id,
        botFallbackReason: reason,
        botOutcome:
          reason === "budget_exhausted" ? "budget_exhausted" : "failed",
      })
    }
    const agent = await availableAgent(ctx, call)
    return agent
      ? { callId: id, target: "agent" as const, extension: agent.extension }
      : { callId: id, target: "voicemail" as const, maxDurationSeconds: 60 }
  },
})
export const expire = internalMutation({
  args: { id: v.id("calls") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const call = await ctx.db.get("calls", id)
    if (call?.botStartedAt && !call.botEndedAt) {
      await ctx.db.patch("calls", id, {
        botActive: false,
        botEndedAt: Date.now(),
        botDuration: call.botConfig?.maxDurationSeconds ?? 600,
        botOutcome: "failed",
      })
      await minuteUsage.replaceOrInsert(
        ctx,
        call,
        (await ctx.db.get("calls", id))!
      )
    }
    return null
  },
})
