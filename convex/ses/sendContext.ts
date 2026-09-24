import { v, ConvexError } from "convex/values"
import { internalQuery } from "../_generated/server"
import { findRegion } from "../access"
import {
  provisioned,
  regionValue,
  tenantMatches,
  tenantProvisioned,
} from "./contracts"

/** Shared send contract: callers authorize the team, then use this immutable resource binding. */
export const get = internalQuery({
  args: { organizationId: v.string(), domainId: v.id("domains") },
  returns: v.object({
    TenantName: v.string(),
    ConfigurationSetName: v.string(),
    region: regionValue,
    domain: v.string(),
  }),
  handler: async (ctx, args) => {
    const domain = await ctx.db.get("domains", args.domainId)
    if (
      !domain ||
      domain.deleted ||
      domain.organizationId !== args.organizationId
    )
      throw new ConvexError("Domain does not belong to this team")
    const tenant = domain.tenantId
      ? await ctx.db.get("sesTenants", domain.tenantId)
      : null
    if (
      !tenant ||
      !tenantProvisioned(tenant) ||
      !tenantMatches(tenant, domain) ||
      !["ENABLED", "REINSTATED"].includes(tenant.sendingStatus ?? "")
    )
      throw new ConvexError("Team SES tenant is not ready to send")
    if (
      !domain.tenantAssociated ||
      !domain.configurationSet ||
      !domain.sending ||
      !provisioned(domain) ||
      domain.status !== "verified"
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
  },
})
