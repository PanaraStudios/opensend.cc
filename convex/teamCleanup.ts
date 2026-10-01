import { deleteFile } from "./storage/files"
import { deleteReceived } from "./received"
import { v } from "convex/values"
import type { OrderedQuery } from "convex/server"
import { cancel, cleanup, type WorkflowId } from "@convex-dev/workflow"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { components, internal } from "./_generated/api"
import type { DataModel, Id, TableNames } from "./_generated/dataModel"
import {
  retireBroadcastCounters,
  COUNTED_TABLES,
  counters,
  deleteRow,
  type CountedTable,
} from "./counts"
import { deleteEmailContent } from "./emailRows"
import { deleteChannelMessageContent } from "./channels/rows"
import { retirement } from "./teamLifecycle"

/** Parents with unscoped children are erased only after their children. */
export const TEAM_TABLES = [
  "broadcastRecipientLinks",
  "broadcastLinks",
  "broadcastEvents",
  "broadcastRecipients",
  "broadcastDrafts",
  "broadcasts",
  "automations",
  "automationRuns",
  "automationRunSteps",
  "automationEventLinks",
  "webhooks",
  "webhookSubscriptions",
  "webhookDeliveries",
  "events",
  "apiKeys",
  "apiIdempotency",
  "apiLogs",
  "emails",
  "emailRecipients",
  "emailMetrics",
  "recipientMetrics",
  "suppressions",
  "contacts",
  "segments",
  "segmentMembers",
  "topics",
  "topicSubscriptions",
  "contactProperties",
  "templates",
  "publishedTemplates",
  "automationEvents",
  "automationEventOccurrences",
  "exports",
  "unsubscribePages",
  "smtpSettings",
  "receivedEmails",
  "inboundMessages",
  "domainClaims",
  "domains",
  "sesTenants",
  "contactImports",
  "webhookAttempts",
  "emailShares",
  "channelMediaUploads",
  "channelMessages",
  "conversations",
  "whatsappUserAliases",
  "channelContacts",
  "channelAccounts",
  "whatsappBusinessAccounts",
  "metaConnections",
  "teamAssets",
  "storedFiles",
  "calls",
  "callEvents",
  "callPermissions",
  "callingSettings",
  "gatewayEvents",
] as const

export const CHILD_TABLES = [
  "receivedContents",
  "receivedAttachments",
  "emailContents",
  "emailEvents",
  "apiKeyUsage",
  "apiLogBodies",
  "templateDrafts",
  "domainHistory",
  "webhookStats",
  "channelMessageContents",
  "channelMessageEvents",
] as const

async function erase<T extends TableNames>(
  ctx: MutationCtx,
  table: T,
  id: Id<T>
) {
  if ((COUNTED_TABLES as readonly string[]).includes(table))
    await deleteRow(ctx, table as CountedTable, id as Id<CountedTable>)
  else await ctx.db.delete(table, id)
}

async function children<T extends TableNames>(
  ctx: MutationCtx,
  table: T,
  query: OrderedQuery<DataModel[T]>
) {
  const { page } = await query.paginate({
    cursor: null,
    numItems: 8,
    maximumRowsRead: 8,
    maximumBytesRead: 1024 * 1024,
  })
  for (const row of page) await erase(ctx, table, row._id)
  return page.length > 0
}

/** One parent (or one bounded child page) per transaction. Restarting a pass
    is harmless; deletion and scheduling the next batch commit together. */
