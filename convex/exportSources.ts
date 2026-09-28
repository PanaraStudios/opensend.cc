import type { PaginationOptions } from "convex/server"
import type { QueryCtx } from "./_generated/server"
import { keyPage } from "./apiKeys"
import { emailPage } from "./emails"
import { suppressionPage } from "./suppressions"
import { EMAIL_STATUSES, SUPPRESSION_REASONS } from "./tables/emails"
import { logPage } from "./logs"
import { API_KEY_PERMISSIONS } from "../lib/dashboard/api-keys"
import { LOG_SOURCES, LOG_STATUS_CLASSES } from "../lib/dashboard/logs"
import { maskToken } from "../lib/dashboard/format"

/** Where an export reads its rows. `page` returns one batch of CSV cells,
    already scoped to the team and the list filters the export was started
    with; the export job calls it until `isDone`. */
export type ExportSource = {
  /** Shown in Settings → Exports. */
  label: string
  columns: string[]
  page: (
    ctx: QueryCtx,
    organizationId: string,
    filters: Record<string, string>,
    paginationOpts: PaginationOptions
  ) => Promise<{ rows: string[][]; isDone: boolean; continueCursor: string }>
}

const iso = (ms: number | null | undefined) =>
  ms == null ? "" : new Date(ms).toISOString()
/** A filter value only if it is one of `values`. */
function oneOf<T extends string>(
  value: string | undefined,
  values: readonly T[]
) {
  return values.includes(value as T) ? (value as T) : undefined
}
const time = (value: string | undefined) =>
  value && Number.isFinite(Number(value)) ? Number(value) : undefined

/** Every exportable resource. A feature makes its list exportable by adding
    an entry here; the export job and Settings → Exports need no change. */
export const EXPORT_SOURCES: Record<string, ExportSource> = {
  "api-keys": {
    label: "API keys",
    columns: [
      "id",
      "name",
      "token",
      "permission",
      "domain_id",
      "created_by",
      "created_at",
      "last_used_at",
    ],
    page: async (ctx, organizationId, filters, paginationOpts) => {
      const result = await keyPage(ctx, {
        organizationId,
        paginationOpts,
        permission: oneOf(filters.permission, API_KEY_PERMISSIONS),
        search: filters.search,
      })
      return {
        ...result,
        rows: result.page.map((key) => [
          key._id,
          key.name,
          maskToken(key.tokenPrefix, key.tokenLast4),
          key.permission,
          key.domainId ?? "",
          key.createdBy.name,
          iso(key._creationTime),
          iso(key.lastUsedAt),
        ]),
      }
    },
  },
  logs: {
    label: "Logs",
    columns: [
      "id",
      "created_at",
      "method",
      "endpoint",
      "status",
      "source",
      "user_agent",
      "duration_ms",
      "api_key_id",
      "email_id",
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
          iso(log._creationTime),
          log.method,
          log.path,
          String(log.status),
          log.source,
          log.userAgent,
          String(log.durationMs),
          log.apiKeyId ?? "",
          log.emailId ?? "",
        ]),
      }
    },
  },
  emails: {
    label: "Emails",
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
          iso(email._creationTime),
          email.from,
          email.to.join(", "),
          (email.cc ?? []).join(", "),
          (email.bcc ?? []).join(", "),
          email.subject,
          email.status,
          iso(email.scheduledAt),
          iso(email.sentAt),
        ]),
      }
    },
  },
  suppressions: {
    label: "Suppressions",
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
          iso(row._creationTime),
        ]),
      }
    },
  },
  domains: {
    label: "Domains",
    columns: [
      "id",
      "name",
      "status",
      "region",
      "sending",
      "receiving",
      "created_at",
    ],
    page: async (ctx, organizationId, _filters, paginationOpts) => {
      const result = await ctx.db
        .query("domains")
        .withIndex("by_organizationId_and_deleted", (q) =>
          q.eq("organizationId", organizationId).eq("deleted", false)
        )
        .order("desc")
        .paginate(paginationOpts)
      return {
        ...result,
        rows: result.page.map((domain) => [
          domain._id,
          domain.name,
          domain.status,
          domain.region,
          String(domain.sending),
          String(domain.receiving ?? false),
          iso(domain._creationTime),
        ]),
      }
    },
  },
}
