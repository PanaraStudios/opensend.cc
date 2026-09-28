import { v, ConvexError, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { findTenant, requireTeam } from "./access"
import schema from "./schema"
import { regions, tenantProvisioned } from "./ses/contracts"
import { suppressionReasonValue } from "./tables/emails"
import { isEmail } from "../lib/dashboard/format"
import { searchWords } from "../lib/dashboard/email-send"

type Reason = Infer<typeof suppressionReasonValue>

/* ------------------------------------------------ writes (the only ones) */

const findSuppression = (
  ctx: QueryCtx,
  organizationId: string,
  email: string
) =>
  ctx.db
    .query("suppressions")
    .withIndex("by_organizationId_and_email", (q) =>
      q.eq("organizationId", organizationId).eq("email", email)
    )
    .unique()

/** Adds the address, or gives an existing entry the newer reason. */
export async function upsertSuppression(
  ctx: MutationCtx,
  organizationId: string,
  address: string,
  reason: Reason
) {
  const email = address.trim().toLowerCase()
  if (!isEmail(email)) throw new ConvexError("Enter a valid email")
  const existing = await findSuppression(ctx, organizationId, email)
  if (existing) {
    if (existing.reason !== reason)
      await ctx.db.patch("suppressions", existing._id, { reason })
    return existing._id
  }
  return ctx.db.insert("suppressions", {
    organizationId,
    email,
    reason,
    search: searchWords(email),
  })
}

export const deleteSuppression = (ctx: MutationCtx, id: Id<"suppressions">) =>
  ctx.db.delete("suppressions", id)

/* ---------------------------------------------------------------- reads */

/** The lowercased addresses among `addresses` the team suppresses. */
export async function suppressedAmong(
  ctx: QueryCtx,
  organizationId: string,
  addresses: readonly string[]
) {
  const found = new Set<string>()
  for (const address of new Set(addresses))
    if (await findSuppression(ctx, organizationId, address)) found.add(address)
  return found
}

export const suppressionFilters = v.object({
  reason: v.optional(suppressionReasonValue),
  search: v.optional(v.string()),
  from: v.optional(v.number()),
  to: v.optional(v.number()),
})

/** Newest first; a search ranks by relevance and drops rows outside the
    date range from each page, so a page may come back short. */
export async function suppressionPage(
  ctx: QueryCtx,
  args: Infer<typeof suppressionFilters> & {
    organizationId: string
    paginationOpts: PaginationOptions
  }
) {
  const org = args.organizationId
  const from = args.from ?? 0
  const to = args.to ?? Number.MAX_SAFE_INTEGER
  const search = args.search?.trim().slice(0, 200)
  const rows = ctx.db.query("suppressions")
  const result = search
    ? await rows
        .withSearchIndex("search_search", (q) => {
          const scoped = q.search("search", search).eq("organizationId", org)
          return args.reason ? scoped.eq("reason", args.reason) : scoped
        })
        .paginate(args.paginationOpts)
    : await (
        args.reason
          ? rows.withIndex("by_organizationId_and_reason", (q) =>
              q
                .eq("organizationId", org)
                .eq("reason", args.reason!)
                .gte("_creationTime", from)
                .lte("_creationTime", to)
            )
          : rows.withIndex("by_organizationId", (q) =>
              q
                .eq("organizationId", org)
                .gte("_creationTime", from)
                .lte("_creationTime", to)
            )
      )
        .order("desc")
        .paginate(args.paginationOpts)
  return {
    ...result,
    page: result.page.filter(
      (row) => row._creationTime >= from && row._creationTime <= to
    ),
  }
}

export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    ...suppressionFilters.fields,
  },
  returns: paginationResultValidator(schema.doc("suppressions")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return suppressionPage(ctx, args)
  },
})

/* ------------------------------------------------------------ changes */

/** A manual entry from the dashboard. It lives only in Opensend: every send
    drops suppressed recipients before calling SES, and SES's own lists take
    only BOUNCE or COMPLAINT, which a manual entry is not. */
export const add = mutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    reason: suppressionReasonValue,
  },
  returns: v.id("suppressions"),
  handler: async (ctx, { organizationId, email, reason }) => {
    await requireTeam(ctx, organizationId, "write")
    return upsertSuppression(ctx, organizationId, email, reason)
  },
})

/** Removing a bounce or complaint also clears the address from the team's
    SES tenant suppression lists, where SES added it; otherwise SES would
    keep refusing it after the dashboard says it can receive mail again. */
export const remove = mutation({
  args: { id: v.id("suppressions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("suppressions", id)
    if (!row) return null
    await requireTeam(ctx, row.organizationId, "write")
    await deleteSuppression(ctx, id)
    if (row.reason !== "manual")
      await ctx.scheduler.runAfter(0, internal.emailSend.releaseSuppression, {
        organizationId: row.organizationId,
        email: row.email,
      })
    return null
  },
})

/** For SES event processing: a hard bounce or complaint, or any reason. */
export const record = internalMutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    reason: suppressionReasonValue,
  },
  returns: v.id("suppressions"),
  handler: (ctx, { organizationId, email, reason }) =>
    upsertSuppression(ctx, organizationId, email, reason),
})

/** The team's provisioned tenants, one per region at most. */
export const tenants = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.object({ name: v.string(), region: v.string() })),
  handler: async (ctx, { organizationId }) => {
    const found = []
    for (const region of regions) {
      const tenant = await findTenant(ctx, organizationId, region)
      if (tenant && tenantProvisioned(tenant))
        found.push({ name: tenant.name, region })
    }
    return found
  },
})
