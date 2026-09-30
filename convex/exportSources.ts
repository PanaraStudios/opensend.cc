import { receivedPage } from "./received"
import { broadcastPage } from "./broadcasts"
import { BROADCAST_STATUSES } from "./tables/broadcasts"
import { SEGMENT_SEARCH_BUDGET } from "./segments"
import type { PaginationOptions } from "convex/server"
import type { QueryCtx } from "./_generated/server"
import { components } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { keyPage } from "./apiKeys"
import { contactPage } from "./contacts"
import { domainPage } from "./domains"
import { listProperties } from "./audience"
import { emailPage } from "./emails"
import { suppressionPage } from "./suppressions"
import { EMAIL_STATUSES, SUPPRESSION_REASONS } from "./tables/emails"
import { logPage } from "./logs"
import { regions } from "./ses/contracts"
import { API_KEY_PERMISSIONS } from "../lib/dashboard/api-keys"
import { providerLabel } from "../lib/dashboard/domains"
import { csvTime } from "../lib/dashboard/exports"
import { maskToken } from "../lib/dashboard/format"
import { LOG_SOURCES, LOG_STATUS_CLASSES } from "../lib/dashboard/logs"
import { matchesSearch, teamPage } from "./lists"
import { counters } from "./counts"

type Page = { rows: string[][]; isDone: boolean; continueCursor: string }

/** Where an export reads its rows. `page` returns one batch of CSV cells,
    already scoped to the team and the list filters the export was started
    with; the export job calls it until `isDone`. Headers copy Resend's
    exports, name for name and in order. */
export type ExportSource = {
  columns: readonly string[]
  /** Columns the team defines, after the fixed ones: a contact's custom
      properties. `page` gets them back as `extra`. */
  extraColumns?: (ctx: QueryCtx, organizationId: string) => Promise<string[]>
  page: (
    ctx: QueryCtx,
    organizationId: string,
    filters: Record<string, string>,
    paginationOpts: PaginationOptions,
    extra: readonly string[]
  ) => Promise<Page>
}

/** A filter value only if it is one of `values`. */
function oneOf<T extends string>(
  value: string | undefined,
  values: readonly T[]
) {
  return values.includes(value as T) ? (value as T) : undefined
}
const time = (value: string | undefined) =>
  value && Number.isFinite(Number(value)) ? Number(value) : undefined
const bool = (value: string | undefined) =>
  value === "true" ? true : value === "false" ? false : undefined

/** Looks each id up once per batch: many rows share a creator or domain. */
function memo<K, V>(load: (key: K) => Promise<V>) {
  const seen = new Map<K, Promise<V>>()
  return (key: K) => {
    if (!seen.has(key)) seen.set(key, load(key))
    return seen.get(key)!
  }
}
async function userEmail(ctx: QueryCtx, userId: string) {
  const user: { email?: string } | null = await ctx.runQuery(
    components.betterAuth.adapter.findOne,
    { model: "user", where: [{ field: "_id", value: userId }] }
  )
  return user?.email ?? ""
}

const DOMAIN_STATUSES = [
  "pending",
  "verified",
  "partially_verified",
  "failed",
] as const
type DomainRecord = Doc<"domains">["records"][number]
/** One status for the records of some kinds, in Resend's words. */
function recordsStatus(
  domain: Doc<"domains">,
  kinds: readonly DomainRecord["kind"][]
) {
  const records = domain.records.filter((record) => kinds.includes(record.kind))
  if (records.length === 0) return "not_started"
  if (records.every((record) => record.status === "verified")) return "verified"
  if (domain.status === "failed") return "failed"
  return records.some((record) => record.status === "temporary_failure")
    ? "temporary_failure"
    : "pending"
}

/** Every exportable resource. A feature makes its list exportable by adding
    an entry here; the export job and Settings → Exports need no change. */
