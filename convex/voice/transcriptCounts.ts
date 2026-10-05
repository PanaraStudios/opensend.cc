import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

// Saturation preserves the admission predicates without an unbounded legacy
// backfill. These are admission counts, not totals for reporting or billing.
const ROW_LIMIT = 2000
const TOOL_LIMIT = 128

async function admissionCounts(ctx: MutationCtx, call: Doc<"calls">) {
  if (
    call.admissionTranscriptCount !== undefined &&
    call.admissionToolCount !== undefined
  )
    return {
      admissionTranscriptCount: call.admissionTranscriptCount,
      admissionToolCount: call.admissionToolCount,
    }
  const rows = await ctx.db
    .query("callTranscripts")
    .withIndex("by_callId", (q) => q.eq("callId", call._id))
    .take(ROW_LIMIT + 1)
  return {
    admissionTranscriptCount: rows.length,
    admissionToolCount: Math.min(
      TOOL_LIMIT,
      rows.filter((row) => row.kind === "tool").length
    ),
  }
}

export async function toolLimitReached(ctx: MutationCtx, call: Doc<"calls">) {
  const counts = await admissionCounts(ctx, call)
  if (
    call.admissionTranscriptCount === undefined ||
    call.admissionToolCount === undefined
  )
    await ctx.db.patch("calls", call._id, counts)
  return (
    counts.admissionTranscriptCount > ROW_LIMIT ||
    counts.admissionToolCount >= TOOL_LIMIT
  )
}

/** Every transcript/media/note/tool insert must update counters atomically. */
export async function insertTranscript(
  ctx: MutationCtx,
  row: Omit<Doc<"callTranscripts">, "_id" | "_creationTime">
) {
  // Read the current call, since a single tool can insert a note and its log,
  // and admission may have just initialized legacy counters in this mutation.
  const call = await ctx.db.get("calls", row.callId)
  const counts = call ? await admissionCounts(ctx, call) : null
  const id = await ctx.db.insert("callTranscripts", row)
  if (counts)
    await ctx.db.patch("calls", row.callId, {
      admissionTranscriptCount: Math.min(
        ROW_LIMIT + 1,
        counts.admissionTranscriptCount + 1
      ),
      admissionToolCount: Math.min(
        TOOL_LIMIT,
        counts.admissionToolCount + (row.kind === "tool" ? 1 : 0)
      ),
    })
  return id
}
