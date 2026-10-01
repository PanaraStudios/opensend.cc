import { v, ConvexError } from "convex/values"
import { internalQuery, type QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { requireEmailConfigured, findRegion } from "../access"
import { verifiesDomain } from "./records"
import {
  POLICY_REVISION,
  provisioned,
  regionValue,
  tenantMatches,
  tenantProvisioned,
} from "./contracts"

export const sendBindingValue = v.object({
  TenantName: v.string(),
  ConfigurationSetName: v.string(),
  region: regionValue,
  domain: v.string(),
})

/** Shared send contract: callers authorize the team, then use this immutable resource binding. */
export async function sendContext(
  ctx: QueryCtx,
  args: { organizationId: string; domainId: Id<"domains"> },
  loadedDomain?: Doc<"domains">
) {
  // No recorded revision is the setup-only policy, which cannot send.
  if (
    ((await requireEmailConfigured(ctx)).policyRevision ?? 1) < POLICY_REVISION
  )
    throw new ConvexError("Ask your administrator to update AWS permissions")
  const domain = loadedDomain ?? (await ctx.db.get("domains", args.domainId))
  if (
    !domain ||
    domain.deleted ||
    domain.organizationId !== args.organizationId
  )
    throw new ConvexError("Domain does not belong to this team")
  const tenant = domain.tenantId
    ? await ctx.db.get("sesTenants", domain.tenantId)
    : null
  if (!tenant || !tenantProvisioned(tenant) || !tenantMatches(tenant, domain))
    throw new ConvexError("Team SES tenant is not ready to send")
  if (
    tenant.statusOperation ||
    !["ENABLED", "REINSTATED"].includes(tenant.sendingStatus ?? "")
  )
    throw new ConvexError(
      "Sending is paused for this team. Ask your installation administrator to resume sending."
    )
  if (
    !domain.tenantAssociated ||
    !domain.configurationSet ||
    !domain.sending ||
    !provisioned(domain) ||
    (domain.status !== "verified" &&
      !(
        domain.status === "partially_verified" &&
        domain.sesVerified &&
        domain.dkimVerified &&
        domain.mailFromVerified &&
        domain.records.every(
          (r) => !verifiesDomain(r) || r.status !== "pending"
        )
      ))
  )
    throw new ConvexError("Domain is not ready to send")
  const region = await findRegion(ctx, domain.region)
  if (
    !region ||
    region.phase !== "ready" ||
    !region.callbackConfirmed ||
    !region.quota.sendingEnabled ||
    !region.quota.production
  )
    throw new ConvexError("AWS region is not ready for production sending")
  return {
    TenantName: tenant.name,
    ConfigurationSetName: domain.configurationSet,
    region: domain.region,
    domain: domain.name,
  }
}

export const get = internalQuery({
  args: { organizationId: v.string(), domainId: v.id("domains") },
  returns: sendBindingValue,
  handler: (ctx, args) => sendContext(ctx, args),
})
