import { apiError } from "./api/caller"
import { includeSelected, OPTION_LIMIT } from "../lib/dashboard/options"
import { selectedOption } from "./lists"
import { trackingTarget } from "./ses/contracts"
import { v, ConvexError, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
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
  domainConnectValue,
  domainStatusValue,
  provisioned,
  recordValue,
  regionValue,
  requireReceivingRegion,
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
import { mailRecords } from "./ses/records"
import { limitDomainCheck } from "./ses/limits"
import { emitEvent } from "./events"
import { countValue, counters, insertRow, literals, patchRow } from "./counts"
import { cleanupIfUnused } from "./ses/inboundRegions"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

export const domainFilters = v.object({
  search: v.optional(v.string()),
  status: v.optional(domainStatusValue),
  region: v.optional(regionValue),
})
/** The team's live domains, by name, narrowed by the list's filters. */
export function domainPage(
  ctx: QueryCtx,
  args: Infer<typeof domainFilters> & {
    organizationId: string
    paginationOpts: PaginationOptions
  }
) {
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
}
export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    ...domainFilters.fields,
  },
  returns: paginationResultValidator(schema.doc("domains")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return domainPage(ctx, args)
  },
})
/** Shared by live-domain pickers and historical metrics suggestions. */
export async function domainOptionRows(
  ctx: QueryCtx,
  args: {
    organizationId: string
    search?: string
    selectedId?: Id<"domains">
    status?: Doc<"domains">["status"]
    historical?: boolean
  }
) {
  const prefix = args.search?.trim().toLowerCase() ?? ""
  const domains = ctx.db.query("domains")
  const rows = prefix
    ? args.historical
      ? await domains
          .withIndex("by_organizationId_and_name", (q) =>
            q
              .eq("organizationId", args.organizationId)
              .gte("name", prefix)
              .lt("name", prefix + "\uffff")
          )
          .take(OPTION_LIMIT)
      : (
          await domainPage(ctx, {
            ...args,
            paginationOpts: { cursor: null, numItems: OPTION_LIMIT },
          })
        ).page
    : args.historical
      ? await domains
          .withIndex("by_organizationId", (q) =>
            q.eq("organizationId", args.organizationId)
          )
          .order("desc")
          .take(OPTION_LIMIT)
      : args.status
        ? await domains
            .withIndex("by_organizationId_and_deleted_and_status", (q) =>
              q
                .eq("organizationId", args.organizationId)
                .eq("deleted", false)
                .eq("status", args.status!)
            )
            .order("desc")
            .take(OPTION_LIMIT)
        : await domains
            .withIndex("by_organizationId_and_deleted", (q) =>
              q.eq("organizationId", args.organizationId).eq("deleted", false)
            )
            .order("desc")
            .take(OPTION_LIMIT)
  const selected = await selectedOption(
    ctx,
    "domains",
    args.organizationId,
    args.selectedId
  )
  return includeSelected(
    rows,
    selected &&
      (args.historical ||
        (!selected.deleted &&
          (!args.status || selected.status === args.status)))
      ? selected
      : null,
    (row) => row._id
  )
}
export const options = query({
  args: {
    organizationId: v.string(),
    search: v.optional(v.string()),
    status: v.optional(domainStatusValue),
    selectedId: v.optional(v.id("domains")),
  },
  returns: v.array(schema.doc("domains")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "read")
    return domainOptionRows(ctx, args)
  },
})
export const count = query({
  args: {
    organizationId: v.string(),
    search: v.optional(v.string()),
    status: v.optional(domainStatusValue),
    region: v.optional(regionValue),
  },
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    if (args.search?.trim()) return { total: null }
    return {
      total: await counters.domains.total(ctx, args.organizationId, [
        { is: args.status, among: literals(domainStatusValue) },
        { is: args.region, among: literals(regionValue) },
      ]),
    }
  },
})
export const byName = query({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.union(v.null(), schema.doc("domains")),
  handler: async (ctx, { organizationId, name }) => {
    await requireTeam(ctx, organizationId, "read")
    const domain = await ctx.db
      .query("domains")
      .withIndex("by_organizationId_and_deleted_and_name", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("deleted", false)
          .eq("name", normalizeDomainName(name))
      )
      .first()
    return domain
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
/** Emits a `domain.*` event with the domain as it now stands, shaped like
    the domain in Resend's domain events. */
export async function emitDomain(
  ctx: MutationCtx,
  id: Id<"domains">,
  type: "domain.created" | "domain.updated" | "domain.deleted"
) {
  const domain = (await ctx.db.get("domains", id))!
  await emitEvent(ctx, domain.organizationId, type, {
    id: domain._id,
    name: domain.name,
    status: domain.status,
    created_at: new Date(domain._creationTime).toISOString(),
    region: domain.region,
    capabilities: {
      sending: domain.sending ? "enabled" : "disabled",
      receiving: domain.receiving ? "enabled" : "disabled",
    },
    records: domain.records.map((record) => ({
      record: record.kind,
      name: record.name,
      type: record.type,
      ttl: record.ttl,
      status: record.status,
      value: record.value,
      ...(record.priority === undefined ? {} : { priority: record.priority }),
    })),
  })
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
/** The first time a domain reached each milestone; never restamped. */
function milestones(
  domain: Doc<"domains">,
  changes: Partial<Pick<Doc<"domains">, "records" | "status">>,
  now: number
) {
  return {
    ...(!domain.dnsVerifiedAt &&
    changes.records?.length &&
    changes.records.every(
      (record) => record.kind === "DMARC" || record.status === "verified"
    )
      ? { dnsVerifiedAt: now }
      : {}),
    // Milestones trace the way to verified; a later dip is not one of them.
    ...(!domain.partiallyVerifiedAt &&
    !domain.verifiedAt &&
    changes.status === "partially_verified"
      ? { partiallyVerifiedAt: now }
      : {}),
    ...(!domain.verifiedAt && changes.status === "verified"
      ? { verifiedAt: now }
      : {}),
  }
}
/* SES re-reads DNS for a new identity for 72 hours. Status checks follow it:
   often while the records are likely being added, then hourly. */
const CHECK_DELAYS = [30, 60, 120, 300, 600, 900, 1800].map((s) => s * 1000)
const HOUR = 3600000
/** How long before check number `attempt` runs, or null once the 72 hours
    are spent. */
export function checkDelay(attempt: number) {
  if (attempt < CHECK_DELAYS.length) return CHECK_DELAYS[attempt]
  const elapsed =
    CHECK_DELAYS.reduce((sum, delay) => sum + delay, 0) +
    (attempt - CHECK_DELAYS.length) * HOUR
  return elapsed + HOUR <= 72 * HOUR ? HOUR : null
}
/** A dispatched check holds its slot this long, so a sweep never sends it
    twice, and one lost to a crash runs again afterwards. */
const CHECK_LEASE = 5 * 60000
/** A domain a status check may read and write: provisioned, and not owned
    by a running operation. */
const checkable = (domain: Doc<"domains"> | null): domain is Doc<"domains"> =>
  !!domain &&
  !domain.deleted &&
  domain.phase !== "running" &&
  provisioned(domain)
/** Starts a status check now, holding the domain's slot until it reports. */
async function dispatchCheck(
  ctx: MutationCtx,
  domain: Doc<"domains">,
  attempt: number
) {
  await patchRow(ctx, "domains", domain._id, {
    checkAttempt: attempt,
    nextCheckAt: Date.now() + CHECK_LEASE,
    checking: true,
  })
  await ctx.scheduler.runAfter(0, internal.ses.verify.run, {
    domainId: domain._id,
    attempt,
  })
}
export async function start(
  ctx: MutationCtx,
  domain: Doc<"domains">,
  operation: Doc<"domains">["operation"],
  claiming = false
): Promise<void> {
  if (domain.claimPending) {
    if (operation === "remove") {
      await ctx.runMutation(internal.domainClaims.cancel, { id: domain._id })
      return
    }
    throw new ConvexError("Verify the domain claim first")
  }
  if ((domain.transferClaimId || domain.claimId) && !claiming)
    throw new ConvexError("A domain claim transfer is in progress")
  if (domain.phase === "running")
    throw new ConvexError("A domain operation is already running")
  await patchRow(ctx, "domains", domain._id, {
    phase: "running",
    operation,
    error: undefined,
    // The operation checks the domain itself; `finish` schedules what follows.
    nextCheckAt: undefined,
    checking: undefined,
    ...(operation === "remove" ? { sending: false } : {}),
  })
  await logHistory(ctx, domain._id, `${operation} requested`)
  await startWorkflow(ctx, internal.ses.workflows.domainOperationWithTenant, {
    domainId: domain._id,
  })
}
export const trackingFields = {
  trackingSubdomain: v.optional(v.string()),
  openTracking: v.optional(v.boolean()),
  clickTracking: v.optional(v.boolean()),
}
type TrackingSettings = Partial<
  Pick<Doc<"domains">, "trackingSubdomain" | "openTracking" | "clickTracking">
>
/** The requested tracking settings over the domain's own, validated. As in
    Resend, a tracking subdomain can be changed but never removed. */
function trackingSettings(
  domain: Pick<Doc<"domains">, "name" | "customReturnPath"> & TrackingSettings,
  changes: TrackingSettings
) {
  const trackingSubdomain =
    changes.trackingSubdomain?.trim().toLowerCase() ?? domain.trackingSubdomain
  if (trackingSubdomain !== undefined) {
    const error = validateDnsLabel(trackingSubdomain)
    if (error) throw new ConvexError(error)
    // The Return-Path's MX and TXT records cannot share a name with a CNAME.
    if (trackingSubdomain === domain.customReturnPath)
      throw new ConvexError(
        "Use a tracking subdomain other than the Return-Path"
      )
    if (`${trackingSubdomain}.${domain.name}`.length > 253)
      throw new ConvexError("Tracking subdomain is too long")
  }
  return {
    trackingSubdomain,
    openTracking: changes.openTracking ?? domain.openTracking ?? false,
    clickTracking: changes.clickTracking ?? domain.clickTracking ?? false,
  }
}
/** Adds a domain for a team and starts provisioning it. The dashboard and
    the REST API both create domains through here. */
export async function createDomain(
  ctx: MutationCtx,
  organizationId: string,
  args: {
    name: string
    region: Doc<"domains">["region"]
    customReturnPath: string
    sending?: boolean
    receiving?: boolean
    tls?: "opportunistic" | "enforced"
  } & TrackingSettings,
  placeholder = false
): Promise<Id<"domains">> {
  const name = normalizeDomainName(args.name)
  const customReturnPath = args.customReturnPath.trim().toLowerCase()
  const error =
    validateDomainName(name, []) || validateDnsLabel(customReturnPath)
  if (error || `${customReturnPath}.${name}`.length > 253)
    throw new ConvexError(error ?? "Return-Path is too long")
  if (args.receiving) requireReceivingRegion(args.region)
  const tracking = trackingSettings({ name, customReturnPath }, args)
  const region = await findRegion(ctx, args.region)
  if (!region || region.phase !== "ready")
    throw new ConvexError(
      "Provision this AWS region in installation settings first"
    )
  if (!placeholder) {
    const existing = await activeName(ctx, name)
    if (existing.length) {
      if (existing.some((domain) => domain.organizationId !== organizationId))
        throw apiError(
          403,
          "validation_error",
          `The ${name} domain has been registered already`
        )
      throw new ConvexError("That domain is already reserved in this region")
    }
  }
  const installation = await findInstallation(ctx)
  if (!installation) throw new ConvexError("Installation not found")
  const target = trackingTarget(installation.callbackOrigin)
  const id = await insertRow(ctx, "domains", {
    organizationId,
    region: args.region,
    name,
    customReturnPath,
    status: "pending",
    phase: "pending",
    deleted: false,
    sending: placeholder ? false : (args.sending ?? true),
    ...(placeholder ? { claimPending: true } : {}),
    receiving: args.receiving ?? false,
    tls: args.tls ?? "opportunistic",
    ...tracking,
    trackingTarget: target,
    // Shown at once; the DKIM records join them when SES issues its keys.
    records: placeholder
      ? []
      : mailRecords({
          receiving: args.receiving,
          trackingTarget: target,
          name,
          region: args.region,
          customReturnPath,
          ...tracking,
        }),
    sesVerified: false,
    dkimVerified: false,
    mailFromVerified: false,
    operation: "provision",
  })
  await emitDomain(ctx, id, "domain.created")
  if (!placeholder)
    await start(ctx, (await ctx.db.get("domains", id))!, "provision")
  if (!installation.completedAt) await completeInstallation(ctx, organizationId)
  return id
}
export const create = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    region: regionValue,
    customReturnPath: v.string(),
  },
  returns: v.id("domains"),
  handler: async (ctx, { organizationId, ...args }) => {
    await requireTeam(ctx, organizationId, "write")
    return createDomain(ctx, organizationId, args)
  },
})
export const refresh = mutation({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const domain = await findActiveDomain(ctx, id)
    await requireTeam(ctx, domain.organizationId, "write")
    await start(ctx, domain, retryOperation(domain))
    return null
  },
})
/** After the public URL moved: refreshes one page of a region's domains, so
    their tracking records point at the new URL. A domain that is not
    provisioned, runs an operation of its own, or is being claimed is left
    alone; its next operation reads the new URL anyway. Returns the cursor of
    the next page, or null after the last one. */
