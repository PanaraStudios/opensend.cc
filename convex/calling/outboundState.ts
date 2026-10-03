import { actorArgs } from "./actor"
import { findStep, resolveValue } from "../../lib/dashboard/automation"
import { readGraph } from "../automationDefinition"
import { v } from "convex/values"
import { RateLimiter, DAY } from "@convex-dev/rate-limiter"
import { components } from "../_generated/api"
import {
  internalQuery,
  internalMutation,
  query,
  type QueryCtx,
} from "../_generated/server"
import { authorize, resolveIdentity } from "./rows"
import {
  channelAccountAccess,
  createChannelMessage,
} from "../channels/messages"
import { apiError, invalid, notFound } from "../api/caller"
import { idempotent } from "../api/idempotency"
import type { Id } from "../_generated/dataModel"
import { toWaId } from "../../lib/dashboard/phone"
import { permissionAllows } from "../../lib/meta/softphone"

// Fence concurrent queued requests before Meta has observed the first send.
// Meta's live actions/limits remain authoritative for the seven-day and call quotas.
export const permissionLimiter = new RateLimiter(components.rateLimiter, {
  callPermissionRequest: {
    kind: "token bucket",
    rate: 1,
    period: DAY,
    capacity: 1,
  },
})
export const permissionLimitKey = (accountId: string, identity: string) =>
  `${accountId}:${identity}`
const recipientArgs = {
  ...actorArgs,
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  recipient: v.optional(v.string()),
  contactId: v.optional(v.string()),
}
async function recipient(
  ctx: QueryCtx,
  args: {
    organizationId: string
    caller?: typeof actorArgs.caller.type
    automationRunId?: Id<"automationRuns">
    from?: string
    to?: string
    recipient?: string
    contactId?: string
  }
) {
  await authorize(ctx, args)
  const { account } = await channelAccountAccess(
    ctx,
    args.organizationId,
    args.from,
    "whatsapp"
  )
  const contactId =
    args.contactId ??
    (args.to && ctx.db.normalizeId("contacts", args.to)) ??
    undefined
  let to = args.to
  let userId = args.recipient
  if (contactId) {
    const id = ctx.db.normalizeId("contacts", contactId)
    const contact = id ? await ctx.db.get("contacts", id) : null
    if (contact?.organizationId !== args.organizationId)
      throw notFound("Contact")
    to = contact.phone
    if (!to) {
      const connection = await ctx.db.get(
        "metaConnections",
        account.connectionId
      )
      const identities = await ctx.db
        .query("channelContacts")
        .withIndex("by_contactId", (q) => q.eq("contactId", contact._id))
        .take(100)
      for (const identity of identities) {
        if (
          identity.organizationId !== args.organizationId ||
          identity.channel !== "whatsapp" ||
          identity.mergedIntoId
        )
          continue
        const alias = connection
          ? await ctx.db
              .query("whatsappUserAliases")
              .withIndex("by_channelContactId_and_businessId", (q) =>
                q
                  .eq("channelContactId", identity._id)
                  .eq("businessId", connection.businessId)
              )
              .unique()
          : null
        userId =
          alias?.userId ??
          (identity.userScopeId === connection?.businessId
            ? identity.userId
            : undefined)
        if (userId) break
      }
    }
  }
  const resolved = await resolveIdentity(ctx, account, to, userId)
  return {
    from: account._id,
    ...(resolved.phone ? { to: toWaId(resolved.phone) } : {}),
    ...(resolved.userId ? { recipient: resolved.userId } : {}),
  }
}
export const resolve = internalQuery({
  args: recipientArgs,
  returns: v.object({
    from: v.id("channelAccounts"),
    to: v.optional(v.string()),
    recipient: v.optional(v.string()),
  }),
  handler: recipient,
})
export const request = internalMutation({
  args: {
    ...recipientArgs,
    identity: v.string(),
    placeResponse: v.optional(v.record(v.string(), v.any())),
    text: v.optional(v.string()),
    template: v.optional(v.record(v.string(), v.any())),
  },
  returns: v.object({ id: v.id("channelMessages") }),
  handler: async (ctx, args) => {
    await authorize(ctx, args, true)
    const target = await recipient(ctx, args)
    const work = async () => {
      const key = permissionLimitKey(target.from, args.identity)
      const limit = await permissionLimiter.limit(
        ctx,
        "callPermissionRequest",
        { key }
      )
      if (!limit.ok)
        throw apiError(
          429,
          "permission_request_limit",
          "A calling permission request is already queued. Wait before requesting again."
        )
      const text = args.text ?? "May we call you on WhatsApp?"
      if (!text.trim() || text.length > 1024)
        throw invalid(
          "Permission request text must contain 1–1,024 characters."
        )
      const id = await createChannelMessage(
        ctx,
        {
          channel: "whatsapp",
          from: target.from,
          to: target.recipient ? undefined : target.to,
          body: {
            ...(target.recipient ? { recipient: target.recipient } : {}),
            ...(args.template
              ? { template: args.template }
              : {
                  interactive: {
                    type: "call_permission_request",
                    action: { name: "call_permission_request" },
                    body: { text },
                  },
                }),
          },
        },
        {
          organizationId: args.organizationId,
          source: args.automationRunId
            ? "automation"
            : args.caller
              ? "api"
              : "dashboard",
          ...(args.automationRunId
            ? { automationRunId: args.automationRunId }
            : {}),
        }
      )
      const previous = await ctx.db
        .query("callPermissions")
        .withIndex("by_accountId_and_identity", (q) =>
          q.eq("accountId", target.from).eq("identity", args.identity)
        )
        .unique()
      if (
        previous &&
        !permissionAllows(
          { permission: JSON.parse(previous.data).permission },
          "start_call"
        )
      ) {
        await ctx.db.patch("callPermissions", previous._id, {
          status: "pending",
          expiresAt: undefined,
          observedAt: Math.floor(Date.now() / 1000) * 1000,
          data: JSON.stringify({
            permission: { status: "pending" },
            actions: [
              {
                action_name: "send_call_permission_request",
                can_perform_action: false,
              },
            ],
          }),
        })
      }
      return { id }
    }
    return args.caller
      ? idempotent(ctx, args.caller, work, (result) => ({
          body: args.placeResponse
            ? { ...args.placeResponse, permission_request_id: result.id }
            : result,
        }))
      : work()
  },
})
export const cachedPermission = query({
  args: {
    organizationId: v.string(),
    from: v.string(),
    to: v.optional(v.string()),
    recipient: v.optional(v.string()),
    contactId: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const target = await recipient(ctx, args)
    const identity = target.recipient ?? target.to!
    const row = await ctx.db
      .query("callPermissions")
      .withIndex("by_accountId_and_identity", (q) =>
        q.eq("accountId", target.from).eq("identity", identity)
      )
      .unique()
    const status =
      row &&
      row.status !== "permanent" &&
      row.expiresAt != null &&
      row.expiresAt <= args.now
        ? "expired"
        : (row?.status ?? "unknown")
    const data = row
      ? (JSON.parse(row.data) as Record<string, unknown>)
      : { permission: { status } }
    return {
      status,
      expires_at: row?.expiresAt ?? null,
      observed_at: row?.observedAt ?? null,
      can_call: permissionAllows(data, "start_call", args.now),
      can_request: permissionAllows(
        data,
        "send_call_permission_request",
        args.now
      ),
    }
  },
})

