import { v, ConvexError } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import {
  action,
  query,
  mutation,
  internalAction,
  internalMutation,
  internalQuery,
  env,
} from "./_generated/server"
import type { ActionCtx } from "./_generated/server"
import { api, internal, components } from "./_generated/api"
import { findInstallation, requireInstallationAdmin } from "./access"
import { counters } from "./counts"
import { logSourceValue, statusClassValue } from "./tables/api"
import { CHANNELS, CHANNEL_MESSAGE_STATUSES } from "./tables/channels"
import { literals } from "./counts"
import packageInfo from "../package.json"
import {
  buildPayload,
  emptyUsage,
  telemetryEnabled,
  TELEMETRY_CAP,
  TELEMETRY_DAY,
  TELEMETRY_COUNT_FIELDS,
} from "../lib/telemetry"
import type {
  UsageCounts,
  TelemetryPayload,
  Deployment,
} from "../lib/telemetry"

const enabled = (preference?: boolean) =>
  telemetryEnabled(env.OPENSEND_TELEMETRY, preference)
export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireInstallationAdmin(ctx)
    const installation = await findInstallation(ctx)
    return {
      enabled: enabled(installation?.telemetryEnabled),
      locked: env.OPENSEND_TELEMETRY === "0",
    }
  },
})
export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    if (env.OPENSEND_TELEMETRY === "0")
      throw new ConvexError(
        "Anonymous statistics are disabled by the server environment"
      )
    const installation = await findInstallation(ctx)
    if (!installation) throw new ConvexError("Start setup first")
    await ctx.db.patch("installation", installation._id, {
      telemetryEnabled: args.enabled,
    })
    return null
  },
})
export const identify = internalMutation({
  args: { candidate: v.string() },
  handler: async (ctx, { candidate }) => {
    const installation = await findInstallation(ctx)
    if (!installation) return null
    const installationId = installation.installationId ?? candidate
    if (!installation.installationId)
      await ctx.db.patch("installation", installation._id, { installationId })
    const regions = await ctx.db
      .query("sesRegions")
      .withIndex("by_region")
      .take(30)
    return {
      installationId,
      installedAt: installation._creationTime,
      sesProduction:
        !installation.accountId || !regions.length
          ? null
          : regions.some((region) => region.quota.production),
    }
  },
})
export const dispatch = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const installation = await findInstallation(ctx)
    if (!installation?.completedAt || !enabled(installation.telemetryEnabled))
      return null
    const now = Date.now()
    if (
      installation.telemetryScheduledAt &&
      installation.telemetryScheduledAt > now
    )
      return null
    const at =
      Math.max(
        now,
        (installation.telemetryLastAttemptAt ?? 0) + TELEMETRY_DAY
      ) + Math.floor(Math.random() * 2 * 60 * 60_000)
    await ctx.db.patch("installation", installation._id, {
      telemetryScheduledAt: at,
    })
    await ctx.scheduler.runAt(at, internal.telemetry.send, {})
    return null
  },
})
export const reserve = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const installation = await findInstallation(ctx)
    const now = Date.now()
    if (
      !installation?.completedAt ||
      !enabled(installation.telemetryEnabled) ||
      (installation.telemetryLastAttemptAt !== undefined &&
        now - installation.telemetryLastAttemptAt < TELEMETRY_DAY)
    )
      return false
    await ctx.db.patch("installation", installation._id, {
      telemetryLastAttemptAt: now,
      telemetryScheduledAt: undefined,
    })
    return true
  },
})
export const canSend = internalQuery({
  args: {},
  handler: async (ctx) => {
    const installation = await findInstallation(ctx)
    return !!installation?.completedAt && enabled(installation.telemetryEnabled)
  },
})