export const refreshForNewOrigin = internalMutation({
  args: { region: regionValue, cursor: v.union(v.string(), v.null()) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { region, cursor }) => {
    const page = await ctx.db
      .query("domains")
      .withIndex("by_region_and_deleted_and_receiving", (q) =>
        q.eq("region", region).eq("deleted", false)
      )
      .paginate({ numItems: 25, cursor })
    for (const domain of page.page)
      if (
        provisioned(domain) &&
        !domain.claimPending &&
        !domain.claimId &&
        !domain.transferClaimId
      )
        await start(ctx, domain, "refresh")
    return page.isDone ? null : page.continueCursor
  },
})
/** "Check DNS records". A failed operation is retried. Otherwise the status is
    read now, without re-running the AWS setup, and automatic checks restart.
    Returns whether a status check started, rather than an operation. */
export async function verifyDomain(ctx: MutationCtx, domain: Doc<"domains">) {
  if (domain.claimId || domain.transferClaimId)
    throw new ConvexError("A domain claim is in progress")
  if (domain.phase === "failed") {
    await start(ctx, domain, retryOperation(domain))
    return false
  }
  if (!checkable(domain))
    throw new ConvexError("A domain operation is already running")
  await limitDomainCheck(ctx, domain._id)
  await dispatchCheck(ctx, domain, 0)
  return true
}
export const verify = mutation({
  args: { id: v.id("domains") },
  returns: v.boolean(),
  handler: async (ctx, { id }) => {
    const domain = await findActiveDomain(ctx, id)
    await requireTeam(ctx, domain.organizationId, "write")
    return verifyDomain(ctx, domain)
  },
})
export const domainChanges = v.object({
  sending: v.optional(v.boolean()),
  receiving: v.optional(v.boolean()),
  tls: v.optional(tlsValue),
  ...trackingFields,
})
export async function updateDomain(
  ctx: MutationCtx,
  domain: Doc<"domains">,
  args: Infer<typeof domainChanges>
) {
  // A refresh or TLS change that failed left the provisioned domain intact,
  // so its settings stay editable; an unfinished provision or removal does not.
  if (domain.claimId || domain.transferClaimId)
    throw new ConvexError("A domain claim is in progress")
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
  if (receiving) requireReceivingRegion(domain.region)
  const tracking = trackingSettings(domain, args)
  const trackingChanged =
    tracking.trackingSubdomain !== domain.trackingSubdomain ||
    tracking.openTracking !== (domain.openTracking ?? false) ||
    tracking.clickTracking !== (domain.clickTracking ?? false)
  if (
    sending === undefined &&
    tls === undefined &&
    receiving === undefined &&
    !trackingChanged
  )
    return
  await patchRow(ctx, "domains", domain._id, {
    ...(sending !== undefined ? { sending } : {}),
    ...(tls ? { pendingTls: tls } : {}),
    ...(receiving !== undefined ? { receiving } : {}),
    ...(trackingChanged
      ? {
          ...tracking,
          trackingTarget: trackingTarget(
            (await findInstallation(ctx))!.callbackOrigin
          ),
        }
      : {}),
  })
  await emitDomain(ctx, domain._id, "domain.updated")
  // Receiving and tracking change which records we publish, so they need
  // the full refresh that rebuilds and rechecks DNS; that refresh also
  // settles a pending TLS change, keeping a combined update to a single
  // operation.
  const records = receiving !== undefined || trackingChanged
  if (tls || records) await start(ctx, domain, records ? "refresh" : "settings")
  await logHistory(
    ctx,
    domain._id,
    receiving !== undefined
      ? receiving
        ? "Inbound receiving enabled"
        : "Inbound receiving disabled"
      : trackingChanged
        ? "Tracking settings updated"
        : "Settings updated"
  )
}
export const update = mutation({
  args: { id: v.id("domains"), ...domainChanges.fields },
  returns: v.null(),
  handler: async (ctx, { id, ...changes }) => {
    const domain = await findActiveDomain(ctx, id)
    await requireTeam(ctx, domain.organizationId, "write")
    await updateDomain(ctx, domain, changes)
    return null
  },
})
export const remove = mutation({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const domain = await findActiveDomain(ctx, id)
    await requireTeam(ctx, domain.organizationId, "write")
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
    inbound: v.union(v.null(), schema.doc("inboundRegions")),
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
    const inbound = await ctx.db
      .query("inboundRegions")
      .withIndex("by_region", (q) => q.eq("region", domain.region))
      .unique()
    return { domain, region, tenant, inbound }
  },
})
/** A provision publishes its records the moment AWS issues them, so they show
    while the rest of its paced AWS setup still runs; `finish` then replaces
    them with the checked ones. */
