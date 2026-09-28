import { v } from "convex/values"
import { env, mutation, query, type QueryCtx } from "./_generated/server"
import { requireTeam } from "./access"
import { apiError, type Caller } from "./api/caller"
import { smtpPort } from "./tables/smtp"

export const smtpSettings = (ctx: QueryCtx, organizationId: string) =>
  ctx.db
    .query("smtpSettings")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .unique()

export async function requireSmtp(ctx: QueryCtx, caller: Caller) {
  if (!caller.apiKeyId)
    throw apiError(403, "invalid_api_key", "SMTP requires an API key")
  if (!(await smtpSettings(ctx, caller.organizationId))?.enabled)
    throw apiError(403, "smtp_disabled", "SMTP is disabled for this team")
}

export const settings = query({
  args: { organizationId: v.string() },
  returns: v.object({ enabled: v.boolean(), host: v.string(), port: smtpPort }),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "read")
    const row = await smtpSettings(ctx, organizationId)
    return {
      enabled: row?.enabled ?? false,
      port: row?.port ?? 465,
      host: env.SMTP_HOST ?? "",
    }
  },
})

export const update = mutation({
  args: {
    organizationId: v.string(),
    enabled: v.optional(v.boolean()),
    port: v.optional(smtpPort),
  },
  returns: v.null(),
  handler: async (ctx, { organizationId, enabled, port }) => {
    await requireTeam(ctx, organizationId, "write")
    const row = await smtpSettings(ctx, organizationId)
    const patch = {
      ...(enabled === undefined ? {} : { enabled }),
      ...(port === undefined ? {} : { port }),
    }
    if (row) await ctx.db.patch("smtpSettings", row._id, patch)
    else
      await ctx.db.insert("smtpSettings", {
        organizationId,
        enabled: false,
        port: 465,
        ...patch,
      })
    return null
  },
})
