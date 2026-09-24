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
import {
  findInstallation,
  findRegion,
  requireTeam,
  requireInstallationAdmin,
} from "./access"
import {
  adoptionValue,
  dnsProviderValue,
  domainStatusValue,
  provisioned,
  regionValue,
  tenantMatches,
  tlsValue,
} from "./ses/contracts"
import { completeInstallation } from "./installation"
import { internal } from "./_generated/api"
import schema from "./schema"
import {
  normalizeDomainName,
  validateDomainName,
  validateDnsLabel,
} from "../lib/dashboard/domains"
import { startWorkflow } from "./ses/workflows"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

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
    const domains = ctx.db.query("domains")
    /* Every index below is scoped the same way and ends on the name prefix;
       only the filters between the two differ. */
    const scope = <R>(q: {
      eq(
        field: "organizationId",
        value: string
      ): { eq(field: "deleted", value: boolean): R }
    }) => q.eq("organizationId", args.organizationId).eq("deleted", false)
    const named = <R>(q: {
      gte(field: "name", value: string): { lt(field: "name", value: string): R }
    }) => q.gte("name", prefix).lt("name", prefix + "\uffff")
    const rows =
      args.status && args.region
        ? domains.withIndex(
            "by_organizationId_and_deleted_and_status_and_region_and_name",
            (q) =>
              named(
                scope(q).eq("status", args.status!).eq("region", args.region!)
              )
          )
        : args.status
          ? domains.withIndex(
              "by_organizationId_and_deleted_and_status_and_name",
              (q) => named(scope(q).eq("status", args.status!))
            )
          : args.region
            ? domains.withIndex(
                "by_organizationId_and_deleted_and_region_and_name",
                (q) => named(scope(q).eq("region", args.region!))
              )
            : domains.withIndex("by_organizationId_and_deleted_and_name", (q) =>
                named(scope(q))
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
      tenant: v.union(
        v.null(),
        schema.doc("sesTenants").pick("_id", "phase", "error")
      ),
    })
  ),
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("domains", id)
    const domain = normalized ? await ctx.db.get("domains", normalized) : null
    if (!domain) return null
    await requireTeam(ctx, domain.organizationId)
    if (domain.deleted) return null
    const tenant = domain.tenantId
      ? await ctx.db.get("sesTenants", domain.tenantId)
      : null
    return {
      domain,
      tenant:
        tenant && tenantMatches(tenant, domain)
          ? { _id: tenant._id, phase: tenant.phase, error: tenant.error }
          : null,
    }
  },
})
/** Load a domain that has not been removed, or throw. */
export async function findActiveDomain(
  ctx: QueryCtx | MutationCtx,
  id: Id<"domains">
) {
  const domain = await ctx.db.get("domains", id)
  if (!domain || domain.deleted) throw new ConvexError("Domain not found")
  return domain
}
/** History is append-only per domain; keep only the newest entries. */
export async function logHistory(
  ctx: MutationCtx,
  domainId: Id<"domains">,
  message: string
) {
  await ctx.db.insert("domainHistory", { domainId, message })
  const rows = await ctx.db
    .query("domainHistory")
    .withIndex("by_domainId", (q) => q.eq("domainId", domainId))
    .order("desc")
    .take(200)
  for (const row of rows.slice(100))
    await ctx.db.delete("domainHistory", row._id)
}
/** A failed operation is retried, never replaced: a failed provision has to stay
    a provision so its adoption review remains reachable. */
export const retryOperation = (domain: Doc<"domains">) =>
  domain.phase === "failed" ? domain.operation : "refresh"
