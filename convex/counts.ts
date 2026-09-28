import { TableAggregate } from "@convex-dev/aggregate"
import type { WithoutSystemFields } from "convex/server"
import { v, type Value } from "convex/values"
import { components } from "./_generated/api"
import type { DataModel, Doc, Id, TableNames } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

/* Every row count the dashboard shows is read here, from the Aggregate
   component (https://www.convex.dev/components/aggregate): one mounted
   instance per count, as its README asks, each partitioned into a namespace
   per team (or per parent row) so teams never contend with each other.

   RULE: a counted table is written only through `insertRow`, `patchRow` and
   `deleteRow` below, which update the table and its counts in the same
   transaction (the README's recommended way to keep them in sync).
   counts.test.ts fails on a direct write anywhere else.

   Writes use the idempotent methods (`insertIfDoesNotExist`,
   `replaceOrInsert`, `deleteIfExists`): a self-hosted install upgrades on its
   own schedule, so rows written before the counts existed are only added by
   the backfill (`migrations:backfillCounts`), possibly after live writes.

   Counts update in the writing transaction rather than in the component's
   queued mode, so counts stay exact at once instead of trailing a
   background worker. Most time filters use BUCKET to spread concurrent
   writes; automation metrics keep exact timestamps for range sums. */

/** A list's row count for its current filters; null when they cannot be
    counted exactly (a text search, or filters no count is keyed by). */
export const countValue = v.object({ total: v.union(v.number(), v.null()) })

/* Creation times count in 15-minute buckets. Every time zone's days start
   on one, so a range of whole local days counts exactly; and rows created
   together still spread over the tree, ordered by id within their bucket,
   instead of all appending at one end of it. */
const BUCKET = 15 * 60_000
const bucket = (time: number) => Math.floor(time / BUCKET)

type Key = Value[]
/** One position of a count's key: a filter's value, or unset to count
    across `among`, every value it can take. */
export type KeyPart = { is?: Value; among: readonly Value[] }
/** A creation-time range in milliseconds, both ends inclusive. */
export type TimeRange = { from?: number; to?: number }

/** The values of a union of literals, for `KeyPart.among`. */
export const literals = <T extends Value>(validator: {
  members: readonly { value: T }[]
}) => validator.members.map((member) => member.value)
export const BOOLEANS = [false, true] as const

const sameValue = (a: Value, b: Value) =>
  JSON.stringify(a) === JSON.stringify(b)

class Counter<T extends TableNames, N extends Value> {
  readonly aggregate: TableAggregate<{
    Namespace: N
    Key: Key
    DataModel: DataModel
    TableName: T
  }>
  constructor(
    component: ConstructorParameters<typeof TableAggregate>[0],
    private spec: {
      namespace: (doc: Doc<T>) => N
      key: (doc: Doc<T>) => Key
      /** Rows outside it are not counted (soft-deleted ones, say). */
      where?: (doc: Doc<T>) => boolean
      sum?: (doc: Doc<T>) => number
    }
  ) {
    this.aggregate = new TableAggregate(component, {
      namespace: spec.namespace,
      sortKey: spec.key,
      sumValue: spec.sum,
    })
  }
  private counts(doc: Doc<T>) {
    return this.spec.where?.(doc) ?? true
  }
  async insert(ctx: MutationCtx, doc: Doc<T>) {
    if (this.counts(doc)) await this.aggregate.insertIfDoesNotExist(ctx, doc)
  }
  async replace(ctx: MutationCtx, before: Doc<T>, after: Doc<T>) {
    const was = this.counts(before)
    const is = this.counts(after)
    if (was && is) {
      // Most edits change nothing a count is keyed by.
      const { namespace, key } = this.spec
      if (
        sameValue(namespace(before), namespace(after)) &&
        sameValue(key(before), key(after)) &&
        this.spec.sum?.(before) === this.spec.sum?.(after)
      )
        return
      await this.aggregate.replaceOrInsert(ctx, before, after)
    } else if (was) await this.aggregate.deleteIfExists(ctx, before)
    else if (is) await this.aggregate.insertIfDoesNotExist(ctx, after)
  }
  async delete(ctx: MutationCtx, doc: Doc<T>) {
    if (this.counts(doc)) await this.aggregate.deleteIfExists(ctx, doc)
  }

