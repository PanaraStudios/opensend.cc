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
    throw new ConvexError(
      `The team sending setup for ${domain.name} is incomplete. Ask your instance administrator to finish SES tenant setup in Amazon SES settings.`
    )
  if (
    tenant.statusOperation ||
    !["ENABLED", "REINSTATED"].includes(tenant.sendingStatus ?? "")
  )
    throw new ConvexError(
      `Sending is paused for the team that owns ${domain.name}. Ask your instance administrator to resume sending in Amazon SES settings.`
    )
  if (!domain.sending)
    throw new ConvexError(
      `Sending is turned off for ${domain.name}. Turn on Enable Sending in Channels › ${domain.name}.`
    )
  if (
    domain.status !== "verified" &&
    !(
      domain.status === "partially_verified" &&
      domain.sesVerified &&
      domain.dkimVerified &&
      domain.mailFromVerified &&
      domain.records.every((r) => !verifiesDomain(r) || r.status !== "pending")
    )
  )
    throw new ConvexError(
      `${domain.name} is not verified for sending. Complete the DNS verification in Channels › ${domain.name}.`
    )
  if (
    !domain.tenantAssociated ||
    !domain.configurationSet ||
    !provisioned(domain)
  )
    throw new ConvexError(
      `The sending setup for ${domain.name} is incomplete. Ask your instance administrator to finish domain provisioning in Channels › ${domain.name}.`
    )
  const region = await findRegion(ctx, domain.region)
  if (!region || region.phase !== "ready")
    throw new ConvexError(
      `The AWS region for ${domain.name} is not ready for sending. Ask your instance administrator to finish region setup in Amazon SES settings.`
    )
  if (!region.callbackConfirmed)
    throw new ConvexError(
      `Delivery updates are not connected in the AWS region for ${domain.name}. Ask your instance administrator to confirm the callback connection in Amazon SES settings.`
    )
  if (!region.quota.sendingEnabled)
    throw new ConvexError(
      `Amazon SES has paused sending in the AWS region for ${domain.name}. Ask your instance administrator to review SES account health and enable regional sending in Amazon SES settings.`
    )
  if (!region.quota.production)
    throw new ConvexError(
      `Amazon SES is in sandbox mode in the AWS region for ${domain.name}. Ask your instance administrator to request production access in Amazon SES settings.`
    )
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
