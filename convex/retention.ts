import { stream } from "convex-helpers/server/stream"
import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { components, internal } from "./_generated/api"
import schema from "./schema"
import { deleteRow, patchRow } from "./counts"
import { readBroadcastStats } from "./broadcastMetrics"

const DAY = 86_400_000
export const retentionPage = {
  numItems: 100,
  maximumRowsRead: 100,
  maximumBytesRead: 2 * 1024 * 1024,
}
const cursorArgs = { cursor: v.optional(v.union(v.string(), v.null())) }

export const ses = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const page = await stream(ctx.db, schema)
      .query("sesEvents")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - 30 * DAY)
      )
      .paginate({ ...retentionPage, cursor: null })
    for (const row of page.page) await ctx.db.delete("sesEvents", row._id)
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.retention.ses, {})
    return null
  },
})

export const inbound = internalMutation({
  args: cursorArgs,
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await stream(ctx.db, schema)
      .query("inboundMessages")
      .withIndex("by_creation_time")
      .paginate({ ...retentionPage, cursor: cursor ?? null })
    for (const row of page.page) {
      if (row.parsedAt === undefined) continue
      if (row.parsedAt < Date.now() - 7 * DAY)
        await ctx.db.delete("inboundMessages", row._id)
      else if (row.notification)
        await ctx.db.patch("inboundMessages", row._id, { notification: "" })
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.retention.inbound, {
        cursor: page.continueCursor,
      })
    return null
  },
})

export const broadcasts = internalMutation({
  args: cursorArgs,
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await stream(ctx.db, schema)
      .query("broadcasts")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - 30 * DAY)
      )
      .paginate({
        ...retentionPage,
        numItems: 1,
        maximumRowsRead: 1,
        cursor: cursor ?? null,
      })
    for (const row of page.page) {
      if (
        !["sent", "failed", "canceled"].includes(row.status) ||
        (row.settledAt ?? row.sentAt ?? row.updatedAt) >= Date.now() - 30 * DAY
      )
        continue
      if (!row.retainedStats)
        await patchRow(ctx, "broadcasts", row._id, {
          retainedStats: await readBroadcastStats(ctx, row._id),
        })
      const recipients = await stream(ctx.db, schema)
        .query("broadcastRecipients")
        .withIndex("by_broadcastId_and_email", (q) =>
          q.eq("broadcastId", row._id)
        )
        .paginate({ ...retentionPage, cursor: null })
      const events = await stream(ctx.db, schema)
        .query("broadcastEvents")
        .withIndex("by_broadcastId_and_type", (q) =>
          q.eq("broadcastId", row._id)
        )
        .paginate({ ...retentionPage, cursor: null })
      for (const recipient of recipients.page)
        await deleteRow(ctx, "broadcastRecipients", recipient._id)
      for (const event of events.page)
        await deleteRow(ctx, "broadcastEvents", event._id)
      if (!recipients.isDone || !events.isDone) {
        await ctx.scheduler.runAfter(0, internal.retention.broadcasts, {
          cursor: cursor ?? null,
        })
        return null
      }
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.retention.broadcasts, {
        cursor: page.continueCursor,
      })
    return null
  },
})

export const automations = internalMutation({
  args: cursorArgs,
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await stream(ctx.db, schema)
      .query("automationRuns")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - 30 * DAY)
      )
      .paginate({
        ...retentionPage,
        numItems: 1,
        maximumRowsRead: 1,
        cursor: cursor ?? null,
      })
    for (const row of page.page) {
      if (
        row.status === "running" ||
        row.completedAt === undefined ||
        row.completedAt >= Date.now() - 30 * DAY
      )
        continue
      if (row.workflowId) {
        // The app run has been terminal for 30 days; no step can resume it.
        await ctx.runMutation(components.workflow.workflow.cleanup, {
          workflowId: row.workflowId,
          force: true,
        })
        await patchRow(ctx, "automationRuns", row._id, {
          workflowId: undefined,
        })
      }
      const steps = await stream(ctx.db, schema)
        .query("automationRunSteps")
        .withIndex("by_organizationId_and_runId_and_key", (q) =>
          q.eq("organizationId", row.organizationId).eq("runId", row._id)
        )
        .paginate({ ...retentionPage, cursor: null })
      for (const step of steps.page)
        await deleteRow(ctx, "automationRunSteps", step._id)
      if (!steps.isDone) {
        await ctx.scheduler.runAfter(0, internal.retention.automations, {
          cursor: cursor ?? null,
        })
        return null
      }
      await deleteRow(ctx, "automationRuns", row._id)
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.retention.automations, {
        cursor: page.continueCursor,
      })
    return null
  },
})

export const auth = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    await ctx.runMutation(components.betterAuth.retention.prune, {})
    return null
  },
})

export const imports = internalMutation({
  args: cursorArgs,
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await stream(ctx.db, schema)
      .query("contactImports")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - 7 * DAY)
      )
      .paginate({ ...retentionPage, cursor: cursor ?? null })
    for (const row of page.page)
      if (row.status !== "processing")
        await ctx.db.delete("contactImports", row._id)
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.retention.imports, {
        cursor: page.continueCursor,
      })
    return null
  },
})