export const EXPORT_SOURCES: Record<string, ExportSource> = {
  received: {
    columns: [
      "id",
      "created_at",
      "from",
      "to",
      "cc",
      "bcc",
      "subject",
      "message_id",
    ],
    page: async (ctx, organizationId, filters, paginationOpts) => {
      const result = await receivedPage(ctx, {
        organizationId,
        paginationOpts,
        search: filters.search,
        from: time(filters.from),
        to: time(filters.to),
      })
      return {
        ...result,
        rows: result.page.map((row) => [
          row._id,
          csvTime(row.receivedAt),
          row.from,
          row.to.join(", "),
          row.cc.join(", "),
          row.bcc.join(", "),
          row.subject,
          row.messageId,
        ]),
      }
    },
  },
  domains: {
    columns: [
      "id",
      "created_at",
      "name",
      "dkim_status",
      "spf_status",
      "spf_domain",
      "nameserver",
      "disable_content_storage",
      "open_track",
      "click_track",
      "region",
    ],
    page: async (ctx, organizationId, filters, paginationOpts) => {
      const result = await domainPage(ctx, {
        organizationId,
        paginationOpts,
        search: filters.search,
        status: oneOf(filters.status, DOMAIN_STATUSES),
        region: oneOf(filters.region, regions),
      })
      return {
        ...result,
        rows: result.page.map((domain) => [
          domain._id,
          csvTime(domain._creationTime),
          domain.name,
          recordsStatus(domain, ["DKIM"]),
          // Resend's SPF record is our return-path MX and its TXT.
          recordsStatus(domain, ["MX", "SPF"]),
          `${domain.customReturnPath}.${domain.name}`,
          domain.dnsProvider ? providerLabel(domain.dnsProvider) : "",
          "false",
          String(!!domain.openTracking),
          String(!!domain.clickTracking),
          domain.region,
        ]),
      }
    },
  },
  "api-keys": {
    columns: [
      "id",
      "created_at",
      "name",
      "token",
      "permission",
      "domain",
      "creator",
    ],
    page: async (ctx, organizationId, filters, paginationOpts) => {
      const result = await keyPage(ctx, {
        organizationId,
        paginationOpts,
        permission: oneOf(filters.permission, API_KEY_PERMISSIONS),
        search: filters.search,
      })
      const domainName = memo(
        async (id: Id<"domains">) => (await ctx.db.get("domains", id))?.name
      )
      const creator = memo((userId: string) => userEmail(ctx, userId))
      const rows = []
      for (const key of result.page)
        rows.push([
          key._id,
          csvTime(key._creationTime),
          key.name,
          maskToken(key.tokenPrefix, key.tokenLast4),
          key.permission,
          (key.domainId && (await domainName(key.domainId))) ?? "",
          key.createdBy.userId ? await creator(key.createdBy.userId) : "",
        ])
      return { ...result, rows }
    },
  },
  logs: {
    columns: [
      "id",
      "created_at",
      "api_key_id",
      "oauth_grant_id",
      "user_agent",
      "method",
      "endpoint",
      "response_status",
    ],
    page: async (ctx, organizationId, filters, paginationOpts) => {
      const result = await logPage(ctx, {
        organizationId,
        paginationOpts,
        statusClass: oneOf(filters.statusClass, LOG_STATUS_CLASSES),
        source: oneOf(filters.source, LOG_SOURCES),
        userAgent: filters.userAgent,
        emailId: filters.emailId,
        search: filters.search,
        from: time(filters.from),
        to: time(filters.to),
      })
      return {
        ...result,
        rows: result.page.map((log) => [
          log._id,
          csvTime(log._creationTime),
          log.apiKeyId ?? "",
          log.oauthGrantId ?? "",
          log.userAgent,
          log.method,
          log.path,
          String(log.status),
        ]),
      }
    },
  },
  broadcasts: {
    columns: [
      "id",
      "name",
      "segment_id",
      "topic_id",
      "from",
      "subject",
      "status",
      "created_at",
      "scheduled_at",
      "sent_at",
    ],
    page: async (ctx, organizationId, filters, paginationOpts) => {
      const result = await broadcastPage(ctx, {
        organizationId,
        paginationOpts,
        search: filters.search,
        status: oneOf(filters.status, BROADCAST_STATUSES),
        audience: filters.audience,
      })
      return {
        ...result,
        rows: result.page.map((row) => [
          row._id,
          row.name,
          row.segmentId ?? "",
          row.topicId ?? "",
          row.from ?? "",
          row.subject,
          row.status,
          csvTime(row._creationTime),
          csvTime(row.scheduledAt),
          csvTime(row.sentAt),
        ]),
      }
    },
  },
  emails: {
    columns: [
      "id",
      "created_at",
      "from",
      "to",
      "cc",
      "bcc",
      "subject",
      "status",
      "scheduled_at",
      "sent_at",
    ],
    page: async (ctx, organizationId, filters, paginationOpts) => {
      const result = await emailPage(ctx, {
        organizationId,
        paginationOpts,
        status: oneOf(filters.status, EMAIL_STATUSES),
        search: filters.search,
        from: time(filters.from),
        to: time(filters.to),
      })
      return {
        ...result,
        rows: result.page.map((email) => [
          email._id,
          csvTime(email._creationTime),
          email.from,
          email.to.join(", "),
          (email.cc ?? []).join(", "),
          (email.bcc ?? []).join(", "),
          email.subject,
          email.status,
          csvTime(email.scheduledAt),
          csvTime(email.sentAt),
        ]),
      }
    },
  },
  suppressions: {
    columns: ["id", "email", "origin", "created_at"],
    page: async (ctx, organizationId, filters, paginationOpts) => {
      const result = await suppressionPage(ctx, {
        organizationId,
        paginationOpts,
        reason: oneOf(filters.reason, SUPPRESSION_REASONS),
        search: filters.search,
        from: time(filters.from),
        to: time(filters.to),
      })
      return {
        ...result,
        rows: result.page.map((row) => [
          row._id,
          row.email,
          row.reason,
          csvTime(row._creationTime),
        ]),
      }
    },
  },
  contacts: {
    columns: [
      "id",
      "created_at",
      "email",
      "phone",
      "first_name",
      "last_name",
      "unsubscribed",
    ],
    extraColumns: async (ctx, organizationId) =>
      (await listProperties(ctx, organizationId)).map(
        (property) => property.key
      ),
    page: async (ctx, organizationId, filters, paginationOpts, extra) => {
      const segmentId = filters.segmentId
        ? ctx.db.normalizeId("segments", filters.segmentId)
        : null
      // A segment that is gone matches no one, rather than everyone.
      if (filters.segmentId && !segmentId)
        return { rows: [], isDone: true, continueCursor: "" }
      const result = await contactPage(ctx, {
        organizationId,
        paginationOpts,
        search: filters.search,
        unsubscribed: bool(filters.unsubscribed),
        segmentId: segmentId ?? undefined,
        from: time(filters.from),
        to: time(filters.to),
      })
      return {
        ...result,
        rows: result.page.map((contact) => [
          contact._id,
          csvTime(contact._creationTime),
          contact.email ?? "",
          contact.phone ?? "",
          contact.firstName,
          contact.lastName,
          String(contact.unsubscribed),
          ...extra.map((key) => contact.properties[key] ?? ""),
        ]),
      }
    },
  },
  segments: {
    columns: ["id", "created_at", "name", "contacts"],
    page: async (ctx, organizationId, filters, paginationOpts) => {
      const matches = matchesSearch(filters.search)
      const result = await teamPage(
        ctx,
        "segments",
        organizationId,
        paginationOpts,
        (segment) => matches(segment.name),
        SEGMENT_SEARCH_BUDGET,
        filters.search
      )
      const sizes = await counters.segmentMembers.totals(
        ctx,
        result.page.map((segment) => segment._id)
      )
      return {
        ...result,
        rows: result.page.map((segment, index) => [
          segment._id,
          csvTime(segment._creationTime),
          segment.name,
          String(sizes[index]),
        ]),
      }
    },
  },
}
