import { v, ConvexError } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server"
import { requireTeam, requireInstallationAdmin } from "./access"
import { adoptionValue, dnsProviderValue } from "./ses/contracts"
import { completeInstallation, findInstallation } from "./installation"
import { internal } from "./_generated/api"
import schema from "./schema"
import { domainStatusValue, regionValue, tlsValue } from "./ses/contracts"
import { validateDomainName, validateDnsLabel } from "../lib/dashboard/domains"
import { workflow } from "./ses/workflows"
import type { MutationCtx } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"

export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    status: v.optional(domainStatusValue),
    region: v.optional(regionValue),
  },
  returns: paginationResultValidator(schema.doc("domains")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const prefix = (args.search ?? "").trim().toLowerCase().slice(0, 253)
    const rows =
      args.status && args.region
        ? ctx.db
            .query("domains")
            .withIndex(
              "by_organizationId_and_deleted_and_status_and_region_and_name",
              (q) =>
                q
                  .eq("organizationId", args.organizationId)
                  .eq("deleted", false)
                  .eq("status", args.status!)
                  .eq("region", args.region!)
                  .gte("name", prefix)
                  .lt("name", prefix + "\uffff")
            )
        : args.status
          ? ctx.db
              .query("domains")
              .withIndex(
                "by_organizationId_and_deleted_and_status_and_name",
                (q) =>
                  q
                    .eq("organizationId", args.organizationId)
                    .eq("deleted", false)
                    .eq("status", args.status!)
                    .gte("name", prefix)
                    .lt("name", prefix + "\uffff")
              )
          : args.region
            ? ctx.db
                .query("domains")
                .withIndex(
                  "by_organizationId_and_deleted_and_region_and_name",
                  (q) =>
                    q
                      .eq("organizationId", args.organizationId)
                      .eq("deleted", false)
                      .eq("region", args.region!)
                      .gte("name", prefix)
                      .lt("name", prefix + "\uffff")
                )
            : ctx.db
                .query("domains")
                .withIndex("by_organizationId_and_deleted_and_name", (q) =>
                  q
                    .eq("organizationId", args.organizationId)
                    .eq("deleted", false)
                    .gte("name", prefix)
                    .lt("name", prefix + "\uffff")
                )
    return rows.paginate(args.paginationOpts)
  },
})
export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      domain: schema.doc("domains"),
      region: v.union(v.null(), schema.doc("sesRegions")),
      history: v.array(schema.doc("domainHistory")),
      tenant: v.union(v.null(), schema.doc("sesTenants")),
    })
  ),
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("domains", id)
    const domain = normalized ? await ctx.db.get(normalized) : null
    if (!domain) return null
    await requireTeam(ctx, domain.organizationId)
    if (domain.deleted) return null
    const region = await ctx.db
      .query("sesRegions")
      .withIndex("by_region", (q) => q.eq("region", domain.region))
      .unique()
    const history = await ctx.db
      .query("domainHistory")
      .withIndex("by_domainId", (q) => q.eq("domainId", domain._id))
      .order("desc")
      .take(50)
    const tenant = domain.tenantId ? await ctx.db.get(domain.tenantId) : null
    return {
      domain,
      region,
      history,
      tenant:
        tenant?.organizationId === domain.organizationId &&
        tenant.region === domain.region
          ? tenant
          : null,
    }
  },
})
async function start(
  ctx: MutationCtx,
  domain: Doc<"domains">,
  operation: Doc<"domains">["operation"]
) {
  if (domain.phase === "running")
    throw new ConvexError("A domain operation is already running")
  await ctx.db.patch(domain._id, {
    phase: "running",
    operation,
    error: undefined,
    ...(operation === "remove" ? { sending: false } : {}),
  })
  await ctx.db.insert("domainHistory", {
    domainId: domain._id,
    message: `${operation} requested`,
  })
  await workflow.start(ctx, internal.ses.workflows.domainOperationWithTenant, {
    domainId: domain._id,
  })
}
export const create = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    region: regionValue,
    customReturnPath: v.string(),
  },
  returns: v.id("domains"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, true)
    const name = args.name.trim().toLowerCase()
    const customReturnPath = args.customReturnPath.trim().toLowerCase()
    const error =
      validateDomainName(name, []) || validateDnsLabel(customReturnPath)
    if (error || `${customReturnPath}.${name}`.length > 253)
      throw new ConvexError(error ?? "Return-Path is too long")
    const region = await ctx.db
      .query("sesRegions")
      .withIndex("by_region", (q) => q.eq("region", args.region))
      .unique()
    if (!region || region.phase !== "ready")
      throw new ConvexError(
        "Provision this AWS region in installation settings first"
      )
    const existing = await ctx.db
      .query("domains")
      .withIndex("by_name_and_region_and_deleted", (q) =>
        q.eq("name", name).eq("region", args.region).eq("deleted", false)
      )
      .unique()
    if (existing) {
      throw new ConvexError("That domain is already reserved in this region")
    }
    const id = await ctx.db.insert("domains", {
      ...args,
      name,
      customReturnPath,
      status: "pending",
      phase: "pending",
      deleted: false,
      sending: true,
      tls: "opportunistic",
      records: [],
      sesVerified: false,
      dkimVerified: false,
      mailFromVerified: false,
      operation: "provision",
    })
    await start(ctx, (await ctx.db.get(id))!, "provision")
    const installation = await findInstallation(ctx)
    if (installation && !installation.completedAt)
      await completeInstallation(ctx, args.organizationId)
    return id
  },
})
export const refresh = mutation({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const domain = await ctx.db.get(id)
    if (!domain || domain.deleted) throw new ConvexError("Domain not found")
    await requireTeam(ctx, domain.organizationId, true)
    await start(
      ctx,
      domain,
      domain.phase === "failed" ? domain.operation : "refresh"
    )
    return null
  },
})
export const update = mutation({
  args: {
    id: v.id("domains"),
    sending: v.optional(v.boolean()),
    tls: v.optional(tlsValue),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await ctx.db.get(args.id)
    if (!domain || domain.deleted) throw new ConvexError("Domain not found")
    await requireTeam(ctx, domain.organizationId, true)
    if (domain.phase !== "ready")
      throw new ConvexError("Finish provisioning this domain first")
    await ctx.db.patch(domain._id, {
      ...(args.sending !== undefined ? { sending: args.sending } : {}),
      ...(args.tls && args.tls !== domain.tls ? { pendingTls: args.tls } : {}),
    })
    if (args.tls && args.tls !== domain.tls)
      await start(ctx, domain, "settings")
    await ctx.db.insert("domainHistory", {
      domainId: domain._id,
      message: "Settings updated",
    })
    return null
  },
})
export const remove = mutation({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const domain = await ctx.db.get(id)
    if (!domain || domain.deleted) throw new ConvexError("Domain not found")
    await requireTeam(ctx, domain.organizationId, true)
    await start(ctx, domain, "remove")
    return null
  },
})
export const workerContext = internalQuery({
  args: { id: v.id("domains") },
  returns: v.object({
    domain: schema.doc("domains"),
    region: schema.doc("sesRegions"),
    tenant: v.union(v.null(), schema.doc("sesTenants")),
  }),
  handler: async (ctx, { id }) => {
    const domain = await ctx.db.get(id)
    if (!domain || domain.deleted) throw new ConvexError("Domain not found")
    const region = await ctx.db
      .query("sesRegions")
      .withIndex("by_region", (q) => q.eq("region", domain.region))
      .unique()
    if (!region?.topicArn || region.phase !== "ready")
      throw new ConvexError("Region is not ready")
    const tenant = domain.tenantId ? await ctx.db.get(domain.tenantId) : null
    if (
      tenant &&
      (tenant.organizationId !== domain.organizationId ||
        tenant.region !== domain.region)
    )
      throw new ConvexError("Domain tenant ownership does not match")
    return { domain, region, tenant }
  },
})
export const finish = internalMutation({
  args: {
    id: v.id("domains"),
    changes: schema
      .doc("domains")
      .pick(
        "records",
        "configurationSet",
        "sesVerified",
        "dkimVerified",
        "mailFromVerified",
        "status",
        "deleted",
        "tenantAssociated",
        "tls"
      )
      .partial(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await ctx.db.get(args.id)
    if (!domain) throw new ConvexError("Domain not found")
    const now = Date.now()
    await ctx.db.patch(args.id, {
      ...args.changes,
      ...(!domain.dnsVerifiedAt &&
      args.changes.records?.length &&
      args.changes.records.every((record) => record.status === "verified")
        ? { dnsVerifiedAt: now }
        : {}),
      ...(!domain.partiallyVerifiedAt &&
      args.changes.status === "partially_verified"
        ? { partiallyVerifiedAt: now }
        : {}),
      ...(!domain.verifiedAt && args.changes.status === "verified"
        ? { verifiedAt: now }
        : {}),
      ...(args.error && domain.operation !== "settings"
        ? { status: "failed" as const }
        : {}),
      ...(domain.operation === "settings" && !args.error && args.changes.tls
        ? { pendingTls: undefined }
        : {}),
      phase: args.error ? "failed" : "ready",
      error: args.error,
      checkedAt: Date.now(),
    })
    await ctx.db.insert("domainHistory", {
      domainId: args.id,
      message:
        args.error ??
        (args.changes.deleted
          ? "Domain removed; sending disabled"
          : domain.operation === "settings"
            ? "TLS policy updated"
            : "AWS and DNS state refreshed"),
    })
    return null
  },
})

export const previewContext = internalQuery({
  args: { id: v.id("domains") },
  returns: schema.doc("domains"),
  handler: async (ctx, { id }) => {
    await requireInstallationAdmin(ctx)
    const domain = await ctx.db.get(id)
    if (
      !domain ||
      domain.deleted ||
      domain.phase !== "failed" ||
      domain.operation !== "provision"
    )
      throw new ConvexError(
        "Review a failed domain provisioning operation first"
      )
    await requireTeam(ctx, domain.organizationId, true)
    return domain
  },
})
export const savePreview = internalMutation({
  args: { id: v.id("domains"), adoption: adoptionValue },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const domain = await ctx.db.get(args.id)
    if (!domain || domain.phase !== "failed" || domain.deleted)
      throw new ConvexError("Domain changed. Review it again.")
    await requireTeam(ctx, domain.organizationId, true)
    await ctx.db.patch(domain._id, { adoption: args.adoption })
    return null
  },
})
export const approveAdoption = mutation({
  args: { id: v.id("domains"), fingerprint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const domain = await ctx.db.get(args.id)
    if (
      !domain ||
      domain.deleted ||
      domain.phase !== "failed" ||
      !domain.adoption ||
      domain.adoption.fingerprint !== args.fingerprint
    )
      throw new ConvexError(
        "Review the current AWS identity before approving changes"
      )
    await requireTeam(ctx, domain.organizationId, true)
    await ctx.db.patch(domain._id, {
      adoption: { ...domain.adoption, approved: true },
    })
    await start(ctx, domain, "provision")
    return null
  },
})

