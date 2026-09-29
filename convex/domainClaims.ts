import { ConvexError, v, type Infer } from "convex/values"
import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { requireTeam } from "./access"
import {
  activeName,
  createDomain,
  emitDomain,
  logHistory,
  start,
  trackingFields,
} from "./domains"
import { patchRow } from "./counts"
import { randomToken } from "../lib/oauth/policy"
import { normalizeDomainName } from "../lib/dashboard/domains"
import { regionValue } from "./ses/contracts"
import { claimRecord, claimStatus } from "./tables/domainClaims"
import { apiTime } from "./api/route"
import { retirement } from "./teamLifecycle"
import schema from "./schema"

const WINDOW = 7 * 86400000
export const claimInput = {
  name: v.string(),
  region: regionValue,
  customReturnPath: v.string(),
  ...trackingFields,
}
export const claimValue = v.object({
  object: v.literal("domain_claim"),
  id: v.id("domainClaims"),
  name: v.string(),
  status: claimStatus,
  domain_id: v.id("domains"),
  region: regionValue,
  record: claimRecord,
  blocked_reason: v.union(v.string(), v.null()),
  failure_reason: v.union(v.string(), v.null()),
  created_at: v.string(),
  expires_at: v.string(),
})
export function present(claim: Doc<"domainClaims">) {
  return {
    object: "domain_claim" as const,
    id: claim._id,
    name: claim.name,
    status: effectiveStatus(claim),
    domain_id: claim.domainId,
    region: claim.region,
    record: claim.record,
    blocked_reason: claim.blockedReason ?? null,
    failure_reason: claim.failureReason ?? null,
    created_at: apiTime(claim._creationTime),
    expires_at: apiTime(claim.expiresAt),
  }
}
function effectiveStatus(claim: Doc<"domainClaims">) {
  return ["pending", "blocked"].includes(claim.status) &&
    claim.expiresAt <= Date.now()
    ? ("expired" as const)
    : claim.status
}
export async function ownClaim(
  ctx: QueryCtx,
  organizationId: string,
  id: string
) {
  const domainId = ctx.db.normalizeId("domains", id)
  const domain = domainId ? await ctx.db.get("domains", domainId) : null
  if (!domain || domain.deleted || domain.organizationId !== organizationId)
    return null
  return ctx.db
    .query("domainClaims")
    .withIndex("by_domainId", (q) => q.eq("domainId", domain._id))
    .order("desc")
    .first()
}
export async function createClaim(
  ctx: MutationCtx,
  organizationId: string,
  args: Parameters<typeof createDomain>[2]
): Promise<{ body: Infer<typeof claimValue>; status: number }> {
  const name = normalizeDomainName(args.name)
  const previous = await ctx.db
    .query("domainClaims")
    .withIndex("by_organizationId_and_name", (q) =>
      q.eq("organizationId", organizationId).eq("name", name)
    )
    .order("desc")
    .first()
  if (
    previous &&
    !["completed", "canceled", "superseded"].includes(previous.status)
  ) {
    if (effectiveStatus(previous) !== "expired")
      return { body: present(previous), status: 200 }
    await ctx.db.patch("domainClaims", previous._id, { status: "superseded" })
    await patchRow(ctx, "domains", previous.domainId, { deleted: true })
    await emitDomain(ctx, previous.domainId, "domain.deleted")
  }
  const owners = await activeName(ctx, name)
  if (
    owners.length !== 1 ||
    owners[0].organizationId === organizationId ||
    (!owners[0].verifiedAt && owners[0].status !== "verified")
  )
    throw new ConvexError(
      "Only a domain verified by another team can be claimed"
    )
  const domainId = await createDomain(ctx, organizationId, args, true)
  const id = await ctx.db.insert("domainClaims", {
    organizationId,
    domainId,
    previousDomainId: owners[0]._id,
    name,
    region: args.region,
    status: "pending",
    expiresAt: Date.now() + WINDOW,
    record: {
      type: "TXT",
      name,
      value: `opensend-domain-verification=${randomToken()}`,
      ttl: "Auto",
    },
  })
  await patchRow(ctx, "domains", domainId, { claimId: id })
  await ctx.scheduler.runAfter(WINDOW, internal.domainClaims.expire, { id })
  return { body: present((await ctx.db.get("domainClaims", id))!), status: 201 }
}
export const create = mutation({
  args: { organizationId: v.string(), ...claimInput },
  returns: claimValue,
  handler: async (ctx, { organizationId, ...args }) => {
    await requireTeam(ctx, organizationId, "write")
    return (await createClaim(ctx, organizationId, args)).body
  },
})
export const get = query({
  args: { organizationId: v.string(), id: v.string() },
  returns: v.union(v.null(), claimValue),
  handler: async (ctx, { organizationId, id }) => {
    await requireTeam(ctx, organizationId, "read")
    const claim = await ownClaim(ctx, organizationId, id)
    return claim ? present(claim) : null
  },
})
export async function verifyClaim(
  ctx: MutationCtx,
  claim: Doc<"domainClaims">
): Promise<Infer<typeof claimValue>> {
  if (effectiveStatus(claim) === "expired") {
    await ctx.db.patch("domainClaims", claim._id, {
      status: "expired",
      checkingAt: undefined,
    })
  } else if (claim.status === "verified") {
    // A failed SES step keeps its lock. Retry that same operation, never a new transfer.
    const old = await ctx.db.get("domains", claim.previousDomainId)
    const next = await ctx.db.get("domains", claim.domainId)
    const target = old && !old.deleted ? old : next
    if (target?.phase === "failed") {
      await ctx.db.patch("domainClaims", claim._id, {
        failureReason: undefined,
      })
      await start(ctx, target, target.operation, true)
    }
  } else if (
    ["pending", "blocked"].includes(claim.status) &&
    (!claim.checkingAt || Date.now() - claim.checkingAt > 60000)
  ) {
    const checkingAt = Date.now()
    await ctx.db.patch("domainClaims", claim._id, {
      checkingAt,
      failureReason: undefined,
    })
    await ctx.scheduler.runAfter(0, internal.ses.claimDns.verify, {
      id: claim._id,
      checkingAt,
    })
  }
  return present((await ctx.db.get("domainClaims", claim._id))!)
}
export const verify = mutation({
  args: { organizationId: v.string(), id: v.string() },
  returns: claimValue,
  handler: async (ctx, { organizationId, id }) => {
    await requireTeam(ctx, organizationId, "write")
    const claim = await ownClaim(ctx, organizationId, id)
    if (!claim) throw new ConvexError("Domain claim not found")
    return verifyClaim(ctx, claim)
  },
})
export const expire = internalMutation({
  args: { id: v.id("domainClaims") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const claim = await ctx.db.get("domainClaims", id)
    if (claim && effectiveStatus(claim) === "expired")
      await ctx.db.patch("domainClaims", id, {
        status: "expired",
        checkingAt: undefined,
      })
    return null
  },
})
export const dnsTarget = internalQuery({
  args: { id: v.id("domainClaims"), checkingAt: v.number() },
  returns: v.union(v.null(), schema.doc("domainClaims")),
  handler: async (ctx, { id, checkingAt }) => {
    const claim = await ctx.db.get("domainClaims", id)
    return claim &&
      claim.checkingAt === checkingAt &&
      ["pending", "blocked"].includes(effectiveStatus(claim))
      ? claim
      : null
  },
})
export const acceptProof = internalMutation({
  args: {
    id: v.id("domainClaims"),
    checkingAt: v.number(),
    matches: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.db.get("domainClaims", args.id)
    if (
      !claim ||
      claim.checkingAt !== args.checkingAt ||
      !["pending", "blocked"].includes(effectiveStatus(claim))
    )
      return null
    await ctx.db.patch("domainClaims", claim._id, {
      checkingAt: undefined,
      failureReason: args.error,
    })
    if (!args.matches) return null
    const next = await ctx.db.get("domains", claim.domainId)
    if (!next || next.deleted || (await retirement(ctx, claim.organizationId)))
      return null
    const old = await ctx.db.get("domains", claim.previousDomainId)
    const owners = await activeName(ctx, claim.name)
    let reason: string | undefined
    let failure: string | undefined
    if (
      !old ||
      old.deleted ||
      owners.length !== 1 ||
      owners[0]._id !== old._id
    ) {
      reason = "recent_owner_activity"
      failure =
        "The domain owner changed. Delete this placeholder and start a new claim."
    } else if (
      old.phase === "running" ||
      old.operation === "remove" ||
      old.transferClaimId ||
      old.adoption?.approved
    ) {
      reason = "recent_owner_activity"
      failure = old.adoption?.approved
        ? "An imported SES identity must be released by its owner before it can be transferred."
        : "A domain operation is in progress. Try again after it finishes."
    } else {
      for (const status of ["queued", "scheduled"] as const) {
        if (
          await ctx.db
            .query("emails")
            .withIndex("by_domainId_and_status", (q) =>
              q.eq("domainId", old._id).eq("status", status)
            )
            .first()
        ) {
          reason = "pending_scheduled_emails"
          failure =
            "The previous team has queued or scheduled emails. Try again after they finish or are canceled."
          break
        }
      }
    }
    if (reason) {
      await ctx.db.patch("domainClaims", claim._id, {
        status: "blocked",
        blockedReason: reason,
        failureReason: failure,
      })
      return null
    }
    await ctx.db.patch("domainClaims", claim._id, {
      status: "verified",
      blockedReason: undefined,
      failureReason: undefined,
    })
    await patchRow(ctx, "domains", old!._id, {
      transferClaimId: claim._id,
      sending: false,
    })
    await logHistory(
      ctx,
      old!._id,
      "DNS ownership verified by another team; domain transfer started"
    )
    await emitDomain(ctx, old!._id, "domain.updated")
    await start(ctx, (await ctx.db.get("domains", old!._id))!, "remove", true)
    return null
  },
})
/** Called in the same transaction as each existing domain workflow completion. */
async function domainClaimFinished(ctx: MutationCtx, domain: Doc<"domains">) {
  const id = domain.transferClaimId ?? domain.claimId
  const claim = id ? await ctx.db.get("domainClaims", id) : null
  if (!claim || claim.status !== "verified") return
  if (domain.phase === "failed") {
    await ctx.db.patch("domainClaims", claim._id, {
      failureReason: domain.error,
    })
    return
  }
  if (domain.transferClaimId && domain.deleted) {
    const next = (await ctx.db.get("domains", claim.domainId))!
    if (await retirement(ctx, claim.organizationId)) {
      await ctx.db.patch("domainClaims", claim._id, {
        status: "failed",
        failureReason: "Claiming team was deleted",
      })
      return
    }
    await patchRow(ctx, "domains", next._id, {
      claimPending: undefined,
      sending: true,
    })
    await start(
      ctx,
      (await ctx.db.get("domains", next._id))!,
      "provision",
      true
    )
  } else if (domain._id === claim.domainId && domain.phase === "ready") {
    await ctx.db.patch("domainClaims", claim._id, {
      status: "completed",
      failureReason: undefined,
    })
    await patchRow(ctx, "domains", domain._id, { claimId: undefined })
    await emitDomain(ctx, domain._id, "domain.updated")
    await logHistory(
      ctx,
      domain._id,
      "Domain claim completed; add the new DNS records to finish setup"
    )
  }
}
async function cancelClaim(ctx: MutationCtx, domain: Doc<"domains">) {
  const claim = domain.claimId
    ? await ctx.db.get("domainClaims", domain.claimId)
    : null
  if (claim?.status === "verified")
    throw new ConvexError("A domain claim transfer is in progress")
  if (claim)
    await ctx.db.patch("domainClaims", claim._id, {
      status: "canceled",
      checkingAt: undefined,
    })
  await patchRow(ctx, "domains", domain._id, { deleted: true })
  await emitDomain(ctx, domain._id, "domain.deleted")
}

export const finish = internalMutation({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const domain = await ctx.db.get("domains", id)
    if (domain) await domainClaimFinished(ctx, domain)
    return null
  },
})
export const cancel = internalMutation({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { id }): Promise<null> => {
    const domain = await ctx.db.get("domains", id)
    if (domain && !domain.deleted && domain.claimPending)
      await cancelClaim(ctx, domain)
    return null
  },
})
