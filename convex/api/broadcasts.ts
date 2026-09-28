import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import { toPlainText } from "@react-email/render"
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import schema from "../schema"
import {
  insertBroadcast,
  updateBroadcast,
  removeBroadcast,
  duplicateBroadcast,
  sendBroadcast,
  cancelBroadcast,
  draft,
  type BroadcastInput,
} from "../broadcasts"
import { apiError, callerValue, notFound, requireCaller } from "./caller"
import { cursorPage, listArgs } from "./paging"
import { apiRoute, apiTime, listParams, objectBody, stringField } from "./route"
import { parseScheduledAt } from "../../lib/dashboard/email-send"

async function own(ctx: QueryCtx, organizationId: string, value: string) {
  const id = ctx.db.normalizeId("broadcasts", value)
  const row = id ? await ctx.db.get("broadcasts", id) : null
  if (!row || row.organizationId !== organizationId) throw notFound("Broadcast")
  return row
}
const invalid = (message: string) => apiError(422, "validation_error", message)
function inputFields(
  ctx: QueryCtx,
  input: Record<string, unknown>,
  required = false
): BroadcastInput {
  const segment = input.segment_id ?? input.audience_id
  const segmentId =
    segment == null
      ? null
      : typeof segment === "string"
        ? ctx.db.normalizeId("segments", segment)
        : null
  const topicId =
    input.topic_id == null
      ? null
      : typeof input.topic_id === "string"
        ? ctx.db.normalizeId("topics", input.topic_id)
        : null
  if (segment != null && !segmentId)
    throw invalid("Invalid `segment_id` field.")
  if (input.topic_id != null && !topicId)
    throw invalid("Invalid `topic_id` field.")
  let replyToAddresses: string[] | undefined
  if (input.reply_to !== undefined) {
    if (typeof input.reply_to === "string") replyToAddresses = [input.reply_to]
    else if (
      Array.isArray(input.reply_to) &&
      input.reply_to.every((v): v is string => typeof v === "string")
    )
      replyToAddresses = input.reply_to
    else throw invalid("Invalid `reply_to` field.")
  }
  const result = {
    name: stringField(input, "name"),
    from: stringField(input, "from", required),
    subject: stringField(input, "subject", required),
    html: stringField(input, "html"),
    text: stringField(input, "text"),
    preview: stringField(input, "preview_text"),
    ...(input.html !== undefined ? { content: null } : {}),
    ...(required || "segment_id" in input || "audience_id" in input
      ? { segmentId }
      : {}),
    ...(required || "topic_id" in input ? { topicId } : {}),
    ...(replyToAddresses
      ? { replyToAddresses, replyTo: replyToAddresses[0] ?? "" }
      : {}),
  }
  if (required && !result.html && !result.text)
    throw invalid("Missing `html` or `text` field.")
  return result
}
function scheduled(input: Record<string, unknown>) {
  const raw = stringField(input, "scheduled_at")
  const at = raw === undefined ? undefined : parseScheduledAt(raw, Date.now())
  if (at === null)
    throw invalid(
      "Invalid `scheduled_at` field. Use an ISO 8601 date or natural language like `in 1 min`."
    )
  return at
}
export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("broadcasts")),
  }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    return cursorPage(
      page,
      async (value) => {
        try {
          return (await own(ctx, caller.organizationId, value))._creationTime
        } catch {
          return null
        }
      },
      (bound, order, count) =>
        ctx.db
          .query("broadcasts")
          .withIndex("by_organizationId", (q) => {
            const scope = q.eq("organizationId", caller.organizationId)
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
  returns: v.object({
    row: schema.doc("broadcasts"),
    body: v.union(schema.doc("broadcastDrafts"), v.null()),
  }),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    const row = await own(ctx, caller.organizationId, id)
    return { row, body: await draft(ctx, row._id) }
  },
})
export const create = internalMutation({
  args: { caller: callerValue, body: v.string() },
  returns: v.id("broadcasts"),
  handler: async (ctx, { caller, body }): Promise<Doc<"broadcasts">["_id"]> => {
    await requireCaller(ctx, caller)
    const input = objectBody(JSON.parse(body))
    if (input.send !== undefined && typeof input.send !== "boolean")
      throw invalid("Invalid `send` field.")
    const id = await insertBroadcast(
      ctx,
      caller.organizationId,
      inputFields(ctx, input, true)
    )
    if (input.send)
      await sendBroadcast(
        ctx,
        (await ctx.db.get("broadcasts", id))!,
        scheduled(input)
      )
    return id
  },
})
export const change = internalMutation({
  args: {
    caller: callerValue,
    id: v.string(),
    kind: v.union(
      v.literal("update"),
      v.literal("remove"),
      v.literal("send"),
      v.literal("cancel"),
      v.literal("duplicate")
    ),
    body: v.string(),
  },
  returns: v.id("broadcasts"),
  handler: async (
    ctx,
    { caller, id, kind, body }
  ): Promise<Doc<"broadcasts">["_id"]> => {
    await requireCaller(ctx, caller)
    const row = await own(ctx, caller.organizationId, id)
    const input = objectBody(JSON.parse(body))
    if (kind === "update")
      await updateBroadcast(ctx, row, inputFields(ctx, input))
    if (kind === "remove") await removeBroadcast(ctx, row)
    if (kind === "send") await sendBroadcast(ctx, row, scheduled(input))
    if (kind === "cancel") await cancelBroadcast(ctx, row)
    if (kind === "duplicate") return duplicateBroadcast(ctx, row)
    return row._id
  },
})
function summary(row: Doc<"broadcasts">) {
  return {
    id: row._id,
    name: row.name,
    segment_id: row.segmentId,
    audience_id: row.segmentId,
    status: row.status,
    created_at: apiTime(row._creationTime),
    scheduled_at: row.scheduledAt ? apiTime(row.scheduledAt) : null,
    sent_at: row.sentAt ? apiTime(row.sentAt) : null,
  }
}
export function registerBroadcastRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/broadcasts",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const result = await ctx.runQuery(internal.api.broadcasts.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: {
          object: "list",
          has_more: result.has_more,
          data: result.data.map(summary),
        },
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/broadcasts/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params }) => {
      const { row, body } = await ctx.runQuery(internal.api.broadcasts.get, {
        caller,
        id: params.id,
      })
      return {
        body: {
          object: "broadcast",
          ...summary(row),
          from: row.from ?? null,
          subject: row.subject,
          reply_to: row.replyToAddresses ?? row.replyTo ?? null,
          preview_text: row.preview,
          html: body?.html ?? "",
          text: body?.text ?? toPlainText(body?.html ?? ""),
          topic_id: row.topicId,
        },
      }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/broadcasts",
    permission: "full_access",
    handler: async (ctx, { caller, body }) => ({
      body: {
        object: "broadcast",
        id: await ctx.runMutation(internal.api.broadcasts.create, {
          caller,
          body: JSON.stringify(body ?? {}),
        }),
      },
    }),
  })
  for (const kind of [
    "update",
    "remove",
    "send",
    "cancel",
    "duplicate",
  ] as const)
    apiRoute(http, {
      method:
        kind === "update" ? "PATCH" : kind === "remove" ? "DELETE" : "POST",
      path: `/broadcasts/{id}${["send", "cancel", "duplicate"].includes(kind) ? `/${kind}` : ""}`,
      permission: "full_access",
      handler: async (ctx, { caller, params, body }) => ({
        body: {
          object: "broadcast",
          id: await ctx.runMutation(internal.api.broadcasts.change, {
            caller,
            id: params.id,
            kind,
            body: JSON.stringify(body ?? {}),
          }),
          ...(kind === "remove" ? { deleted: true } : {}),
        },
      }),
    })
}