// Large data uses existing aggregates. Time windows align to their 15-minute
// buckets, covering the most recent complete 24 hours without scanning content.
export const teamUsage = internalQuery({
  args: { team: v.string(), now: v.number() },
  handler: async (ctx, { team, now }) => {
    const end = Math.floor(now / 900_000) * 900_000
    const range = { from: end - TELEMETRY_DAY, to: end - 1 }
    const counts = emptyUsage()
    counts.emailsSent24h =
      (await counters.usageSent.total(ctx, team, [], range)) ?? 0
    counts.emailsReceived24h =
      (await counters.usageReceived.total(ctx, team, [], range)) ?? 0
    counts.domainsVerified =
      (await counters.domains.total(ctx, team, [
        { is: "verified", among: [] },
      ])) ?? 0
    counts.automationsActive =
      (await counters.automations.total(ctx, team, [
        { is: "enabled", among: [] },
      ])) ?? 0
    counts.webhookEndpoints = (await counters.webhooks.total(ctx, team)) ?? 0
    counts.apiKeys = (await counters.apiKeys.total(ctx, team)) ?? 0
    const statuses = { among: literals(statusClassValue) }
    const sources = { is: "api", among: literals(logSourceValue) }
    counts.apiRequests24h =
      (await counters.apiLogs.total(ctx, team, [statuses, sources], range)) ?? 0
    const smtp =
      (await counters.apiLogs.total(
        ctx,
        team,
        [statuses, { is: "smtp", among: [] }],
        { from: end - 30 * TELEMETRY_DAY, to: end - 1 }
      )) ?? 0
    const accounts = await counters.channelAccounts.prefixTotals(ctx, team, [
      ["whatsapp"],
      ["messenger"],
      ["instagram"],
    ])
    ;[
      counts.whatsappAccounts,
      counts.messengerPages,
      counts.instagramAccounts,
    ] = accounts
    counts.channelMessages24h =
      (await counters.channelMessages.total(
        ctx,
        team,
        [{ among: CHANNELS }, { among: CHANNEL_MESSAGE_STATUSES }],
        range
      )) ?? 0
    const sso = await ctx.runQuery(components.betterAuth.sso.connection, {
      organizationId: team,
    })
    return { counts, smtpUsed30d: smtp > 0, ssoEnabled: sso?.enforced ?? false }
  },
})
// Tables without aggregates are counted in bounded index pages, stopping at
// 10k across the installation. No message bodies or configuration leave queries.
const rowKind = v.union(
  v.literal("broadcasts30d"),
  v.literal("calls30d"),
  v.literal("ivrs"),
  v.literal("voiceBots"),
  v.literal("clientRequests")
)
export const rows = internalQuery({
  args: {
    kind: rowKind,
    team: v.string(),
    now: v.number(),
    userAgent: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { team, now, paginationOpts } = args
    const since = now - 30 * TELEMETRY_DAY
    const page =
      args.kind === "broadcasts30d"
        ? await ctx.db
            .query("broadcasts")
            .withIndex("by_organizationId", (q) =>
              q.eq("organizationId", team).gte("_creationTime", since)
            )
            .paginate(paginationOpts)
        : args.kind === "calls30d"
          ? await ctx.db
              .query("calls")
              .withIndex("by_organizationId", (q) =>
                q.eq("organizationId", team).gte("_creationTime", since)
              )
              .paginate(paginationOpts)
          : args.kind === "ivrs"
            ? await ctx.db
                .query("ivrs")
                .withIndex("by_organizationId", (q) =>
                  q.eq("organizationId", team)
                )
                .paginate(paginationOpts)
            : args.kind === "voiceBots"
              ? await ctx.db
                  .query("voiceBots")
                  .withIndex("by_organizationId", (q) =>
                    q.eq("organizationId", team)
                  )
                  .paginate(paginationOpts)
              : await ctx.db
                  .query("apiLogs")
                  .withIndex("by_organizationId_and_userAgent", (q) =>
                    q
                      .eq("organizationId", team)
                      .eq("userAgent", args.userAgent!)
                      .gte("_creationTime", now - TELEMETRY_DAY)
                  )
                  .paginate(paginationOpts)
    return {
      count:
        args.kind === "clientRequests"
          ? page.page.filter((row) => "source" in row && row.source === "api")
              .length
          : page.page.length,
      done: page.isDone,
      cursor: page.continueCursor,
    }
  },
})
export const nextAgent = internalQuery({
  args: {
    team: v.string(),
    prefix: v.string(),
    after: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { team, prefix, after }) => {
    const row = await ctx.db
      .query("apiLogs")
      .withIndex("by_organizationId_and_userAgent", (q) =>
        after === null
          ? q
              .eq("organizationId", team)
              .gte("userAgent", prefix)
              .lt("userAgent", `${prefix}\uffff`)
          : q
              .eq("organizationId", team)
              .gt("userAgent", after)
              .lt("userAgent", `${prefix}\uffff`)
      )
      .first()
    return row?.userAgent ?? null
  },
})
async function gather(
  ctx: ActionCtx,
  now: number
): Promise<TelemetryPayload | null> {
  const identity: {
    installationId: string
    installedAt: number
    sesProduction: boolean | null
  } | null = await ctx.runMutation(internal.telemetry.identify, {
    candidate: crypto.randomUUID(),
  })
  if (!identity) return null
  const counts = emptyUsage()
  let smtpUsed30d = false,
    ssoEnabled = false
  let teamCursor: string | null = null
  do {
    const page: {
      page: { _id: string }[]
      isDone: boolean
      continueCursor: string
    } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "organization",
      select: ["_id"],
      paginationOpts: {
        numItems: 100,
        cursor: teamCursor,
        maximumRowsRead: 100,
        maximumBytesRead: 1_000_000,
      },
    })
    for (const team of page.page) {
      counts.teams = Math.min(TELEMETRY_CAP, counts.teams + 1)
      const usage: {
        counts: UsageCounts
        smtpUsed30d: boolean
        ssoEnabled: boolean
      } = await ctx.runQuery(internal.telemetry.teamUsage, {
        team: team._id,
        now,
      })
      for (const key of TELEMETRY_COUNT_FIELDS)
        counts[key] = Math.min(TELEMETRY_CAP, counts[key] + usage.counts[key])
      smtpUsed30d ||= usage.smtpUsed30d
      ssoEnabled ||= usage.ssoEnabled
      for (const kind of [
        "broadcasts30d",
        "calls30d",
        "ivrs",
        "voiceBots",
      ] as const) {
        let cursor: string | null = null
        while (counts[kind] < TELEMETRY_CAP) {
          const rows: { count: number; done: boolean; cursor: string } =
            await ctx.runQuery(internal.telemetry.rows, {
              kind,
              team: team._id,
              now,
              paginationOpts: {
                numItems: Math.min(200, TELEMETRY_CAP - counts[kind]),
                cursor,
                maximumRowsRead: 200,
                maximumBytesRead: 1_000_000,
              },
            })
          counts[kind] = Math.min(TELEMETRY_CAP, counts[kind] + rows.count)
          if (rows.done) break
          cursor = rows.cursor
        }
      }
      for (const [field, prefix] of [
        ["sdkRequests24h", "opensend-node:"],
        ["mcpRequests24h", "opensend-mcp:"],
      ] as const) {
        let after: string | null = null
        while (counts[field] < TELEMETRY_CAP) {
          const agent: string | null = await ctx.runQuery(
            internal.telemetry.nextAgent,
            { team: team._id, prefix, after }
          )
          if (!agent) break
          let cursor: string | null = null
          while (counts[field] < TELEMETRY_CAP) {
            const rows: { count: number; done: boolean; cursor: string } =
              await ctx.runQuery(internal.telemetry.rows, {
                kind: "clientRequests",
                team: team._id,
                userAgent: agent,
                now,
                paginationOpts: {
                  numItems: Math.min(200, TELEMETRY_CAP - counts[field]),
                  cursor,
                  maximumRowsRead: 200,
                  maximumBytesRead: 1_000_000,
                },
              })
            counts[field] = Math.min(TELEMETRY_CAP, counts[field] + rows.count)
            if (rows.done) break
            cursor = rows.cursor
          }
          after = agent
        }
      }
    }
    if (page.isDone) break
    teamCursor = page.continueCursor
  } while (true)
  let memberCursor: string | null = null
  while (counts.members < TELEMETRY_CAP) {
    const page: {
      page: { _id: string }[]
      isDone: boolean
      continueCursor: string
    } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "member",
      select: ["_id"],
      paginationOpts: {
        numItems: Math.min(200, TELEMETRY_CAP - counts.members),
        cursor: memberCursor,
        maximumRowsRead: 200,
        maximumBytesRead: 1_000_000,
      },
    })
    counts.members = Math.min(TELEMETRY_CAP, counts.members + page.page.length)
    if (page.isDone) break
    memberCursor = page.continueCursor
  }
  const deployment: Deployment = {
    backend:
      env.OPENSEND_BACKEND === "convex-cloud"
        ? "convex-cloud"
        : env.OPENSEND_BACKEND === "self-hosted" ||
            !env.CONVEX_CLOUD_URL.endsWith(".convex.cloud")
          ? "self-hosted"
          : "convex-cloud",
    installMethod:
      env.OPENSEND_INSTALL_METHOD === "script" ||
      env.OPENSEND_INSTALL_METHOD === "compose" ||
      env.OPENSEND_INSTALL_METHOD === "source"
        ? env.OPENSEND_INSTALL_METHOD
        : "unknown",
    arch:
      env.OPENSEND_ARCH === "amd64" || env.OPENSEND_ARCH === "arm64"
        ? env.OPENSEND_ARCH
        : "unknown",
    calling: env.OPENSEND_CALLING === "1",
  }
  return buildPayload({
    ...identity,
    now,
    version: env.OPENSEND_VERSION || packageInfo.version,
    deployment,
    counts,
    smtpUsed30d,
    ssoEnabled,
  })
}
export const preview = action({
  args: {},
  handler: async (ctx): Promise<TelemetryPayload | null> => {
    await ctx.runQuery(api.telemetry.settings, {}) // Admin guard, including when hard off.
    return gather(ctx, Date.now())
  },
})
export const send = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (env.OPENSEND_TELEMETRY === "0") return null
    try {
      if (!(await ctx.runMutation(internal.telemetry.reserve, {}))) return null
      const payload = await gather(ctx, Date.now())
      if (!payload || !(await ctx.runQuery(internal.telemetry.canSend, {})))
        return null
      const body = JSON.stringify(payload)
      if (new TextEncoder().encode(body).length > 8192) return null
      const response = await fetch(
        env.OPENSEND_TELEMETRY_URL || "https://opensend.cc/api/telemetry",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(3000),
          redirect: "error",
        }
      )
      await response.body?.cancel()
    } catch {
      /* Telemetry must never affect the product or log private data. */
    }
    return null
  },
})