  /** The namespace's rows whose key matches `parts`, created within
      `range` when the key ends in a time bucket. One `countBatch` call:
      unset parts before the last one bounded are counted value by value. */
  async total(
    ctx: QueryCtx,
    namespace: N,
    parts: readonly KeyPart[] = [],
    range: TimeRange = {}
  ): Promise<number | null> {
    const timed = range.from !== undefined || range.to !== undefined
    // The first bucket in the range, and the first one after it.
    const first = range.from === undefined ? 0 : range.from / BUCKET
    const after =
      range.to === undefined ? Number.MAX_SAFE_INTEGER : (range.to + 1) / BUCKET
    // A range that does not fall on bucket edges cannot be counted exactly.
    if (!Number.isInteger(first) || !Number.isInteger(after)) return null
    let depth = timed ? parts.length : 0
    if (!timed)
      parts.forEach((part, index) => {
        if (part.is !== undefined) depth = index + 1
      })
    let prefixes: Key[] = [[]]
    for (const part of parts.slice(0, depth))
      prefixes = prefixes.flatMap((prefix) =>
        (part.is === undefined ? part.among : [part.is]).map((value) => [
          ...prefix,
          value,
        ])
      )
    const bounds = (prefix: Key) =>
      timed
        ? {
            lower: { key: [...prefix, first], inclusive: true },
            upper: { key: [...prefix, after], inclusive: false },
          }
        : prefix.length
          ? { prefix }
          : undefined
    const counts = await this.aggregate.countBatch(
      ctx,
      // The typed prefix bound cannot follow a key of variable length.
      prefixes.map((prefix) => ({ namespace, bounds: bounds(prefix) })) as never
    )
    return counts.reduce((sum, count) => sum + count, 0)
  }
  /** One total per namespace, in one call: e.g. each listed segment's size. */
  async totals(ctx: QueryCtx, namespaces: N[]) {
    if (!namespaces.length) return []
    return this.aggregate.countBatch(
      ctx,
      namespaces.map((namespace) => ({ namespace })) as never
    )
  }
}

const team = (doc: { organizationId: string }) => doc.organizationId
const created = (doc: { _creationTime: number }) => bucket(doc._creationTime)

/** Every count, by what it counts. Keys follow each list's filters, so a
    filter narrows the count with key bounds instead of a scan. */
export const counters = {
  emailDomains: new Counter<"emails", string>(components.emailDomainCounts, {
    namespace: (row) => JSON.stringify([row.organizationId, row.domainId]),
    key: (row) => [row.status, created(row)],
    where: (row) => row.source !== "system",
  }),
  emailMetrics: new Counter<"emailMetrics", string>(
    components.emailMetricCounts,
    {
      namespace: team,
      key: (row) => [row.type, bucket(row.createdAt)],
    }
  ),
  domainMetrics: new Counter<"emailMetrics", string>(
    components.domainMetricCounts,
    {
      namespace: (row) => JSON.stringify([row.organizationId, row.domainId]),
      key: (row) => [row.type, bucket(row.createdAt)],
    }
  ),
  reputation: new Counter<"recipientMetrics", string>(
    components.reputationCounts,
    {
      namespace: (row) => row.tenantId,
      key: (row) => [row.type, row.at],
    }
  ),
  automations: new Counter<"automations", string>(components.automationCounts, {
    namespace: team,
    key: (row) => [row.status],
    where: (row) => !row.deleted,
  }),
  automationRuns: new Counter<"automationRuns", Id<"automations">>(
    components.automationRunCounts,
    {
      namespace: (row) => row.automationId,
      key: (row) => [row.status, row._creationTime],
      sum: (row) => row.sent,
    }
  ),
  automationRunSteps: new Counter<"automationRunSteps", Id<"automations">>(
    components.automationStepCounts,
    {
      namespace: (row) => row.automationId,
      key: (row) => [row.key, row.status, row.runStartedAt],
      sum: (row) =>
        row.completedAt === undefined ? 0 : row.completedAt - row.startedAt,
    }
  ),
  exports: new Counter<"exports", string>(components.exportCounts, {
    namespace: team,
    key: () => [],
  }),
  emails: new Counter<"emails", string>(components.emailCounts, {
    namespace: team,
    key: (email) => [email.status, created(email)],
    where: (email) => email.source !== "system",
  }),
  suppressions: new Counter<"suppressions", string>(
    components.suppressionCounts,
    {
      namespace: team,
      key: (row) => [row.reason, created(row)],
    }
  ),
  emailRecipients: new Counter<"emailRecipients", string>(
    components.emailRecipientCounts,
    {
      namespace: (row) => JSON.stringify([row.organizationId, row.address]),
      key: () => [],
    }
  ),
  emailEvents: new Counter<"emailEvents", Id<"emails">>(
    components.emailEventCounts,
    {
      namespace: (row) => row.emailId,
      key: (row) => [row.type],
    }
  ),
  contacts: new Counter<"contacts", string>(components.contactCounts, {
    namespace: team,
    key: (contact) => [contact.unsubscribed, created(contact)],
  }),
  segments: new Counter<"segments", string>(components.segmentCounts, {
    namespace: team,
    key: () => [],
  }),
  /** Each segment's size. */
  segmentMembers: new Counter<"segmentMembers", Id<"segments">>(
    components.segmentMemberCounts,
    { namespace: (member) => member.segmentId, key: () => [] }
  ),
  topics: new Counter<"topics", string>(components.topicCounts, {
    namespace: team,
    key: () => [],
  }),
  contactProperties: new Counter<"contactProperties", string>(
    components.propertyCounts,
    { namespace: team, key: () => [], where: (property) => !property.deleting }
  ),
  templates: new Counter<"templates", string>(components.templateCounts, {
    namespace: team,
    key: (template) => [template.status],
  }),
  apiKeys: new Counter<"apiKeys", string>(components.apiKeyCounts, {
    namespace: team,
    key: (key) => [key.permission],
  }),
  apiLogs: new Counter<"apiLogs", string>(components.apiLogCounts, {
    namespace: team,
    key: (log) => [log.statusClass, log.source, created(log)],
  }),
  /** A key's requests: "Total uses" and its request list. */
  apiKeyLogs: new Counter<"apiLogs", Id<"apiKeys">>(
    components.apiKeyLogCounts,
    {
      namespace: (log) => log.apiKeyId!,
      key: (log) => [log.statusClass, log.source, created(log)],
      where: (log) => log.apiKeyId !== undefined,
    }
  ),
  webhooks: new Counter<"webhooks", string>(components.webhookCounts, {
    namespace: team,
    key: (webhook) => [webhook.enabled],
  }),
  /** Each webhook's deliveries. */
  webhookDeliveries: new Counter<"webhookDeliveries", Id<"webhooks">>(
    components.deliveryCounts,
    {
      namespace: (delivery) => delivery.webhookId,
      key: (delivery) => [delivery.failed, delivery.event],
    }
  ),
  domains: new Counter<"domains", string>(components.domainCounts, {
    namespace: team,
    key: (domain) => [domain.status, domain.region],
    where: (domain) => !domain.deleted,
  }),
}

