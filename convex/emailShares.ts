import { v, type Infer } from "convex/values"
import { components, internal } from "./_generated/api"
import {
  env,
  mutation,
  action,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireTeam } from "./access"
import { notFound, invalid } from "./api/caller"
import { retirement } from "./teamLifecycle"
import { randomToken, tokenHash } from "../lib/oauth/policy"
import { sharedEmailId } from "./tables/emailShares"

export const MAX_SHARE_AGE = 48 * 60 * 60 * 1000

/** Duration units accepted by Resend's examples, including their long forms. */
export function shareDuration(value: unknown = "48h") {
  const match =
    typeof value === "string" && value.length <= 100
      ? /^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)$/i.exec(
          value.trim()
        )
      : null
  if (!match)
    throw invalid(
      "The `expires_in` field must be a valid duration, such as `10m`, `2 hours`, or `1 day`."
    )
  const unit = match[2].toLowerCase()
  const factor =
    unit === "ms" || unit.startsWith("milli")
      ? 1
      : unit.startsWith("s")
        ? 1000
        : unit.startsWith("m")
          ? 60_000
          : unit.startsWith("h")
            ? 3_600_000
            : 86_400_000
  const duration = Number(match[1]) * factor
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_SHARE_AGE)
    throw invalid(
      "The `expires_in` field must be greater than zero and cannot exceed 48 hours."
    )
  return Math.floor(duration)
}

export const shareUrl = (token: string) =>
  `${env.SITE_URL.replace(/\/$/, "")}/shared?token=${token}`

export async function findShareEmail(ctx: QueryCtx, id: string) {
  const sentId = ctx.db.normalizeId("emails", id)
  if (sentId) return ctx.db.get("emails", sentId)
  const receivedId = ctx.db.normalizeId("receivedEmails", id)
  return receivedId ? ctx.db.get("receivedEmails", receivedId) : null
}

async function activeOrganization(ctx: QueryCtx, organizationId: string) {
  if (await retirement(ctx, organizationId)) return false
  return !!(await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "organization",
    where: [{ field: "_id", value: organizationId }],
  }))
}

export async function createShare(
  ctx: MutationCtx,
  organizationId: string,
  id: string,
  duration: number,
  token = randomToken()
) {
  const email = await findShareEmail(ctx, id)
  if (
    !email ||
    email.organizationId !== organizationId ||
    (email.expiresAt !== undefined && email.expiresAt <= Date.now()) ||
    !(await activeOrganization(ctx, organizationId))
  )
    throw notFound("Email")
  const expiresAt = Date.now() + duration
  await ctx.db.insert("emailShares", {
    organizationId,
    emailId: email._id,
    tokenHash: await tokenHash(token),
    expiresAt,
  })
  return {
    object: "email" as const,
    id: email._id,
    url: shareUrl(token),
    expiresAt,
  }
}

export const create = mutation({
  args: {
    organizationId: v.string(),
    id: sharedEmailId,
    expiresIn: v.optional(v.string()),
  },
  returns: v.object({
    object: v.literal("email"),
    id: sharedEmailId,
    url: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, { organizationId, id, expiresIn }) => {
    await requireTeam(ctx, organizationId, "write")
    return createShare(ctx, organizationId, id, shareDuration(expiresIn))
  },
})

const attachment = v.object({
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
})
export const sharedEmail = v.object({
  subject: v.string(),
  from: v.string(),
  to: v.array(v.string()),
  cc: v.array(v.string()),
  replyTo: v.array(v.string()),
  date: v.number(),
  expiresAt: v.number(),
  html: v.string(),
  text: v.string(),
  attachments: v.array(attachment),
})

/** Explicit projection: no Bcc, storage URLs, raw headers, or operational data. */
export const read = internalQuery({
  args: { token: v.string(), now: v.number() },
  returns: v.union(v.null(), sharedEmail),
  handler: async (ctx, { token, now }) => {
    if (!/^[a-f0-9]{64}$/.test(token)) return null
    const hash = await tokenHash(token)
    const share = await ctx.db
      .query("emailShares")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hash))
      .unique()
    if (!share || share.expiresAt <= now) return null
    const email = await findShareEmail(ctx, share.emailId)
    if (
      !email ||
      email.organizationId !== share.organizationId ||
      (email.expiresAt !== undefined && email.expiresAt <= now) ||
      !(await activeOrganization(ctx, share.organizationId))
    )
      return null
    const receivedId = ctx.db.normalizeId("receivedEmails", email._id)
    const content = receivedId
      ? await ctx.db
          .query("receivedContents")
          .withIndex("by_emailId", (q) => q.eq("emailId", receivedId))
          .unique()
      : await ctx.db
          .query("emailContents")
          .withIndex("by_emailId", (q) =>
            q.eq("emailId", ctx.db.normalizeId("emails", email._id)!)
          )
          .unique()
    if (!content) return null
    const attachments = receivedId
      ? await ctx.db
          .query("receivedAttachments")
          .withIndex("by_emailId", (q) => q.eq("emailId", receivedId))
          .take(100)
      : "attachments" in content
        ? (content.attachments ?? [])
        : []
    return {
      subject: email.subject,
      from: email.from,
      to: email.to,
      cc: email.cc ?? [],
      replyTo: email.replyTo ?? [],
      date:
        "receivedAt" in email
          ? email.receivedAt
          : (email.sentAt ?? email._creationTime),
      expiresAt: Math.min(share.expiresAt, email.expiresAt ?? Infinity),
      html: content.html ?? "",
      text: content.text ?? "",
      attachments: attachments.map(({ filename, contentType, size }) => ({
        filename: filename ?? "attachment",
        contentType,
        size,
      })),
    }
  },
})

// A public query could stay cached as the clock passes its expiry. The action
// supplies trusted wall time on every request; clients cannot choose the clock.
export const view = action({
  args: { token: v.string() },
  returns: v.union(v.null(), sharedEmail),
  handler: async (ctx, { token }): Promise<Infer<typeof sharedEmail> | null> =>
    ctx.runQuery(internal.emailShares.read, { token, now: Date.now() }),
})
