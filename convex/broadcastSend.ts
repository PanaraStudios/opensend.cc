import {
  WorkflowManager,
  cleanup,
  vWorkflowId,
  vResultValidator,
} from "@convex-dev/workflow"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { patchRow } from "./counts"
import { audience, recipientPage } from "./broadcasts"
import { finishBroadcast, scheduleBroadcastSettle } from "./broadcastMetrics"
import { broadcastChannels } from "./broadcastChannels"
import { rowChannel } from "../lib/channels"
import { retirement } from "./teamLifecycle"

const workflow = new WorkflowManager(components.workflow)
const args = { id: v.id("broadcasts"), generation: v.number() }
export const start = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, { id, generation }): Promise<null> => {
    const row = await ctx.db.get("broadcasts", id)
    if (
      !row ||
      row.generation !== generation ||
      !["queued", "scheduled"].includes(row.status) ||
      row.audienceBefore !== undefined ||
      (await retirement(ctx, row.organizationId))
    )
      return null
    const newest = await ctx.db
      .query("contacts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", row.organizationId)
      )
      .order("desc")
      .first()
    await patchRow(ctx, "broadcasts", id, {
      status: "queued",
      scheduledJob: undefined,
      audienceBefore: newest?._creationTime ?? Date.now(),
    })
    await enqueuePump(ctx, id, generation, 0)
    return null
  },
})
/** Legacy: a broadcast that started on the durable workflow finishes its
    current run, then `completed` hands it to the pump. */
export const execute = workflow.define({
  args,
  returns: v.null(),
  handler: async (step, args): Promise<null> => {
    // Rotate the journal before Workflow's history limit, for any audience size.
    for (let page = 0; page < 100; page++)
      if (await step.runMutation(internal.broadcastSend.batch, args)) break
    return null
  },
})

/* Fan-out. One `pump` step writes up to `MAX_STEP_RECIPIENTS` recipients
   (each recipient row and its queued message or email in the step's
   transaction, so a retried or repeated step never sends twice: the
   recipient row is the idempotency key), then schedules the next step
   after the time its messages take at the sender's rate: the WhatsApp
   number's or Page's throughput, or the SES region's send rate. Delivery
   still runs behind the same per-sender limiters; pacing the fan-out to
   them keeps the send queue to about one step instead of the whole
   audience. */

/** Most recipients one step writes. A WhatsApp recipient costs about 60
    document reads and 30 writes (its message, events, thread and the
    aggregates; measured in broadcastFanout.test.ts); `RESERVE` ends a step
    early if recipients cost more. */
export const MAX_STEP_RECIPIENTS = 32
/** Stop a step early (and finish its page next step) below these. */
const RESERVE = {
  databaseQueries: 400,
  documentsRead: 4_000,
  documentsWritten: 2_000,
  bytesRead: 2 * 1024 * 1024,
  bytesWritten: 2 * 1024 * 1024,
}

async function hasRoom(ctx: MutationCtx) {
  const metrics = await ctx.meta.getTransactionMetrics()
  return (Object.keys(RESERVE) as (keyof typeof RESERVE)[]).every(
    (key) => metrics[key].remaining >= RESERVE[key]
  )
}

/** Whether the row is still fanning out under this generation. */
async function fanningOut(
  ctx: MutationCtx,
  row: Doc<"broadcasts"> | null,
  generation: number
): Promise<boolean> {
  return (
    !!row &&
    row.generation === generation &&
    row.status === "queued" &&
    !row.audienceDone &&
    !(await retirement(ctx, row.organizationId))
  )
}

/** One step from the cursor on the row. Returns whether the audience is
    done and how long the sender needs for what the step queued. */
export async function sendStep(ctx: MutationCtx, row: Doc<"broadcasts">) {
  const topic = await audience(ctx, row)
  const channel = broadcastChannels[rowChannel(row)]
  const prepared = await channel.prepare(ctx, row)
  // A number gets at most a second of its throughput per step, so the
  // step's sends fit its limiter's bucket in one reservation.
  const size =
    prepared.channel === "email"
      ? MAX_STEP_RECIPIENTS
      : Math.min(MAX_STEP_RECIPIENTS, await channel.rate(ctx, prepared))
  const page = await recipientPage(
    ctx,
    row,
    row.cursor ?? null,
    row.audienceBefore,
    size,
    true,
    topic
  )
  const sent = await channel.sendRecipients(
    ctx,
    row,
    page.page,
    topic,
    prepared,
    () => hasRoom(ctx)
  )
  // A step cut short keeps its cursor: the next one redoes the page,
  // skipping the recipients already written.
  const complete = sent.written === page.page.length
  if (complete) {
    await patchRow(ctx, "broadcasts", row._id, {
      cursor: page.continueCursor,
      audienceDone: page.isDone,
    })
    if (page.isDone) {
      await finishBroadcast(ctx, row._id)
      await scheduleBroadcastSettle(ctx, row._id)
    }
  }
  const now = Date.now()
  const paced = sent.queued
    ? Math.ceil((sent.queued * 1000) / (await channel.rate(ctx, prepared)))
    : 0
  return {
    done: complete && page.isDone,
    queued: sent.queued,
    // A number busy with other sends reserved later slots: wait for them.
    delay: Math.max(paced, (sent.readyAt ?? now) - now),
  }
}

