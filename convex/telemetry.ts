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
import { counters, type KeyPart } from "./counts"
import { logSourceValue, statusClassValue } from "./tables/api"
import { CHANNELS, CHANNEL_MESSAGE_STATUSES } from "./tables/channels"
import { literals } from "./counts"
import {
  buildPayload,
  emptyUsage,
  telemetryEnabled,
  TELEMETRY_CAP,
  TELEMETRY_DAY,
} from "../lib/telemetry"
import type { TelemetryPayload, Deployment } from "../lib/telemetry"

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

// Enumerate aggregate root metadata rather than walking the team catalog.
// Each metric stops at its highest band, including namespaces with no live team.
const aggregates = {
  emailsSent24h: counters.usageSent,
  emailsReceived24h: counters.usageReceived,
  domainsVerified: counters.domains,
  automationsActive: counters.automations,
  webhookEndpoints: counters.webhooks,
  apiKeys: counters.apiKeys,
  apiRequests24h: counters.apiLogs,
  smtpRequests30d: counters.apiLogs,
  whatsappAccounts: counters.channelAccounts,
  messengerPages: counters.channelAccounts,
  instagramAccounts: counters.channelAccounts,
  channelMessages24h: counters.channelMessages,
}
const aggregateFields = Object.keys(aggregates) as (keyof typeof aggregates)[]
export const metric = internalQuery({
  args: {
    field: v.union(...aggregateFields.map(v.literal)),
    team: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { field, team, now }) => {
    // Presence can use a single indexed row, including the current partial bucket.
    if (field === "smtpRequests30d")
      return (await ctx.db
        .query("apiLogs")
        .withIndex("by_organizationId_and_source", (q) =>
          q
            .eq("organizationId", team)
            .eq("source", "smtp")
            .gte("_creationTime", now - 30 * TELEMETRY_DAY)
        )
        .first())
        ? 1
        : 0
    const end = Math.floor(now / 900_000) * 900_000
    const channels = {
      whatsappAccounts: "whatsapp",
      messengerPages: "messenger",
      instagramAccounts: "instagram",
    } as const
    const parts: KeyPart[] =
      field === "domainsVerified"
        ? [{ is: "verified", among: [] }]
        : field === "automationsActive"
          ? [{ is: "enabled", among: [] }]
          : field === "apiRequests24h"
            ? [
                { among: literals(statusClassValue) },
                {
                  is: "api",
                  among: literals(logSourceValue),
                },
              ]
            : field === "channelMessages24h"
              ? [{ among: CHANNELS }, { among: CHANNEL_MESSAGE_STATUSES }]
              : field in channels
                ? [{ is: channels[field as keyof typeof channels], among: [] }]
                : []
    const timed =
      field === "emailsSent24h" ||
      field === "emailsReceived24h" ||
      field === "apiRequests24h" ||
      field === "channelMessages24h"
    const range = timed
      ? {
          from: end - TELEMETRY_DAY,
          to: end - 1,
        }
      : {}
    return Math.min(
      TELEMETRY_CAP,
      (await aggregates[field].total(ctx, team, parts, range)) ?? 0
    )
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
    team: v.optional(v.string()),
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
            .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
            .paginate(paginationOpts)
        : args.kind === "calls30d"
          ? await ctx.db
              .query("calls")
              .withIndex("by_creation_time", (q) =>
                q.gte("_creationTime", since)
              )
              .paginate(paginationOpts)
          : args.kind === "ivrs"
            ? await ctx.db
                .query("ivrs")
                .withIndex("by_creation_time")
                .paginate(paginationOpts)
            : args.kind === "voiceBots"
              ? await ctx.db
                  .query("voiceBots")
                  .withIndex("by_creation_time")
                  .paginate(paginationOpts)
              : await ctx.db
                  .query("apiLogs")
                  .withIndex("by_organizationId_and_userAgent", (q) =>
                    q
                      .eq("organizationId", team!)
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
  let smtpUsed30d = false
  for (const model of ["organization", "member"] as const) {
    const field = model === "organization" ? "teams" : "members"
    let cursor: string | null = null
    while (counts[field] < TELEMETRY_CAP) {
      const page: {
        page: { _id: string }[]
        isDone: boolean
        continueCursor: string
      } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model,
        select: ["_id"],
        paginationOpts: {
          numItems: Math.min(200, TELEMETRY_CAP - counts[field]),
          cursor,
          maximumRowsRead: 200,
          maximumBytesRead: 1_000_000,
        },
      })
      counts[field] = Math.min(TELEMETRY_CAP, counts[field] + page.page.length)
      if (page.isDone) break
      cursor = page.continueCursor
    }
  }
  for (const field of aggregateFields) {
    let total = 0
    const cap = field === "smtpRequests30d" ? 1 : TELEMETRY_CAP
    // Namespace pages contain only B-tree root keys, not application rows.
    for await (const team of aggregates[field].aggregate.iterNamespaces(
      ctx,
      100
    )) {
      if (typeof team !== "string") continue
      const count: number = await ctx.runQuery(internal.telemetry.metric, {
        field,
        team,
        now,
      })
      total = Math.min(cap, total + count)
      if (total === cap) break
    }
    if (field === "smtpRequests30d") smtpUsed30d = total > 0
    else counts[field] = total
  }
  for (const kind of [
    "broadcasts30d",
    "calls30d",
    "ivrs",
    "voiceBots",
  ] as const) {
    let cursor: string | null = null
    while (counts[kind] < TELEMETRY_CAP) {
      const page: { count: number; done: boolean; cursor: string } =
        await ctx.runQuery(internal.telemetry.rows, {
          kind,
          now,
          paginationOpts: {
            numItems: Math.min(200, TELEMETRY_CAP - counts[kind]),
            cursor,
            maximumRowsRead: 200,
            maximumBytesRead: 1_000_000,
          },
        })
      counts[kind] = Math.min(TELEMETRY_CAP, counts[kind] + page.count)
      if (page.done) break
      cursor = page.cursor
    }
  }
  for (const [field, prefix] of [
    ["sdkRequests24h", "opensend-node:"],
    ["mcpRequests24h", "opensend-mcp:"],
  ] as const) {
    for await (const team of counters.apiLogs.aggregate.iterNamespaces(
      ctx,
      100
    )) {
      if (typeof team !== "string") continue
      let after: string | null = null
      while (counts[field] < TELEMETRY_CAP) {
        const agent: string | null = await ctx.runQuery(
          internal.telemetry.nextAgent,
          { team, prefix, after }
        )
        if (!agent) break
        let cursor: string | null = null
        while (counts[field] < TELEMETRY_CAP) {
          const page: { count: number; done: boolean; cursor: string } =
            await ctx.runQuery(internal.telemetry.rows, {
              kind: "clientRequests",
              team,
              userAgent: agent,
              now,
              paginationOpts: {
                numItems: Math.min(200, TELEMETRY_CAP - counts[field]),
                cursor,
                maximumRowsRead: 200,
                maximumBytesRead: 1_000_000,
              },
            })
          counts[field] = Math.min(TELEMETRY_CAP, counts[field] + page.count)
          if (page.done) break
          cursor = page.cursor
        }
        after = agent
      }
      if (counts[field] === TELEMETRY_CAP) break
    }
  }
  const sso: { page: unknown[] } = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: "sso",
      where: [{ field: "enforced", value: true }],
      select: ["enforced"],
      paginationOpts: {
        numItems: 1,
        cursor: null,
        maximumRowsRead: 1,
        maximumBytesRead: 1_000_000,
      },
    }
  )
  const ssoEnabled = sso.page.length > 0
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
    version: env.OPENSEND_VERSION,
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
