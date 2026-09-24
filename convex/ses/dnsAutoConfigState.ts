import { v, ConvexError } from "convex/values"
import { internalMutation } from "../_generated/server"
import {
  requireConnection,
  requireTeam,
  requireInstallationAdmin,
} from "../access"
import { findActiveDomain, logHistory, start } from "../domains"
import schema from "../schema"
import type { MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"

const CLAIM_MS = 120000
/** Route 53 writes are signed with the installation-wide AWS credentials and
    can reach any hosted zone in that account, so a team admin is not enough. */
const ROUTE53_ADMIN =
  "Only an installation admin can write to Route 53 with the connected AWS account."
async function authorize(ctx: MutationCtx, domain: Doc<"domains">) {
  await requireTeam(ctx, domain.organizationId, true)
  if (domain.dnsProvider === "route53")
    await requireInstallationAdmin(ctx, ROUTE53_ADMIN)
}

/** Authorize the write, reserve it, and load everything the action needs. */
export const claim = internalMutation({
  args: { id: v.id("domains") },
  returns: v.object({
    domain: schema.doc("domains"),
    installation: schema.doc("installation"),
    provider: v.union(v.literal("cloudflare"), v.literal("route53")),
  }),
  handler: async (ctx, { id }) => {
    const domain = await findActiveDomain(ctx, id)
    await authorize(ctx, domain)
    const provider = domain.dnsProvider
    if (provider !== "cloudflare" && provider !== "route53")
      throw new ConvexError(
        "Automatic DNS setup isn't available for this provider"
      )
    if (domain.phase === "running")
      throw new ConvexError("A domain operation is already running")
    if (domain.operation === "remove")
      throw new ConvexError("This domain is being removed")
    if (!domain.records.length)
      throw new ConvexError(
        "This domain has no DNS records yet. Refresh it and try again."
      )
    const now = Date.now()
    if (domain.dnsWriteClaimedAt && now - domain.dnsWriteClaimedAt < CLAIM_MS)
      throw new ConvexError(
        "Automatic DNS setup is already running for this domain"
      )
    const installation = await requireConnection(ctx)
    await ctx.db.patch("domains", id, { dnsWriteClaimedAt: now })
    return { domain, installation, provider }
  },
})

export const finish = internalMutation({
  args: {
    id: v.id("domains"),
    provider: v.union(v.literal("cloudflare"), v.literal("route53")),
    created: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await findActiveDomain(ctx, args.id)
    await authorize(ctx, domain)
    await ctx.db.patch("domains", args.id, { dnsWriteClaimedAt: undefined })
    if (!args.created) return null
    const label = args.provider === "cloudflare" ? "Cloudflare" : "Route 53"
    await logHistory(
      ctx,
      args.id,
      `${args.created} DNS records written to ${label}`
    )
    /* A refresh queued while another operation runs would be rejected; the
       running operation rechecks DNS on its own. Only a failed provision is
       retried as itself, so it stays reviewable; anything else rechecks DNS
       with a refresh, which also settles a pending TLS change. A removal
       started meanwhile is never re-run from here. */
    if (domain.phase !== "running" && domain.operation !== "remove")
      await start(
        ctx,
        domain,
        domain.phase === "failed" && domain.operation === "provision"
          ? "provision"
          : "refresh"
      )
    return null
  },
})
