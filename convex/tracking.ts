import { v } from "convex/values"
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter"
import {
  env,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server"
import { components } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import { findInstallation } from "./access"
import { retirement } from "./teamLifecycle"
import { trackingHost } from "./ses/records"
import { trackingTarget } from "./ses/contracts"
import { projectEngagement } from "./ses/projection"
import { readToken } from "../lib/tokens/signed"
import { httpLink, trackingHtml, TRACKING_CONTEXT } from "../lib/tracking/html"

const limiter = new RateLimiter(components.rateLimiter, {
  trackingHit: {
    kind: "token bucket",
    rate: 120,
    period: MINUTE,
    capacity: 120,
  },
})

export function trackingOrigin(domain: Doc<"domains">, callbackOrigin: string) {
  const target = trackingTarget(callbackOrigin, env.SITE_URL)
  const host = trackingHost(domain)
  return host &&
    domain.records.some(
      (r) =>
        r.kind === "Tracking" &&
        r.name === host &&
        r.value === target &&
        r.status === "verified"
    )
    ? `https://${host}`
    : new URL(callbackOrigin).origin
}

export async function prepareTracking(
  ctx: MutationCtx,
  email: Doc<"emails">,
  domain: Doc<"domains">,
  content: Doc<"emailContents"> | null
) {
  if (
    !content?.html ||
    email.source === "system" ||
    !(domain.openTracking || domain.clickTracking)
  )
    return content?.html
  const installation = await findInstallation(ctx)
  if (!installation) throw new Error("The installation is unavailable")
  const existing = await ctx.db
    .query("emailTracking")
    .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
    .unique()
  const origin =
    existing?.origin ?? trackingOrigin(domain, installation.callbackOrigin)
  const open = existing?.open ?? !!domain.openTracking
  const click = existing?.click ?? !!domain.clickTracking
  const result = await trackingHtml({
    html: content.html,
    emailId: email._id,
    origin,
    open,
    click,
    secret: env.BETTER_AUTH_SECRET,
    unsubscribeUrls: (content.headers ?? [])
      .filter((h) => h.name.toLowerCase() === "list-unsubscribe")
      .flatMap((h) => [...h.value.matchAll(/<([^>]+)>/g)].map((m) => m[1])),
  })
  if (!existing)
    await ctx.db.insert("emailTracking", {
      emailId: email._id,
      origin,
      open,
      click,
      links: result.links,
    })
  return result.html
}

export const hit = internalMutation({
  args: {
    token: v.string(),
    kind: v.union(v.literal("o"), v.literal("c")),
    userAgent: v.string(),
    ipAddress: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({ location: v.union(v.string(), v.null()), limited: v.boolean() })
  ),
  handler: async (ctx, args) => {
    const payload = await readToken(
      args.token,
      TRACKING_CONTEXT,
      env.BETTER_AUTH_SECRET
    )
    if (!payload) return null
    const [rawId, rawIndex, ...rest] = payload.split(".")
    if (rest.length || !/^(?:-1|0|[1-9]\d*)$/.test(rawIndex ?? "")) return null
    const id = ctx.db.normalizeId("emails", rawId)
    const index = Number(rawIndex)
    if (
      !id ||
      !Number.isSafeInteger(index) ||
      (args.kind === "o" ? index !== -1 : index < 0)
    )
      return null
    const email = await ctx.db.get("emails", id)
    if (
      !email ||
      (await retirement(ctx, email.organizationId)) ||
      email.source === "system" ||
      ["scheduled", "canceled", "suppressed"].includes(email.status) ||
      (email.sentAt === undefined && !email.attempts)
    )
      return null
    const row = await ctx.db
      .query("emailTracking")
      .withIndex("by_emailId", (q) => q.eq("emailId", id))
      .unique()
    if (!row || (args.kind === "o" ? !row.open : !row.click)) return null
    const location = args.kind === "c" ? httpLink(row.links[index] ?? "") : null
    if (args.kind === "c" && !location) return null
    const limit = await limiter.limit(ctx, "trackingHit", { key: id })
    if (!limit.ok) return { location, limited: true }
    await projectEngagement(
      ctx,
      email,
      args.kind === "o" ? "opened" : "clicked",
      {
        link: location ?? "",
        userAgent: args.userAgent.slice(0, 1024),
        ipAddress: args.ipAddress.slice(0, 128),
      }
    )
    return { location, limited: false }
  },
})

/** Caddy's on-demand TLS allowlist. Never permits arbitrary hostnames. */
export const allowedHost = internalQuery({
  args: { hostname: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { hostname }) => {
    if (
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(hostname) ||
      hostname.length > 253
    )
      return false
    const installation = await findInstallation(ctx)
    if (!installation) return false
    const domains = await ctx.db
      .query("domains")
      .withIndex("by_name_and_deleted_and_claimPending", (q) =>
        q
          .eq("name", hostname.slice(hostname.indexOf(".") + 1))
          .eq("deleted", false)
          .eq("claimPending", undefined)
      )
      .take(20)
    return domains.some(
      (domain) =>
        !domain.deleted &&
        trackingHost(domain) === hostname &&
        trackingOrigin(domain, installation.callbackOrigin) ===
          `https://${hostname}`
    )
  },
})