/** One step, as the legacy workflow and tests drive it. */
export const batch = internalMutation({
  args,
  returns: v.boolean(),
  handler: async (ctx, { id, generation }): Promise<boolean> => {
    const row = await ctx.db.get("broadcasts", id)
    if (!row || !(await fanningOut(ctx, row, generation))) return true
    return (await sendStep(ctx, row)).done
  },
})

/** Caps on one step, well under Convex's per-transaction limits, so a step
    that outgrows them rolls back alone and `pump` can still fail the
    broadcast in its own transaction. */
export const STEP_LIMITS = {
  databaseQueries: 3_500,
  documentsRead: 24_000,
  documentsWritten: 12_000,
  bytesRead: 12 * 1024 * 1024,
  bytesWritten: 12 * 1024 * 1024,
}
/** How long after a step was due the watchdog checks it ran. */
export const WATCH_MS = 5 * 60_000

async function failFanout(
  ctx: MutationCtx,
  id: Id<"broadcasts">,
  generation: number,
  error: string
) {
  const row = await ctx.db.get("broadcasts", id)
  if (
    row?.status === "queued" &&
    row.generation === generation &&
    !(await retirement(ctx, row.organizationId))
  )
    await patchRow(ctx, "broadcasts", id, {
      status: "failed",
      settledAt: Date.now(),
      error,
      updatedAt: Date.now(),
    })
}

/** One paced step, scheduling the next. The step runs as a capped nested
    mutation, so one that throws or outgrows its caps rolls back alone and
    fails the broadcast, as a failed workflow run did, instead of ending
    the chain silently. */
export const pump = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, { id, generation }): Promise<null> => {
    try {
      await ctx.runMutation(
        internal.broadcastSend.pumpStep,
        { id, generation },
        { transactionLimits: STEP_LIMITS }
      )
    } catch (error) {
      await failFanout(
        ctx,
        id,
        generation,
        error instanceof Error ? error.message : "Broadcast failed"
      )
    }
    return null
  },
})
/** A step that failed outright (it ran out of time, say) committed nothing,
    so it scheduled no next step and could not fail the broadcast itself.
    The step before it scheduled this check: a step that failed or was
    canceled fails the broadcast; one still waiting is checked again later. */
export const watchPump = internalMutation({
  args: { ...args, job: v.id("_scheduled_functions") },
  returns: v.null(),
  handler: async (ctx, { id, generation, job }): Promise<null> => {
    const row = await ctx.db.get("broadcasts", id)
    if (!(await fanningOut(ctx, row, generation))) return null
    const state = (await ctx.db.system.get("_scheduled_functions", job))?.state
    if (state?.kind === "pending" || state?.kind === "inProgress")
      await ctx.scheduler.runAfter(WATCH_MS, internal.broadcastSend.watchPump, {
        id,
        generation,
        job,
      })
    else if (state?.kind !== "success")
      await failFanout(
        ctx,
        id,
        generation,
        "The send stopped before reaching everyone. Try sending again."
      )
    return null
  },
})
export const pumpStep = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, { id, generation }): Promise<null> => {
    const row = await ctx.db.get("broadcasts", id)
    if (!row || !(await fanningOut(ctx, row, generation))) return null
    const step = await sendStep(ctx, row)
    if (!step.done) await enqueuePump(ctx, id, generation, step.delay)
    return null
  },
})
export const completed = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object(args),
  },
  returns: v.null(),
  handler: async (ctx, { context, result, workflowId }): Promise<null> => {
    const row = await ctx.db.get("broadcasts", context.id)
    if (
      !row ||
      row.workflowId !== workflowId ||
      (await retirement(ctx, row.organizationId))
    ) {
      await cleanup(ctx, components.workflow, workflowId)
      return null
    }
    if (
      row?.generation === context.generation &&
      row.status === "queued" &&
      result.kind !== "success"
    )
      await patchRow(ctx, "broadcasts", row._id, {
        status: "failed",
        settledAt: Date.now(),
        error: result.kind === "failed" ? result.error : "Broadcast canceled",
        updatedAt: Date.now(),
      })
    if (
      result.kind === "success" &&
      row?.status === "queued" &&
      !row.audienceDone &&
      row.generation === context.generation
    )
      await enqueuePump(ctx, row._id, row.generation, 0)
    await cleanup(ctx, components.workflow, workflowId)
    return null
  },
})

async function enqueuePump(
  ctx: MutationCtx,
  id: Id<"broadcasts">,
  generation: number,
  runAfter: number
) {
  const job = await ctx.scheduler.runAfter(
    runAfter,
    internal.broadcastSend.pump,
    { id, generation }
  )
  await ctx.scheduler.runAfter(
    runAfter + WATCH_MS,
    internal.broadcastSend.watchPump,
    { id, generation, job }
  )
}
