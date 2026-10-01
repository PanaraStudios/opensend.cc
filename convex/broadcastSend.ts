import {
  WorkflowManager,
  cleanup,
  vWorkflowId,
  vResultValidator,
} from "@convex-dev/workflow"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { patchRow } from "./counts"
import { audience, recipientPage } from "./broadcasts"
import { finishBroadcast, scheduleBroadcastSettle } from "./broadcastMetrics"
import { broadcastChannels } from "./broadcastChannels"
import { rowChannel } from "../lib/meta/templates"
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
    await startWorkflow(ctx, id, generation)
    return null
  },
})
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
export const batch = internalMutation({
  args,
  returns: v.boolean(),
  handler: async (ctx, { id, generation }): Promise<boolean> => {
    const row = await ctx.db.get("broadcasts", id)
    if (
      !row ||
      row.generation !== generation ||
      row.status !== "queued" ||
      row.audienceDone ||
      (await retirement(ctx, row.organizationId))
    )
      return true
    const topic = await audience(ctx, row)
    const page = await recipientPage(
      ctx,
      row,
      row.cursor ?? null,
      row.audienceBefore,
      10,
      true,
      topic
    )
    const channel = broadcastChannels[rowChannel(row)]
    const prepared = await channel.prepare(ctx, row)
    for (const contact of page.page)
      await channel.sendRecipient(ctx, row, contact, topic, prepared)
    await patchRow(ctx, "broadcasts", id, {
      cursor: page.continueCursor,
      audienceDone: page.isDone,
    })
    if (page.isDone) {
      await finishBroadcast(ctx, id)
      await scheduleBroadcastSettle(ctx, id)
    }
    return page.isDone
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
      await startWorkflow(ctx, row._id, row.generation)
    await cleanup(ctx, components.workflow, workflowId)
    return null
  },
})

async function startWorkflow(
  ctx: MutationCtx,
  id: Id<"broadcasts">,
  generation: number
) {
  const workflowId = await workflow.start(
    ctx,
    internal.broadcastSend.execute,
    { id, generation },
    {
      startAsync: true,
      onComplete: internal.broadcastSend.completed,
      context: { id, generation },
    }
  )
  await patchRow(ctx, "broadcasts", id, { workflowId })
}
