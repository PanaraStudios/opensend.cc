import { own as ownedIvr } from "../ivr/definitions"
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
    if (routing.kind === "ivr")
      return {
        kind: "ivr" as const,
        ivrId: (await ownedIvr(ctx, args.organizationId, routing.ivrId))._id,
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
    if (args.routing.kind === "ivr")
      await ownedIvr(ctx, args.organizationId, args.routing.ivrId)
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
    if (call.test && agent.userId === call.testUserId) continue
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
function answerStamp(call: Doc<"calls">) {
  return call.connectedAt !== undefined ? { answeredAt: call.connectedAt } : {}
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
        ...answerStamp(call),
      }
    if (!route || call.direction !== "inbound")
      return {
        callId: id,
        target: call.agentExtension ? ("agent" as const) : ("ivr" as const),
        ...(call.agentExtension ? { extension: call.agentExtension } : {}),
        ...answerStamp(call),
      }
    if (route.kind === "api")
      throw invalid(
        "API routing requires API handling mode before the call starts"
      )
    if (route.kind === "ivr") {
      const ivr = await ownedIvr(ctx, call.organizationId, route.ivrId)
      return {
        callId: id,
        target: "ivr" as const,
        ivrId: ivr._id,
        ...answerStamp(call),
      }
    }
    if (route.kind === "bot") return selectBot(ctx, call, route.botId)

    const agent = await availableAgent(ctx, call)
    return agent
      ? {
          callId: id,
          target: "agent" as const,
          extension: agent.extension,
          ...answerStamp(call),
        }
      : {
          callId: id,
          target: "voicemail" as const,
          maxDurationSeconds: 60,
          ...answerStamp(call),
        }
  },
})

export async function selectBot(
  ctx: MutationCtx,
  call: Doc<"calls">,
  botId: string
) {
  let reason: string | undefined
  const bot = await ownedBot(ctx, call.organizationId, botId)
  const now = Date.now(),
    date = new Date(now),
    monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  const cap = bot.maxConcurrentCalls ?? 100
  const active = call.test
    ? []
    : (
        await Promise.all(
          [undefined, false].map((test) =>
            ctx.db
              .query("calls")
              .withIndex("by_organizationId_and_botActive_and_test", (q) =>
                q
                  .eq("organizationId", call.organizationId)
                  .eq("botActive", true)
                  .eq("test", test)
              )
              .take(cap)
          )
        )
      ).flat()
  if (!call.test && active.length >= cap) reason = "concurrency_exhausted"
  if (!call.test && !reason && bot.monthlyMinuteBudget !== undefined) {
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
    await ctx.db.patch("calls", call._id, {
      botId: _id,
      botConfig: config,
      botActive: true,
      botStartedAt: call.botStartedAt ?? now,
      botSessionStartedAt: now,
      botEndedAt: undefined,
      botOutcome: undefined,
      botSummary: undefined,
      botFallbackReason: undefined,
      botSessionUsage: undefined,
    })
    if (!call.test)
      await minuteUsage.replaceOrInsert(
        ctx,
        call,
        (await ctx.db.get("calls", call._id))!
      )
    // Release orphaned reservations even if the gateway never starts or callbacks are lost.
    await ctx.scheduler.runAfter(
      (bot.maxDurationSeconds + 30) * 1000,
      internal.voice.routing.expire,
      { id: call._id, startedAt: now }
    )
    return {
      callId: call._id,
      target: "bot" as const,
      botId: _id,
      organizationId: call.organizationId,
      record: bot.recording,
      silenceTimeoutSeconds: bot.silenceTimeoutSeconds,
      maxDurationSeconds: bot.maxDurationSeconds,
      ...answerStamp(call),
    }
  }
  await ctx.db.patch("calls", call._id, {
    botId: bot._id,
    botFallbackReason: reason,
    botOutcome: reason === "budget_exhausted" ? "budget_exhausted" : "failed",
  })
  const agent = await availableAgent(ctx, call)
  return agent
    ? {
        callId: call._id,
        target: "agent" as const,
        extension: agent.extension,
        ...answerStamp(call),
      }
    : {
        callId: call._id,
        target: "voicemail" as const,
        maxDurationSeconds: 60,
        ...answerStamp(call),
      }
}
export const expire = internalMutation({
  args: { id: v.id("calls"), startedAt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, startedAt }) => {
    const call = await ctx.db.get("calls", id)
    if (
      call?.botStartedAt &&
      !call.botEndedAt &&
      (startedAt === undefined ||
        startedAt === (call.botSessionStartedAt ?? call.botStartedAt))
    ) {
      await ctx.db.patch("calls", id, {
        botActive: false,
        botEndedAt: Date.now(),
        botDuration:
          (call.botDuration ?? 0) + (call.botConfig?.maxDurationSeconds ?? 600),
        botOutcome: "failed",
      })
      if (!call.test)
        await minuteUsage.replaceOrInsert(
          ctx,
          call,
          (await ctx.db.get("calls", id))!
        )
    }
    return null
  },
})
