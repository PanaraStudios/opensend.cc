import { recordBroadcastReport } from "./broadcastMetrics"
import { recordMetric } from "./metricRows"
import { projectEvent } from "./ses/projection"
import { Migrations } from "@convex-dev/migrations"
import { getFunctionName } from "convex/server"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import { internalMutation, type MutationCtx } from "./_generated/server"
import { countRow, patchRow, type CountedTable } from "./counts"

/* Online migrations. The migrate image starts `migrations:postDeploy` after
   every deploy (docker/migrate/run.mjs); by hand it is
   `pnpm backend run migrations:postDeploy` (see docs/self-hosting.md).
   The component tracks progress, so a rerun resumes or skips what is done. */
export const migrations = new Migrations<DataModel>(components.migrations)

/** Counts a table's rows written before its counts existed. */
const backfill = <T extends CountedTable>(table: T) =>
  migrations.define({
    table,
    migrateOne: (ctx, doc) => countRow(ctx, table, doc),
  })

export const countAutomationEvents = backfill("automationEvents")
/** Counts automation events only. The migrate image now starts `postDeploy`,
 * which runs this step first; kept for scripts and tests that call it. */
export const initializeEventCounts = migrations.runner(
  internal.migrations.countAutomationEvents
)
export const countAutomations = backfill("automations")
export const countAutomationRuns = backfill("automationRuns")
export const countAutomationRunSteps = backfill("automationRunSteps")
export const countReceivedEmails = backfill("receivedEmails")
export const parseStoredInbound = migrations.define({
  table: "inboundMessages",
  batchSize: 10,
  migrateOne: async (ctx, row) => {
    if (row.storageId && row.parsedAt === undefined)
      await ctx.scheduler.runAfter(0, internal.receivedParse.parse, {
        id: row._id,
      })
  },
})
export const countBroadcastLinks = backfill("broadcastLinks")
export const countBroadcastRecipientLinks = backfill("broadcastRecipientLinks")
export const backfillBroadcastReports = migrations.define({
  table: "emailEvents",
  batchSize: 10,
  migrateOne: async (ctx, event) => {
    const email = await ctx.db.get("emails", event.emailId)
    if (email) await recordBroadcastReport(ctx, email, event)
  },
})
export const countBroadcasts = backfill("broadcasts")
export const countBroadcastRecipients = backfill("broadcastRecipients")
export const countBroadcastEvents = backfill("broadcastEvents")
export const countExports = backfill("exports")
export const countEmails = backfill("emails")
export const countEmailDomains = backfill("emails")
export const countUsageSent = backfill("emailMetrics")
export const countUsageReceived = backfill("receivedEmails")
export const countUsageAutomationRuns = backfill("automationRuns")
export const countEmailMetrics = backfill("emailMetrics")
export const countRecipientMetrics = backfill("recipientMetrics")
export const projectSesEvents = migrations.define({
  table: "sesEvents",
  batchSize: 1,
  migrateOne: (ctx, event) => projectEvent(ctx, event),
})
export const seedEmailMetrics = migrations.define({
  table: "emailEvents",
  batchSize: 1,
  migrateOne: async (ctx, event) => {
    const email = await ctx.db.get("emails", event.emailId)
    if (email)
      await recordMetric(ctx, email, event.type, event.at, event.recipients)
  },
})
export const countSuppressions = backfill("suppressions")
export const countEmailRecipients = backfill("emailRecipients")
export const countEmailEvents = backfill("emailEvents")
export const countContactImports = backfill("contactImports")
export const countContacts = backfill("contacts")
export const countTopics = backfill("topics")
export const countContactProperties = backfill("contactProperties")
export const countSegmentMembers = backfill("segmentMembers")
export const countTemplates = backfill("templates")
export const countApiKeys = backfill("apiKeys")
export const countApiLogs = backfill("apiLogs")
export const countWebhooks = backfill("webhooks")
export const countWebhookDeliveries = backfill("webhookDeliveries")
export const countWebhookAttempts = backfill("webhookAttempts")
export const countDomains = backfill("domains")
/** Segments also drop the member count their aggregate replaced. */
export const countSegments = migrations.define({
  table: "segments",
  migrateOne: async (ctx, segment) => {
    await countRow(ctx, "segments", segment)
    if (segment.memberCount !== undefined)
      await patchRow(ctx, "segments", segment._id, { memberCount: undefined })
  },
})
/** The per-webhook totals the delivery counts replaced. */
export const dropWebhookStats = migrations.define({
  table: "webhookStats",
  migrateOne: (ctx, row) => ctx.db.delete("webhookStats", row._id),
})

