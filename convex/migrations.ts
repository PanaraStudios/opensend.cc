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

export const countExports = backfill("exports")
export const countEmails = backfill("emails")
export const countSuppressions = backfill("suppressions")
export const countEmailRecipients = backfill("emailRecipients")
export const countEmailEvents = backfill("emailEvents")
export const countContacts = backfill("contacts")
export const countTopics = backfill("topics")
export const countContactProperties = backfill("contactProperties")
export const countSegmentMembers = backfill("segmentMembers")
export const countTemplates = backfill("templates")
export const countApiKeys = backfill("apiKeys")
export const countApiLogs = backfill("apiLogs")
export const countWebhooks = backfill("webhooks")
export const countWebhookDeliveries = backfill("webhookDeliveries")
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
  internal.migrations.countExports,
  internal.migrations.countEmails,
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
  internal.migrations.countDomains,
  internal.migrations.dropWebhookStats,
])