export const purge = internalMutation({
  args: { organizationId: v.string(), table: v.number() },
  returns: v.null(),
  handler: async (ctx, { organizationId, table }) => {
    const job = await retirement(ctx, organizationId)
    if (!job || job.completedAt) return null
    if (!Number.isInteger(table) || table < 0 || table > TEAM_TABLES.length)
      throw new Error("Invalid retirement table")
    const name = TEAM_TABLES[table]
    if (!name) {
      for (const counter of [
        counters.usageSent,
        counters.usageReceived,
        counters.usageAutomationRuns,
      ])
        await counter.aggregate.clear(ctx, { namespace: organizationId })
      await ctx.db.patch("teamRetirements", job._id, {
        completedAt: Date.now(),
      })
      return null
    }
    const next = (index = table) =>
      ctx.scheduler.runAfter(0, internal.teamCleanup.purge, {
        organizationId,
        table: index,
      })
    const row = await ctx.db
      .query(name)
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .first()
    if (!row) {
      await next(table + 1)
      return null
    }
    if (name === "sesTenants") {
      const tenants = await ctx.db
        .query("sesTenants")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", organizationId)
        )
        .take(5)
      // Failed/running AWS operations remain retryable; finish() erases each
      // record once AWS confirms removal, even after this pass completes.
      for (const tenant of tenants)
        if (tenant.deleted) await ctx.db.delete("sesTenants", tenant._id)
      await next(table + 1)
      return null
    }
    if (name === "receivedEmails") {
      const email = await ctx.db.get(
        "receivedEmails",
        row._id as Id<"receivedEmails">
      )
      if (email) await deleteReceived(ctx, email)
      await next()
      return null
    }
    if (name === "calls") {
      const call = await ctx.db.get("calls", row._id as Id<"calls">)
      if (call?.recording) await deleteFile(ctx, call.recording)
      if (call?.transcription) await deleteFile(ctx, call.transcription)
      if (call?.mode === "gateway")
        await ctx.scheduler.runAfter(
          0,
          internal.calling.callActions.disposeGateway,
          { id: call._id }
        )
    }
    if (name === "storedFiles")
      await deleteFile(ctx, { fileId: row._id as Id<"storedFiles"> }, true)
    if (name === "teamAssets" && "fileId" in row)
      await deleteFile(ctx, { fileId: row.fileId })
    if (
      name === "inboundMessages" &&
      (("storageId" in row && row.storageId) || ("fileId" in row && row.fileId))
    )
      await deleteFile(ctx, row)
    let pending = false
    if (name === "emails") {
      const id = row._id as Id<"emails">
      pending = await children(
        ctx,
        "emailEvents",
        ctx.db
          .query("emailEvents")
          .withIndex("by_emailId_and_at", (q) => q.eq("emailId", id))
      )
      if (!pending) await deleteEmailContent(ctx, id)
    } else if (name === "channelMediaUploads") {
      const file = await ctx.db.get(
        "channelMediaUploads",
        row._id as Id<"channelMediaUploads">
      )
      if (file) await deleteFile(ctx, file)
    } else if (name === "broadcasts") {
      await retireBroadcastCounters(ctx, row._id as Id<"broadcasts">)
    } else if (name === "channelMessages") {
      const id = row._id as Id<"channelMessages">
      pending = await children(
        ctx,
        "channelMessageEvents",
        ctx.db
          .query("channelMessageEvents")
          .withIndex("by_messageId_and_at", (q) => q.eq("messageId", id))
      )
      if (!pending) await deleteChannelMessageContent(ctx, id)
    } else if (name === "apiKeys") {
      pending = await children(
        ctx,
        "apiKeyUsage",
        ctx.db
          .query("apiKeyUsage")
          .withIndex("by_apiKeyId", (q) =>
            q.eq("apiKeyId", row._id as Id<"apiKeys">)
          )
      )
    } else if (name === "apiLogs") {
      pending = await children(
        ctx,
        "apiLogBodies",
        ctx.db
          .query("apiLogBodies")
          .withIndex("by_logId", (q) => q.eq("logId", row._id as Id<"apiLogs">))
      )
    } else if (name === "templates") {
      pending = await children(
        ctx,
        "templateDrafts",
        ctx.db
          .query("templateDrafts")
          .withIndex("by_templateId", (q) =>
            q.eq("templateId", row._id as Id<"templates">)
          )
      )
    } else if (name === "domains") {
      pending = await children(
        ctx,
        "domainHistory",
        ctx.db
          .query("domainHistory")
          .withIndex("by_domainId", (q) =>
            q.eq("domainId", row._id as Id<"domains">)
          )
      )
    } else if (name === "webhooks") {
      pending = await children(
        ctx,
        "webhookStats",
        ctx.db
          .query("webhookStats")
          .withIndex("by_webhookId", (q) =>
            q.eq("webhookId", row._id as Id<"webhooks">)
          )
      )
    } else if (
      name === "exports" &&
      (("storageId" in row && row.storageId) || ("fileId" in row && row.fileId))
    ) {
      await deleteFile(ctx, row)
    } else if (
      name === "automationRuns" &&
      "workflowId" in row &&
      row.workflowId
    ) {
      const workflowId = row.workflowId as WorkflowId
      const state = await ctx.runQuery(components.workflow.workflow.getStatus, {
        workflowId,
      })
      if (state.workflow.runResult)
        await cleanup(ctx, components.workflow, workflowId)
      else if (state.inProgress.length) {
        await cancel(ctx, components.workflow, workflowId)
        await cleanup(ctx, components.workflow, workflowId)
      }
      // A queued handler with no step journal has no cancelable work ID in
      // workflow 0.4.8. It observes the missing run, stops, and its completion
      // hook cleans up. Deleting its workflow now would make that worker retry.
    }
    if (!pending) await erase(ctx, name, row._id)
    await next()
    return null
  },
})
