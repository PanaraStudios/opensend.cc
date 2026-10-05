import { v } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import {
  callerValue,
  requireCaller,
  notFound,
  apiError,
  type Caller,
} from "./api/caller"
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter"
import { requireTeam } from "./access"
import { requireActiveTeam } from "./teamLifecycle"
import {
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server"
import { components, internal } from "./_generated/api"

const outboundLimiter = new RateLimiter(components.rateLimiter, {
  botTest: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 10 },
  knowledgeIndex: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  knowledgeSearch: {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 20,
  },
  templatePublish: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 2,
  },
  templateSync: { kind: "token bucket", rate: 2, period: MINUTE, capacity: 2 },
})
const outboundOperation = v.union(
  v.literal("botTest"),
  v.literal("knowledgeIndex"),
  v.literal("knowledgeSearch"),
  v.literal("templatePublish"),
  v.literal("templateSync")
)

/** One allowance per team, shared by dashboard and REST and every resource/key. */
export async function limitOutbound(
  ctx: MutationCtx,
  organizationId: string,
  operation:
    | "botTest"
    | "knowledgeIndex"
    | "knowledgeSearch"
    | "templatePublish"
    | "templateSync"
) {
  const result = await outboundLimiter.limit(ctx, operation, {
    key: organizationId,
  })
  if (!result.ok)
    throw apiError(
      429,
      "rate_limit_exceeded",
      `Too many requests. Try again in ${Math.ceil(result.retryAfter / 1000)} seconds.`
    )
}

/** Actions reserve in a committed mutation before IO, so failed IO still counts.
    Only internal callers use this, after their resource authorization. */
export const reserveOutbound = internalMutation({
  args: { organizationId: v.string(), operation: outboundOperation },
  returns: v.null(),
  handler: async (ctx, { organizationId, operation }) => {
    await requireActiveTeam(ctx, organizationId)
    await limitOutbound(ctx, organizationId, operation)
    return null
  },
})
export const actor = {
  organizationId: v.string(),
  caller: v.optional(callerValue),
}
export async function authorizeToolkit(
  ctx: QueryCtx,
  args: { organizationId: string; caller?: Caller },
  resource: "knowledge" | "bot_tools",
  write = false
) {
  if (args.caller) {
    if (args.caller.organizationId !== args.organizationId)
      throw notFound("Resource")
    await requireCaller(ctx, args.caller, {
      resource,
      access: write ? "write" : "read",
    })
  } else await requireTeam(ctx, args.organizationId, write ? "write" : "read")
  await requireActiveTeam(ctx, args.organizationId)
}
export async function ownedToolkit<
  T extends "knowledgeBases" | "knowledgeDocuments" | "botTools",
>(ctx: QueryCtx, table: T, team: string, id: string) {
  const normalized = ctx.db.normalizeId(table, id)
  const row = normalized ? await ctx.db.get(table, normalized) : null
  if (!row || row.organizationId !== team) throw notFound("Resource")
  return row
}

/** Remove deleted resources from bot configurations without an unbounded write. */
export const detach = internalMutation({
  args: {
    organizationId: v.string(),
    kind: v.union(v.literal("knowledge"), v.literal("tool")),
    id: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("voiceBots")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .paginate(args.paginationOpts)
    for (const bot of page.page) {
      if (
        args.kind === "knowledge" &&
        bot.knowledgeBaseIds?.some((id) => id === args.id)
      )
        await ctx.db.patch("voiceBots", bot._id, {
          knowledgeBaseIds: bot.knowledgeBaseIds.filter((id) => id !== args.id),
          updatedAt: Date.now(),
        })
      if (
        args.kind === "tool" &&
        bot.customToolIds?.some((id) => id === args.id)
      )
        await ctx.db.patch("voiceBots", bot._id, {
          customToolIds: bot.customToolIds.filter((id) => id !== args.id),
          updatedAt: Date.now(),
        })
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.botToolkitAccess.detach, {
        ...args,
        paginationOpts: { ...args.paginationOpts, cursor: page.continueCursor },
      })
    return null
  },
})
