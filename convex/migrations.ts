import { recordBroadcastReport } from "./broadcastMetrics"
import { recordMetric } from "./metricRows"
import { projectEvent } from "./ses/projection"
import { Migrations } from "@convex-dev/migrations"
import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import { countRow, patchRow, type CountedTable } from "./counts"

/* Online migrations, run after a deploy with
   `pnpm backend run migrations:backfillCounts` (see docs/self-hosting.md).
   The component tracks progress, so a rerun resumes or skips what is done. */
export const migrations = new Migrations<DataModel>(components.migrations)

/** Counts a table's rows written before its counts existed. */
const backfill = <T extends CountedTable>(table: T) =>
  migrations.define({
    table,
    migrateOne: (ctx, doc) => countRow(ctx, table, doc),
  })

export const countAutomationEvents = backfill("automationEvents")
/** The one-shot migrate image starts this after deploying the functions.
 * The component resumes bounded batches without delaying the app restart. */
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

export const backfillCounts = migrations.runner([
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
])