export const saveRecords = internalMutation({
  args: { id: v.id("domains"), records: v.array(recordValue) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await ctx.db.get("domains", args.id)
    if (
      domain &&
      !domain.deleted &&
      domain.phase === "running" &&
      domain.operation === "provision"
    )
      await patchRow(ctx, "domains", args.id, { records: args.records })
    return null
  },
})
/** Recorded just before the worker creates the domain's receipt rule. */
export const saveReceiptRule = internalMutation({
  args: { id: v.id("domains"), ruleSet: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await patchRow(ctx, "domains", args.id, { receiptRuleSet: args.ruleSet })
    return null
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
        "trackingTarget",
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
    /** The rule set holding the domain's receipt rule; null once it has none. */
    receiptRuleSet: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const domain = await ctx.db.get("domains", args.id)
    if (!domain) throw new ConvexError("Domain not found")
    if (domain.deleted) return null
    const now = Date.now()
    const phase = args.error ? "failed" : "ready"
    /* Only a provision can fail with nothing standing behind it. A refresh,
       a settings change or a removal that fails leaves the status its last
       successful run proved, so one throttled call never stops sending. */
    const status =
      args.error && domain.operation === "provision"
        ? "failed"
        : (args.changes.status ?? domain.status)
    const checking =
      !args.changes.deleted &&
      status !== "verified" &&
      provisioned({ phase, operation: domain.operation })
    await patchRow(ctx, "domains", args.id, {
      ...args.changes,
      ...milestones(domain, args.changes, now),
      status,
      ...(!args.error && args.changes.tls ? { pendingTls: undefined } : {}),
      phase,
      error: args.error,
      // Cleared by every run that does not raise it again, including a success.
      needsAdoptionReview: args.needsAdoptionReview,
      checkedAt: now,
      nextCheckAt: checking ? now + checkDelay(0)! : undefined,
      checkAttempt: 0,
      ...(args.receiptRuleSet !== undefined
        ? { receiptRuleSet: args.receiptRuleSet ?? undefined }
        : {}),
    })
    if (args.receiptRuleSet === null && domain.receiptRuleSet)
      await cleanupIfUnused(ctx, domain.region)
    if (args.changes.deleted) await emitDomain(ctx, args.id, "domain.deleted")
    else if (status !== domain.status)
      await emitDomain(ctx, args.id, "domain.updated")
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
    if (domain.claimId || domain.transferClaimId)
      await ctx.runMutation(internal.domainClaims.finish, { id: args.id })
    return null
  },
})

