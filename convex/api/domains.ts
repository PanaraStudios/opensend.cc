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
import {
  apiError,
  callerValue,
  notFound,
  requireCaller,
  type Caller,
} from "./caller"
import { cursorPage, listArgs } from "./paging"
import {
  apiRoute,
  apiTime,
  booleanField,
  enumField,
  listParams,
  objectBody,
  stringField,
} from "./route"

/** A live domain of the caller's team, or null. */
async function own(ctx: QueryCtx, caller: Caller, id: string) {
  const domainId = ctx.db.normalizeId("domains", id)
  const domain = domainId ? await ctx.db.get("domains", domainId) : null
  return domain &&
    !domain.deleted &&
    domain.organizationId === caller.organizationId
    ? domain
    : null
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
      async (id) => (await own(ctx, caller, id))?._creationTime ?? null,
      (bound, order, count) =>
        ctx.db
          .query("domains")
          .withIndex("by_organizationId_and_deleted", (q) => {
            const scope = q.eq("organizationId", org).eq("deleted", false)
            return bound.lt !== undefined
              ? scope.lt("_creationTime", bound.lt)
              : bound.gt !== undefined
                ? scope.gt("_creationTime", bound.gt)
                : scope
          })
          .order(order)
          .take(count)
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
      (row) => ({ body: detail(row) })
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
  const changed = (id: Id<"domains"> | null) => {
    if (!id) throw notFound("Domain")
    return { body: { object: "domain", id } }
  }
  apiRoute(http, {
    method: "GET",
    path: "/domains",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const page = await ctx.runQuery(internal.api.domains.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: {
          object: "list",
          has_more: page.has_more,
          data: page.data.map(summary),
        },
      }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/domains",
    permission: "full_access",
    handler: async (ctx, { caller, body }) => {
      const input = objectBody(body)
      /* A new domain always starts sending with opportunistic TLS and no
         receiving; other settings wait until it is provisioned. */
      const wanted = capabilities(input)
      if (
        enumField(input, "tls", ["opportunistic", "enforced"]) === "enforced" ||
        wanted.receiving ||
        wanted.sending === false
      )
        throw apiError(
          422,
          "validation_error",
          "Create the domain first, then change `tls` or `capabilities` with PATCH once it is provisioned."
        )
      const domain = await ctx.runMutation(internal.api.domains.create, {
        caller,
        name: stringField(input, "name", true)!,
        region: enumField(input, "region", regions),
        customReturnPath:
          stringField(input, "custom_return_path") ?? DEFAULT_RETURN_PATH,
        ...tracking(input),
      })
      return { body: detail(domain) }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/domains/{id}",
    permission: "full_access",
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
    permission: "full_access",
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
    permission: "full_access",
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
    permission: "full_access",
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