export const automationInput = internalQuery({
  args: { id: v.id("automationRuns"), key: v.string() },
  returns: v.any(),
  handler: async (ctx, { id, key }) => {
    const run = await ctx.db.get("automationRuns", id)
    if (!run) throw notFound("Automation run")
    await authorize(
      ctx,
      { organizationId: run.organizationId, automationRunId: id },
      true
    )
    const step = findStep(readGraph(run.graph), key)
    if (step?.type !== "place_call") throw invalid("Place call step not found.")
    const contact = run.contactId
      ? await ctx.db.get("contacts", run.contactId)
      : null
    if (!contact || contact.unsubscribed)
      return {
        skipped: true,
        reason: contact
          ? "unsubscribed"
          : run.contactId
            ? "contact_deleted"
            : "no_contact",
      }
    const scope = {
      event: run.payload,
      contact: {
        id: contact._id,
        first_name: contact.firstName,
        last_name: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        properties: contact.properties,
      },
    }
    return {
      organizationId: run.organizationId,
      input: {
        contact_id: contact._id,
        from: step.accountId,
        route: step.route,
        context: String(resolveValue(scope, step.purpose)),
        variables: Object.fromEntries(
          Object.entries(step.variables).map(([key, value]) => [
            key,
            String(resolveValue(scope, value)),
          ])
        ),
        request_permission: step.requestPermission,
      },
    }
  },
})
