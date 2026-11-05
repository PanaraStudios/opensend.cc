import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { minuteUsage } from "../voice/usage"

/** Called only by the winning terminal transition, in its transaction. */
export async function settleTerminal(ctx: MutationCtx, call: Doc<"calls">) {
  const endedAt = call.endedAt ?? Date.now()
  const patch: Partial<Doc<"calls">> = {
    operation: undefined,
    operationUntil: undefined,
    agentLeaseId: undefined,
    agentExtension: undefined,
    botActive: false,
    ...(call.connectedAt && call.duration === undefined
      ? {
          duration: Math.max(
            0,
            Math.round((endedAt - call.connectedAt) / 1000)
          ),
        }
      : {}),
  }
  if (call.botStartedAt && !call.botEndedAt) {
    patch.botEndedAt = endedAt
    patch.botCompletionPending = true
    patch.botDuration =
      (call.botDuration ?? 0) +
      Math.min(
        call.botConfig?.maxDurationSeconds ?? 600,
        Math.max(
          0,
          (endedAt - (call.botSessionStartedAt ?? call.botStartedAt)) / 1000
        )
      )
    patch.botOutcome = "caller_hangup"
  }
  await ctx.db.patch("calls", call._id, patch)
  if (patch.botEndedAt && !call.test)
    await minuteUsage.replaceOrInsert(
      ctx,
      call,
      (await ctx.db.get("calls", call._id))!
    )
  // Include a pending transfer reservation as well as the assigned agent.
  for (const agent of await ctx.db
    .query("callAgents")
    .withIndex("by_reservedCallId", (q) => q.eq("reservedCallId", call._id))
    .take(50))
    await ctx.db.patch("callAgents", agent._id, {
      reservedCallId: undefined,
      reservationUntil: undefined,
    })
}