/** Every backfill, in order. New backfills go at the end. */
const postDeployMigrations = [
  internal.migrations.countAutomationEvents,
  internal.migrations.countContactImports,
  internal.migrations.countReceivedEmails,
  internal.migrations.parseStoredInbound,
  internal.migrations.countAutomations,
  internal.migrations.countAutomationRuns,
  internal.migrations.countAutomationRunSteps,
  internal.migrations.countBroadcastLinks,
  internal.migrations.countBroadcastRecipientLinks,
  internal.migrations.countBroadcasts,
  internal.migrations.countBroadcastRecipients,
  internal.migrations.countBroadcastEvents,
  internal.migrations.countExports,
  internal.migrations.countEmails,
  internal.migrations.countEmailDomains,
  internal.migrations.countEmailMetrics,
  internal.migrations.countUsageSent,
  internal.migrations.countUsageReceived,
  internal.migrations.countUsageAutomationRuns,
  internal.migrations.countRecipientMetrics,
  internal.migrations.seedEmailMetrics,
  internal.migrations.backfillBroadcastReports,
  internal.migrations.projectSesEvents,
  internal.migrations.countSuppressions,
  internal.migrations.countEmailRecipients,
  internal.migrations.countEmailEvents,
  internal.migrations.countContacts,
  internal.migrations.countSegments,
  internal.migrations.countSegmentMembers,
  internal.migrations.countTopics,
  internal.migrations.countContactProperties,
  internal.migrations.countTemplates,
  internal.migrations.countApiKeys,
  internal.migrations.countApiLogs,
  internal.migrations.countWebhooks,
  internal.migrations.countWebhookDeliveries,
  internal.migrations.countWebhookAttempts,
  internal.migrations.countDomains,
  internal.migrations.dropWebhookStats,
]

/** How often, and how long, `postDeploy` waits for a step already running. */
const POST_DEPLOY_RECHECK_MS = 5 * 60_000
const POST_DEPLOY_RECHECKS = 288 // 24 hours

/* The component skips a whole series while any of its steps runs. A step
   started by another runner (such as the previous release's
   `initializeEventCounts`) does not go on to the rest of this list, so wait
   for it and start the series once nothing is running. A series that
   `postDeploy` itself started carries on to the end alone, so there is
   nothing to wait for. A recheck never resumes a step that was canceled or
   failed meanwhile: that is an operator's call. */
const postDeployRunner = {
  args: { recheck: v.optional(v.number()) },
  returns: v.null(),
  handler: async (
    ctx: MutationCtx,
    { recheck = 0 }: { recheck?: number }
  ): Promise<null> => {
    const names = postDeployMigrations.map((ref) => getFunctionName(ref))
    const statuses = await migrations.getStatus(ctx, {
      migrations: postDeployMigrations,
    })
    const running = statuses.find((status) => status.state === "inProgress")
    if (running) {
      const rest = names.slice(names.indexOf(running.name) + 1)
      if (rest.every((name) => running.next?.includes(name))) return null
      if (recheck >= POST_DEPLOY_RECHECKS) {
        console.warn(
          `postDeploy: ${running.name} is still running; run migrations:postDeploy again once it finishes`
        )
        return null
      }
      await ctx.scheduler.runAfter(
        POST_DEPLOY_RECHECK_MS,
        internal.migrations.postDeploy,
        { recheck: recheck + 1 }
      )
      return null
    }
    const stopped = statuses.find(
      (status) => status.state === "canceled" || status.state === "failed"
    )
    if (recheck > 0 && stopped) {
      console.warn(
        `postDeploy: ${stopped.name} is ${stopped.state}; not resuming it. Run migrations:postDeploy to continue the backfills.`
      )
      return null
    }
    await migrations.runSerially(ctx, postDeployMigrations)
    return null
  },
}

/** Run by the migrate image after each deploy. The component records each
    step by name, so a rerun skips finished steps. */
export const postDeploy = internalMutation(postDeployRunner)
/** Older name for `postDeploy`, kept for scripts and docs that call it. */
export const backfillCounts = internalMutation(postDeployRunner)