/** Sends each domain whose automatic check is due to be checked. A sweep
    stays well inside what the region's SES pacer can serve in a minute. */
export const dispatchChecks = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const due = await ctx.db
      .query("domains")
      .withIndex("by_nextCheckAt", (q) =>
        q.gte("nextCheckAt", 0).lte("nextCheckAt", Date.now())
      )
      .take(20)
    for (const domain of due)
      await dispatchCheck(ctx, domain, domain.checkAttempt ?? 0)
    return null
  },
})
/** A domain its team's admin may change. */
export const writable = internalQuery({
  args: { id: v.id("domains") },
  returns: schema.doc("domains"),
  handler: async (ctx, { id }) => {
    const domain = await findActiveDomain(ctx, id)
    await requireTeam(ctx, domain.organizationId, "write")
    return domain
  },
})
/** The domain a status check reads, unless an operation owns it now. */
export const checkTarget = internalQuery({
  args: { id: v.id("domains") },
  returns: v.union(v.null(), schema.doc("domains")),
  handler: async (ctx, { id }) => {
    const domain = await ctx.db.get("domains", id)
    return checkable(domain) ? domain : null
  },
})
export const saveCheck = internalMutation({
  args: {
    id: v.id("domains"),
    attempt: v.number(),
    /** The domain's `checkedAt` when the check read it. */
    checkedAt: v.optional(v.number()),
    result: v.union(
      v.object({ error: v.string() }),
      schema
        .doc("domains")
        .pick(
          "records",
          "sesVerified",
          "dkimVerified",
          "mailFromVerified",
          "status"
        )
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await ctx.db.get("domains", args.id)
    // An operation or another check has written a newer state since.
    if (!checkable(domain) || domain.checkedAt !== args.checkedAt) return null
    const now = Date.now()
    const status = "error" in args.result ? domain.status : args.result.status
    const delay = status === "verified" ? null : checkDelay(args.attempt + 1)
    const next = {
      checkAttempt: args.attempt + 1,
      nextCheckAt: delay === null ? undefined : now + delay,
      checking: undefined,
    }
    if ("error" in args.result) {
      // A failed read proves nothing, so the status stands until the next one.
      await patchRow(ctx, "domains", args.id, next)
      await logHistory(
        ctx,
        args.id,
        `Status check failed: ${args.result.error}`
      )
      return null
    }
    await patchRow(ctx, "domains", args.id, {
      ...args.result,
      ...milestones(domain, args.result, now),
      ...next,
      checkedAt: now,
    })
    if (status !== domain.status) {
      await emitDomain(ctx, args.id, "domain.updated")
      await logHistory(
        ctx,
        args.id,
        status === "verified"
          ? "Domain verified"
          : status === "partially_verified"
            ? "Domain partially verified"
            : "Waiting for DNS records"
      )
    }
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
    await requireTeam(ctx, domain.organizationId, "write")
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
    await requireTeam(ctx, domain.organizationId, "write")
    await patchRow(ctx, "domains", domain._id, { adoption: args.adoption })
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
    await requireTeam(ctx, domain.organizationId, "write")
    await patchRow(ctx, "domains", domain._id, {
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
    await patchRow(ctx, "domains", id, { dnsProviderRequestedAt: now })
    return { name: domain.name, requestedAt: now }
  },
})
export const saveDnsProvider = internalMutation({
  args: {
    id: v.id("domains"),
    requestedAt: v.number(),
    provider: v.optional(dnsProviderValue),
    domainConnect: v.optional(domainConnectValue),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await ctx.db.get("domains", args.id)
    if (!domain || domain.deleted) return null
    await requireTeam(ctx, domain.organizationId)
    if (domain.dnsProviderRequestedAt !== args.requestedAt) return null
    await patchRow(ctx, "domains", args.id, {
      dnsProvider: args.provider,
      domainConnect: args.domainConnect,
      dnsProviderCheckedAt: Date.now(),
    })
    return null
  },
})

/** Placeholders never reserve an SES identity or receive mail. */
export function activeName(ctx: QueryCtx, name: string) {
  return ctx.db
    .query("domains")
    .withIndex("by_name_and_deleted_and_claimPending", (q) =>
      q.eq("name", name).eq("deleted", false).eq("claimPending", undefined)
    )
    .take(2)
}