type Sync<T extends TableNames> = Pick<
  Counter<T, never>,
  "insert" | "replace" | "delete"
>
/** The counters each counted table keeps in step. */
const COUNTED: { [T in CountedTable]: Sync<T>[] } = {
  automations: [counters.automations],
  automationRuns: [counters.automationRuns],
  automationRunSteps: [counters.automationRunSteps],
  exports: [counters.exports],
  emails: [counters.emails, counters.emailDomains],
  recipientMetrics: [counters.reputation],
  emailMetrics: [counters.emailMetrics, counters.domainMetrics],
  suppressions: [counters.suppressions],
  emailRecipients: [counters.emailRecipients],
  emailEvents: [counters.emailEvents],
  contacts: [counters.contacts],
  segments: [counters.segments],
  segmentMembers: [counters.segmentMembers],
  topics: [counters.topics],
  contactProperties: [counters.contactProperties],
  templates: [counters.templates],
  apiKeys: [counters.apiKeys],
  apiLogs: [counters.apiLogs, counters.apiKeyLogs],
  webhooks: [counters.webhooks],
  webhookDeliveries: [counters.webhookDeliveries],
  domains: [counters.domains],
}
export type CountedTable =
  | "automations"
  | "automationRuns"
  | "automationRunSteps"
  | "exports"
  | "emails"
  | "emailMetrics"
  | "recipientMetrics"
  | "suppressions"
  | "emailRecipients"
  | "emailEvents"
  | "contacts"
  | "segments"
  | "segmentMembers"
  | "topics"
  | "contactProperties"
  | "templates"
  | "apiKeys"
  | "apiLogs"
  | "webhooks"
  | "webhookDeliveries"
  | "domains"
export const COUNTED_TABLES = Object.keys(COUNTED) as CountedTable[]

export async function insertRow<T extends CountedTable>(
  ctx: MutationCtx,
  table: T,
  value: WithoutSystemFields<Doc<T>>
): Promise<Id<T>> {
  const id = await ctx.db.insert(table, value)
  const doc = (await ctx.db.get(table, id))!
  for (const counter of COUNTED[table]) await counter.insert(ctx, doc)
  return id
}

/** Patches the row and returns it as written. */
export async function patchRow<T extends CountedTable>(
  ctx: MutationCtx,
  table: T,
  id: Id<T>,
  value: Partial<WithoutSystemFields<Doc<T>>>
): Promise<Doc<T>> {
  const before = await ctx.db.get(table, id)
  await ctx.db.patch(table, id, value as never)
  const after = (await ctx.db.get(table, id))!
  for (const counter of COUNTED[table])
    await counter.replace(ctx, before!, after)
  return after
}

export async function deleteRow<T extends CountedTable>(
  ctx: MutationCtx,
  table: T,
  id: Id<T>
) {
  const doc = await ctx.db.get(table, id)
  await ctx.db.delete(table, id)
  if (doc) for (const counter of COUNTED[table]) await counter.delete(ctx, doc)
}

/** Adds a row written before its counts existed; the backfill runs this. */
export async function countRow<T extends CountedTable>(
  ctx: MutationCtx,
  table: T,
  doc: Doc<T>
) {
  for (const counter of COUNTED[table]) await counter.insert(ctx, doc)
}
