import { teamRow } from "../lists"
import {
  createClaim,
  ownClaim,
  present,
  verifyClaim,
  claimValue,
} from "../domainClaims"
import { stream } from "convex-helpers/server/stream"
import { idempotent } from "./idempotency"
import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { findInstallation } from "../access"
import {
  createDomain,
  domainChanges,
  start,
  trackingFields,
  updateDomain,
  verifyDomain,
} from "../domains"
import schema from "../schema"
import { regionValue, regions } from "../ses/contracts"
import { DEFAULT_RETURN_PATH } from "../../lib/dashboard/domains"
import { callerValue, notFound, requireCaller, type Caller } from "./caller"
import { cursorPage, listArgs } from "./paging"
import {
  listBody,
  apiRoute,
  apiTime,
  booleanField,
  enumField,
  listParams,
  objectBody,
  stringField,
} from "./route"

/** A live domain of the caller's team, or null. */
function own(ctx: QueryCtx, caller: Caller, id: string) {
  return teamRow(ctx, "domains", caller.organizationId, id, {
    keep: (row) => !row.deleted,
  })
}

export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("domains")),
  }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    const org = caller.organizationId
    return cursorPage(
      page,
      async (id) => await own(ctx, caller, id),
      (order) =>
        stream(ctx.db, schema)
          .query("domains")
          .withIndex("by_organizationId_and_deleted", (q) => {
            return q.eq("organizationId", org).eq("deleted", false)
          })
          .order(order)
    )
  },
})
export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: v.union(v.null(), schema.doc("domains")),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    return own(ctx, caller, id)
  },
})
export const create = internalMutation({
  args: {
    caller: callerValue,
    name: v.string(),
    region: v.optional(regionValue),
    customReturnPath: v.string(),
    sending: v.optional(v.boolean()),
    receiving: v.optional(v.boolean()),
    tls: v.optional(v.union(v.literal("opportunistic"), v.literal("enforced"))),
    ...trackingFields,
  },
  returns: schema.doc("domains"),
  handler: async (ctx, { caller, region, ...args }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        const id = await createDomain(ctx, caller.organizationId, {
          ...args,
          region:
            region ??
            (await findInstallation(ctx))?.defaultRegion ??
            "us-east-1",
        })
        return (await ctx.db.get("domains", id))!
      },
      (row) => ({ status: 201, body: detail(row) })
    )
  },
})
export const change = internalMutation({
  args: {
    caller: callerValue,
    id: v.string(),
    action: v.union(
      v.object({ kind: v.literal("update"), changes: domainChanges }),
      v.object({ kind: v.literal("verify") }),
      v.object({ kind: v.literal("remove") })
    ),
  },
  returns: v.union(v.null(), v.id("domains")),
  handler: async (ctx, { caller, id, action }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        const domain = await own(ctx, caller, id)
        if (!domain) return null
        if (action.kind === "update")
          await updateDomain(ctx, domain, action.changes)
        else if (action.kind === "verify") await verifyDomain(ctx, domain)
        else await start(ctx, domain, "remove")
        return domain._id
      },
      (id) => {
        if (!id) throw notFound("Domain")
        return { body: { object: "domain", id } }
      }
    )
  },
})

export const claimCreate = internalMutation({
  args: {
    caller: callerValue,
    name: v.string(),
    region: v.optional(regionValue),
    customReturnPath: v.string(),
    ...trackingFields,
  },
  returns: v.object({ body: claimValue, status: v.number() }),
  handler: async (ctx, { caller, region, ...args }) =>
    idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        return createClaim(ctx, caller.organizationId, {
          ...args,
          region:
            region ??
            (await findInstallation(ctx))?.defaultRegion ??
            "us-east-1",
        })
      },
      (reply) => reply
    ),
})
export const claimGet = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: claimValue,
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    const claim = await ownClaim(ctx, caller.organizationId, id)
    if (!claim) throw notFound("Domain claim")
    return present(claim)
  },
})
export const claimVerify = internalMutation({
  args: { caller: callerValue, id: v.string() },
  returns: claimValue,
  handler: async (ctx, { caller, id }) =>
    idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        const claim = await ownClaim(ctx, caller.organizationId, id)
        if (!claim) throw notFound("Domain claim")
        return verifyClaim(ctx, claim)
      },
      (body) => ({ body })
    ),
})

const capability = (on: boolean) => (on ? "enabled" : "disabled")
/** Our record kinds as Resend names them: its return-path MX is "SPF". */
const recordName = (kind: Doc<"domains">["records"][number]["kind"]) =>
  kind === "MX" ? "SPF" : kind