export async function start(
  ctx: MutationCtx,
  domain: Doc<"domains">,
  operation: Doc<"domains">["operation"]
) {
  if (domain.phase === "running")
    throw new ConvexError("A domain operation is already running")
  await ctx.db.patch("domains", domain._id, {
    phase: "running",
    operation,
    error: undefined,
    ...(operation === "remove" ? { sending: false } : {}),
  })
  await logHistory(ctx, domain._id, `${operation} requested`)
  await startWorkflow(ctx, internal.ses.workflows.domainOperationWithTenant, {
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
    const name = normalizeDomainName(args.name)
    const customReturnPath = args.customReturnPath.trim().toLowerCase()
    const error =
      validateDomainName(name, []) || validateDnsLabel(customReturnPath)
    if (error || `${customReturnPath}.${name}`.length > 253)
      throw new ConvexError(error ?? "Return-Path is too long")
    const region = await findRegion(ctx, args.region)
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
    await start(ctx, (await ctx.db.get("domains", id))!, "provision")
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
    const domain = await findActiveDomain(ctx, id)
    await requireTeam(ctx, domain.organizationId, true)
    await start(ctx, domain, retryOperation(domain))
    return null
  },
})
export const update = mutation({
  args: {
    id: v.id("domains"),
    sending: v.optional(v.boolean()),
    receiving: v.optional(v.boolean()),
    tls: v.optional(tlsValue),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await findActiveDomain(ctx, args.id)
    await requireTeam(ctx, domain.organizationId, true)
    // A refresh or TLS change that failed left the provisioned domain intact,
    // so its settings stay editable; an unfinished provision or removal does not.
    if (!provisioned(domain))
      throw new ConvexError("Finish provisioning this domain first")
    const tls = args.tls && args.tls !== domain.tls ? args.tls : undefined
    const receiving =
      args.receiving !== undefined &&
      args.receiving !== (domain.receiving ?? false)
        ? args.receiving
        : undefined
    const sending =
      args.sending !== undefined && args.sending !== domain.sending
        ? args.sending
        : undefined
    if (sending === undefined && tls === undefined && receiving === undefined)
      return null
    await ctx.db.patch("domains", domain._id, {
      ...(sending !== undefined ? { sending } : {}),
      ...(tls ? { pendingTls: tls } : {}),
      ...(receiving !== undefined ? { receiving } : {}),
    })
    // Receiving changes which records we publish, so it needs the full refresh
    // that rebuilds and rechecks DNS; that refresh also settles a pending TLS
    // change, keeping a combined update to a single operation.
    if (tls || receiving !== undefined)
      await start(ctx, domain, receiving === undefined ? "settings" : "refresh")
    await logHistory(
      ctx,
      domain._id,
      receiving === undefined
        ? "Settings updated"
        : receiving
          ? "Inbound receiving enabled"
          : "Inbound receiving disabled"
    )
    return null
  },
})
export const remove = mutation({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const domain = await findActiveDomain(ctx, id)
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
    const domain = await findActiveDomain(ctx, id)
    const region = await findRegion(ctx, domain.region)
    if (!region?.topicArn || region.phase !== "ready")
      throw new ConvexError("Region is not ready")
    const tenant = domain.tenantId
      ? await ctx.db.get("sesTenants", domain.tenantId)
      : null
    if (tenant && !tenantMatches(tenant, domain))
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
    needsAdoptionReview: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await ctx.db.get("domains", args.id)
    if (!domain) throw new ConvexError("Domain not found")
    const now = Date.now()
    await ctx.db.patch("domains", args.id, {
      ...args.changes,
      ...(!domain.dnsVerifiedAt &&
      args.changes.records?.length &&
      args.changes.records.every(
        (record) => record.kind === "DMARC" || record.status === "verified"
      )
        ? { dnsVerifiedAt: now }
        : {}),
      ...(!domain.partiallyVerifiedAt &&
      args.changes.status === "partially_verified"
        ? { partiallyVerifiedAt: now }
        : {}),
      ...(!domain.verifiedAt && args.changes.status === "verified"
        ? { verifiedAt: now }
        : {}),
      /* Only a provision can fail with nothing standing behind it. A refresh,
         a settings change or a removal that fails leaves the status its last
         successful run proved, so one throttled call never stops sending. */
      ...(args.error && domain.operation === "provision"
        ? { status: "failed" as const }
        : {}),
      ...(!args.error && args.changes.tls ? { pendingTls: undefined } : {}),
      phase: args.error ? "failed" : "ready",
      error: args.error,
      // Cleared by every run that does not raise it again, including a success.
      needsAdoptionReview: args.needsAdoptionReview,
      checkedAt: now,
    })
    // A removed domain is unreadable, so its history has nowhere left to show.
    if (args.changes.deleted)
      for (const row of await ctx.db
        .query("domainHistory")
        .withIndex("by_domainId", (q) => q.eq("domainId", args.id))
        .take(200))
        await ctx.db.delete("domainHistory", row._id)
    else
      await logHistory(
        ctx,
        args.id,
        args.error ??
          (domain.operation === "settings"
            ? "TLS policy updated"
            : "AWS and DNS state refreshed")
      )
    return null
  },
})

export const previewContext = internalQuery({
  args: { id: v.id("domains") },
  returns: schema.doc("domains"),
  handler: async (ctx, { id }) => {
    await requireInstallationAdmin(ctx)
    const domain = await ctx.db.get("domains", id)
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
    const domain = await ctx.db.get("domains", args.id)
    if (!domain || domain.phase !== "failed" || domain.deleted)
      throw new ConvexError("Domain changed. Review it again.")
    await requireTeam(ctx, domain.organizationId, true)
    await ctx.db.patch("domains", domain._id, { adoption: args.adoption })
    return null
  },
})
export const approveAdoption = mutation({
  args: { id: v.id("domains"), fingerprint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInstallationAdmin(ctx)
    const domain = await ctx.db.get("domains", args.id)
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
    await ctx.db.patch("domains", domain._id, {
      adoption: { ...domain.adoption, approved: true },
      needsAdoptionReview: undefined,
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
    const domain = await findActiveDomain(ctx, id)
    await requireTeam(ctx, domain.organizationId)
    const now = Date.now()
    if (
      (domain.dnsProviderCheckedAt &&
        now - domain.dnsProviderCheckedAt < 3600000) ||
      (domain.dnsProviderRequestedAt &&
        now - domain.dnsProviderRequestedAt < 60000)
    )
      return null
    await ctx.db.patch("domains", id, { dnsProviderRequestedAt: now })
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
    const domain = await ctx.db.get("domains", args.id)
    if (!domain || domain.deleted) return null
    await requireTeam(ctx, domain.organizationId)
    if (domain.dnsProviderRequestedAt !== args.requestedAt) return null
    await ctx.db.patch("domains", args.id, {
      dnsProvider: args.provider,
      dnsProviderCheckedAt: Date.now(),
    })
    return null
  },
})
