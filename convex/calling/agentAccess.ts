import { ConvexError } from "convex/values"
import { components } from "../_generated/api"
import type { MutationCtx, QueryCtx, ActionCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { requireTeam, sessionId } from "../access"
import { retirement } from "../teamLifecycle"
import { CALL_TERMINAL } from "../../lib/meta/calling"
export const PRESENCE_TTL = 75000
export async function agentActor(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  organizationId: string
) {
  await requireTeam(ctx, organizationId, "write")
  const authSessionId = await sessionId(ctx)
  const actor = await ctx.runQuery(components.betterAuth.policy.checkSession, {
    sessionId: authSessionId,
  })
  return { ...actor, authSessionId }
}
export async function agentPresence(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  browserId: string
) {
  const actor = await agentActor(ctx, organizationId)
  if (await retirement(ctx, organizationId))
    throw new ConvexError("Team is being retired")
  const row = await ctx.db
    .query("callAgents")
    .withIndex("by_organizationId_and_userId", (q) =>
      q.eq("organizationId", organizationId).eq("userId", actor.userId)
    )
    .unique()
  if (
    !row ||
    row.browserId !== browserId ||
    row.authSessionId !== actor.authSessionId
  )
    throw new ConvexError("This browser does not own the agent session")
  return row
}
export function requireOnline(row: Doc<"callAgents">) {
  if (
    row.status !== "online" ||
    row.updatedAt + PRESENCE_TTL <= Date.now() ||
    row.expiresAt <= Date.now() ||
    !row.extension
  )
    throw new ConvexError("Go online before calling")
}
export async function requireAvailable(
  ctx: QueryCtx | MutationCtx,
  row: Doc<"callAgents">,
  except?: string
) {
  requireOnline(row)
  await ctx.runQuery(components.betterAuth.policy.authorizeTeam, {
    sessionId: row.authSessionId,
    organizationId: row.organizationId,
    owner: false,
  })
  if (
    row.reservedCallId &&
    (row.reservationUntil ?? 0) > Date.now() &&
    row.reservedCallId !== except
  )
    throw new ConvexError("Agent already has a pending transfer")
  const calls = (
    await Promise.all(
      (["queued", "ringing", "connected"] as const).map((status) =>
        ctx.db
          .query("calls")
          .withIndex("by_organizationId_and_assignedAgent_and_status", (q) =>
            q
              .eq("organizationId", row.organizationId)
              .eq("assignedAgent", row.userId)
              .eq("status", status)
          )
          .take(2)
      )
    )
  ).flat()

  const tests = (
    await Promise.all(
      (["queued", "ringing", "connected"] as const).map((status) =>
        ctx.db
          .query("calls")
          .withIndex("by_organizationId_and_testUserId_and_status", (q) =>
            q
              .eq("organizationId", row.organizationId)
              .eq("testUserId", row.userId)
              .eq("status", status)
          )
          .take(2)
      )
    )
  ).flat()
  if (
    [...calls, ...tests].some(
      (c) => c._id !== except && !CALL_TERMINAL.has(c.status)
    )
  )
    throw new ConvexError("Agent already has a call")
}