function summary(domain: Doc<"domains">) {
  return {
    id: domain._id,
    name: domain.name,
    status: domain.status,
    created_at: apiTime(domain._creationTime),
    region: domain.region,
    open_tracking: domain.openTracking ?? false,
    click_tracking: domain.clickTracking ?? false,
    ...(domain.trackingSubdomain
      ? { tracking_subdomain: domain.trackingSubdomain }
      : {}),
    capabilities: {
      sending: capability(domain.sending),
      receiving: capability(domain.receiving ?? false),
    },
  }
}
function detail(domain: Doc<"domains">) {
  return {
    ...summary(domain),
    tls: domain.tls,
    records: domain.records.map((record) => ({
      record: recordName(record.kind),
      name: record.name,
      type: record.type,
      ttl: record.ttl,
      status: record.status,
      value: record.value,
      ...(record.priority === undefined ? {} : { priority: record.priority }),
    })),
  }
}
const toggles = ["enabled", "disabled"] as const
/** `capabilities` of a create or update body. */
function capabilities(body: Record<string, unknown>) {
  const value = body.capabilities
  if (value === undefined) return {}
  const fields = objectBody(value)
  const sending = enumField(fields, "sending", toggles)
  const receiving = enumField(fields, "receiving", toggles)
  return {
    ...(sending ? { sending: sending === "enabled" } : {}),
    ...(receiving ? { receiving: receiving === "enabled" } : {}),
  }
}
/** `open_tracking`, `click_tracking` and `tracking_subdomain` of a body. */
function tracking(body: Record<string, unknown>) {
  const openTracking = booleanField(body, "open_tracking")
  const clickTracking = booleanField(body, "click_tracking")
  const trackingSubdomain = stringField(body, "tracking_subdomain")
  return {
    ...(openTracking === undefined ? {} : { openTracking }),
    ...(clickTracking === undefined ? {} : { clickTracking }),
    ...(trackingSubdomain === undefined ? {} : { trackingSubdomain }),
  }
}

/** `/domains`, as Resend documents it. Ids are Convex ids, not UUIDs. */
export function registerDomainRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/domains/claim",
    scope: { resource: "domains", access: "write" },
    handler: async (ctx, { caller, body }) => {
      const input = objectBody(body)
      return ctx.runMutation(internal.api.domains.claimCreate, {
        caller,
        name: stringField(input, "name", true)!,
        region: enumField(input, "region", regions),
        customReturnPath:
          stringField(input, "custom_return_path") ?? DEFAULT_RETURN_PATH,
        ...tracking(input),
      })
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/domains/{id}/claim",
    scope: { resource: "domains", access: "read" },
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runQuery(internal.api.domains.claimGet, {
        caller,
        id: params.id,
      }),
    }),
  })
  apiRoute(http, {
    method: "POST",
    path: "/domains/{id}/claim/verify",
    scope: { resource: "domains", access: "write" },
    handler: async (ctx, { caller, params }) => ({
      body: await ctx.runMutation(internal.api.domains.claimVerify, {
        caller,
        id: params.id,
      }),
    }),
  })
  const changed = (id: Id<"domains"> | null) => {
    if (!id) throw notFound("Domain")
    return { body: { object: "domain", id } }
  }
  apiRoute(http, {
    method: "GET",
    path: "/domains",
    scope: { resource: "domains", access: "read" },
    handler: async (ctx, { caller, query }) => {
      const page = await ctx.runQuery(internal.api.domains.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: listBody(page, summary),
      }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/domains",
    scope: { resource: "domains", access: "write" },
    handler: async (ctx, { caller, body }) => {
      const input = objectBody(body)
      const domain = await ctx.runMutation(internal.api.domains.create, {
        caller,
        ...capabilities(input),
        tls: enumField(input, "tls", ["opportunistic", "enforced"]),
        name: stringField(input, "name", true)!,
        region: enumField(input, "region", regions),
        customReturnPath:
          stringField(input, "custom_return_path") ?? DEFAULT_RETURN_PATH,
        ...tracking(input),
      })
      return { status: 201, body: detail(domain) }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/domains/{id}",
    scope: { resource: "domains", access: "read" },
    handler: async (ctx, { caller, params }) => {
      const domain = await ctx.runQuery(internal.api.domains.get, {
        caller,
        id: params.id,
      })
      if (!domain) throw notFound("Domain")
      return { body: { object: "domain", ...detail(domain) } }
    },
  })
  apiRoute(http, {
    method: "PATCH",
    path: "/domains/{id}",
    scope: { resource: "domains", access: "write" },
    handler: async (ctx, { caller, params, body }) => {
      const input = objectBody(body)
      const tls = enumField(input, "tls", ["opportunistic", "enforced"])
      return changed(
        await ctx.runMutation(internal.api.domains.change, {
          caller,
          id: params.id,
          action: {
            kind: "update",
            changes: {
              ...capabilities(input),
              ...tracking(input),
              ...(tls ? { tls } : {}),
            },
          },
        })
      )
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/domains/{id}/verify",
    scope: { resource: "domains", access: "write" },
    handler: async (ctx, { caller, params }) =>
      changed(
        await ctx.runMutation(internal.api.domains.change, {
          caller,
          id: params.id,
          action: { kind: "verify" },
        })
      ),
  })
  apiRoute(http, {
    method: "DELETE",
    path: "/domains/{id}",
    scope: { resource: "domains", access: "write" },
    handler: async (ctx, { caller, params }) => {
      const { body } = changed(
        await ctx.runMutation(internal.api.domains.change, {
          caller,
          id: params.id,
          action: { kind: "remove" },
        })
      )
      return { body: { ...body, deleted: true } }
    },
  })
}
