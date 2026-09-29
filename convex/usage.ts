import { v, type Infer } from "convex/values"
import { query, type QueryCtx } from "./_generated/server"
import { findInstallation, findRegion, requireTeam } from "./access"
import { counters } from "./counts"
import { LIMITS } from "./audience"
import { API_RATE } from "./api/state"

const limit = v.union(v.number(), v.null())
const quota = v.object({ used: v.number(), limit })
const period = quota.extend({
  sent: v.number(),
  received: v.number(),
  resets_at: v.string(),
})
export const usageValue = v.object({
  object: v.literal("usage"),
  emails: v.object({ daily: period, monthly: period }),
  contacts: quota,
  segments: quota,
  broadcasts: quota,
  ai_credits: quota.extend({ next_increase_at: v.null() }),
  automation_runs: quota.extend({ resets_at: v.string() }),
  domains: quota,
  rate_limit: v.object({ limit: v.number(), duration: v.string() }),
})
const quotaSource = v.object({
  region: v.union(v.string(), v.null()),
  checkedAt: v.union(v.number(), v.null()),
  reason: v.union(v.string(), v.null()),
})

/** Fixed aggregate reads regardless of the team's email or audience volume. */
export async function readUsage(ctx: QueryCtx, organizationId: string) {
  const now = new Date(Date.now())
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = Date.UTC(year, month, now.getUTCDate())
  const nextDay = day + 86_400_000
  const nextMonth = Date.UTC(year, month + 1, 1)
  const ranges = [
    { from: day, to: nextDay - 1 },
    { from: Date.UTC(year, month, 1), to: nextMonth - 1 },
  ]
  const installation = await findInstallation(ctx)
  // Team provisioning uses the installation's default region; there is no team override.
  const region = installation?.defaultRegion ?? null
  const stored = region ? await findRegion(ctx, region) : null
  const dailyLimit = stored?.quota.daily
  const available =
    dailyLimit !== undefined && Number.isFinite(dailyLimit) && dailyLimit >= 0
  const [periods, contacts, segments, broadcasts, domains, runs] =
    await Promise.all([
      Promise.all(
        ranges.map(async (range) => {
          const [sent, received] = await Promise.all([
            counters.usageSent.total(ctx, organizationId, [], range),
            counters.usageReceived.total(ctx, organizationId, [], range),
          ])
          return { used: sent! + received!, sent: sent!, received: received! }
        })
      ),
      counters.contacts.total(ctx, organizationId),
      counters.segments.total(ctx, organizationId),
      counters.broadcasts.total(ctx, organizationId, [
        { is: "sent", among: ["sent"] },
      ]),
      counters.domains.total(ctx, organizationId),
      counters.usageAutomationRuns.total(ctx, organizationId, [], ranges[1]),
    ])
  const monthlyReset = new Date(nextMonth).toISOString()
  const usage: Infer<typeof usageValue> = {
    object: "usage",
    emails: {
      daily: {
        ...periods[0],
        limit: available ? Math.floor(dailyLimit) : null,
        resets_at: new Date(nextDay).toISOString(),
      },
      monthly: { ...periods[1], limit: null, resets_at: monthlyReset },
    },
    contacts: { used: contacts!, limit: null },
    segments: { used: segments!, limit: LIMITS.segments },
    broadcasts: { used: broadcasts!, limit: null },
    ai_credits: { used: 0, limit: 0, next_increase_at: null },
    automation_runs: { used: runs!, limit: null, resets_at: monthlyReset },
    domains: { used: domains!, limit: null },
    rate_limit: { limit: API_RATE, duration: "1000ms" },
  }
  return {
    usage,
    quota: {
      region,
      checkedAt: stored?.checkedAt ?? null,
      reason: available
        ? null
        : region
          ? `No Amazon SES quota has been recorded for ${region}. An installation admin can refresh it in Amazon SES settings.`
          : "No default Amazon SES region is configured. Ask an installation admin to finish Amazon SES setup.",
    },
  }
}

export const get = query({
  // The browser changes this at UTC midnight to refresh a quiet subscription.
  args: { organizationId: v.string(), day: v.optional(v.number()) },
  returns: v.object({ usage: usageValue, quota: quotaSource }),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "read")
    return readUsage(ctx, organizationId)
  },
})