/** Authorize and reserve the lookup atomically to avoid repeated DNS requests. */
export const claimDnsProviderLookup = internalMutation({
  args: { id: v.id("domains") },
  returns: v.union(
    v.null(),
    v.object({ name: v.string(), requestedAt: v.number() })
  ),
  handler: async (ctx, { id }) => {
    const domain = await ctx.db.get(id)
    if (!domain || domain.deleted) throw new ConvexError("Domain not found")
    await requireTeam(ctx, domain.organizationId)
    const now = Date.now()
    if (
      (domain.dnsProviderCheckedAt &&
        now - domain.dnsProviderCheckedAt < 3600000) ||
      (domain.dnsProviderRequestedAt &&
        now - domain.dnsProviderRequestedAt < 60000)
    )
      return null
    await ctx.db.patch(id, { dnsProviderRequestedAt: now })
    return { name: domain.name, requestedAt: now }
  },
})
export const saveDnsProvider = internalMutation({
  args: {
    id: v.id("domains"),
    requestedAt: v.number(),
    provider: v.optional(dnsProviderValue),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await ctx.db.get(args.id)
    if (!domain || domain.deleted) return null
    await requireTeam(ctx, domain.organizationId)
    if (domain.dnsProviderRequestedAt !== args.requestedAt) return null
    await ctx.db.patch(args.id, {
      dnsProvider: args.provider,
      dnsProviderCheckedAt: Date.now(),
    })
    return null
  },
})
