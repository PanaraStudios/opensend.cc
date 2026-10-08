import { stream } from "convex-helpers/server/stream"
import { pastKey } from "../../lib/stream-bounds"
import { idempotent } from "./idempotency"
import { v, type Infer } from "convex/values"
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
import {
  apiError,
  callerValue,
  notFound,
  requireCaller,
  invalid,
  requireTeamRow,
} from "./caller"
import { cursorPage, listArgs } from "./paging"
import {
  listBody,
  apiRoute,
  apiTime,
  enumField,
  listParams,
  objectBody,
  stringField,
  stringListField,
} from "./route"
import { parseScheduledAt } from "../../lib/dashboard/email-send"

function own(ctx: QueryCtx, organizationId: string, value: string) {
  return requireTeamRow(ctx, "broadcasts", organizationId, value, "Broadcast")
}
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
  const replyToAddresses = stringListField(input, "reply_to", {
    rejectNull: true,
    message: "Invalid `reply_to` field.",
  })
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
          return await own(ctx, caller.organizationId, value)
        } catch {
          return null
        }
      },
      (order) =>
        stream(ctx.db, schema)
          .query("broadcasts")
          .withIndex("by_organizationId", (q) => {
            return q.eq("organizationId", caller.organizationId)
          })
          .order(order)
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
const recipientType = v.union(
  ...[
    "sent",
    "delivered",
    "opened",
    "clicked",
    "bounced",
    "complained",
    "unsubscribed",
    "suppressed",
  ].map(v.literal)
)
const recipientView = v.object({
  id: v.string(),
  contact_id: v.union(v.string(), v.null()),
  email: v.string(),
  count: v.optional(v.number()),
  bounce_type: v.optional(v.string()),
  clicked_links: v.optional(
    v.array(v.object({ url: v.string(), clicks: v.number() }))
  ),
})
export const recipientPage = internalQuery({
  args: {
    caller: callerValue,
    id: v.string(),
    type: recipientType,
    email: v.optional(v.string()),
    bounceType: v.optional(v.string()),
    cursor: v.optional(v.string()),
    before: v.boolean(),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    done: v.boolean(),
    cursor: v.optional(v.string()),
    data: v.array(recipientView),
  }),
  handler: async (
    ctx,
    { caller, id, type, email, bounceType, cursor, before, limit = 100 }
  ) => {
    await requireCaller(ctx, caller)
    const broadcast = await own(ctx, caller.organizationId, id)
    const table = type === "sent" ? "broadcastRecipients" : "broadcastEvents"
    const anchorId = cursor ? ctx.db.normalizeId(table, cursor) : null
    const anchor = anchorId ? await ctx.db.get(table, anchorId) : null
    if (
      cursor &&
      (!anchor ||
        anchor.broadcastId !== broadcast._id ||
        ("type" in anchor ? anchor.type !== type : !anchor.sent))
    )
      throw invalid("Invalid recipient cursor.")
    const order = before ? ("asc" as const) : ("desc" as const)
    const source =
      type === "sent"
        ? stream(ctx.db, schema)
            .query("broadcastRecipients")
            .withIndex("by_broadcastId_and_sent", (q) =>
              q.eq("broadcastId", broadcast._id).eq("sent", true)
            )
            .order(order)
        : stream(ctx.db, schema)
            .query("broadcastEvents")
            .withIndex("by_broadcastId_and_type", (q) =>
              q.eq("broadcastId", broadcast._id).eq("type", type)
            )
            .order(order)
    const bounded = anchor
      ? source.narrow(
          pastKey(
            [
              broadcast._id,
              type === "sent" ? true : type,
              anchor._creationTime,
              anchor._id,
            ],
            before
          )
        )
      : source
    // Each transaction reads at most 100 candidates; the action fills filtered pages.
    const rows = await bounded.take(100)
    const data: Infer<typeof recipientView>[] = []
    for (const row of rows) {
      if (email && !row.email.toLowerCase().includes(email.toLowerCase()))
        continue
      const classification =
        "bounceType" in row
          ? (row.bounceType ?? "undetermined")
          : "undetermined"
      if (bounceType && classification !== bounceType) continue
      if (data.length >= limit) break
      const contact = await ctx.db
        .query("contacts")
        .withIndex("by_organizationId_and_email", (q) =>
          q.eq("organizationId", caller.organizationId).eq("email", row.email)
        )
        .unique()
      const item: Infer<typeof recipientView> = {
        id: row._id,
        contact_id: contact?._id ?? null,
        email: row.email,
      }
      if (type === "opened" || type === "clicked")
        item.count = "count" in row ? (row.count ?? 1) : 1
      if (type === "bounced") item.bounce_type = classification
      data.push(item)
    }
    return { done: rows.length < 100, cursor: rows.at(-1)?._id, data }
  },
})
export const recipientLinks = internalQuery({
  args: { caller: callerValue, broadcastId: v.string(), id: v.string() },
  returns: v.array(v.object({ url: v.string(), clicks: v.number() })),
  handler: async (ctx, { caller, broadcastId, id }) => {
    await requireCaller(ctx, caller)
    const broadcast = await own(ctx, caller.organizationId, broadcastId)
    const eventId = ctx.db.normalizeId("broadcastEvents", id)
    const event = eventId ? await ctx.db.get("broadcastEvents", eventId) : null
    if (
      !event ||
      event.broadcastId !== broadcast._id ||
      event.type !== "clicked"
    )
      throw notFound("Recipient")
    const links = await ctx.db
      .query("broadcastRecipientLinks")
      .withIndex("by_emailId_and_linkId", (q) => q.eq("emailId", event.emailId))
      .take(1000)
    const data = []
    for (const entry of links) {
      const link = await ctx.db.get("broadcastLinks", entry.linkId)
      if (link) data.push({ url: link.url, clicks: entry.clicks })
    }
    return data
  },
})

export const clickedLinks = internalQuery({
  args: { caller: callerValue, id: v.string(), ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(
      v.object({
        id: v.string(),
        url: v.string(),
        clicks: v.number(),
        unique_clicks: v.number(),
      })
    ),
  }),
  handler: async (ctx, { caller, id, limit, after, before }) => {
    await requireCaller(ctx, caller)
    const broadcast = await own(ctx, caller.organizationId, id)
    const cursor = after ?? before
    const anchorId = cursor
      ? ctx.db.normalizeId("broadcastLinks", cursor)
      : null
    const anchor = anchorId
      ? await ctx.db.get("broadcastLinks", anchorId)
      : null
    if (cursor && anchor?.broadcastId !== broadcast._id)
      throw invalid("Invalid clicked-link cursor.")
    const source = stream(ctx.db, schema)
      .query("broadcastLinks")
      .withIndex("by_broadcastId_and_clicks", (q) =>
        q.eq("broadcastId", broadcast._id)
      )
      .order(before ? "asc" : "desc")
    const rows = await (
      anchor
        ? source.narrow(
            pastKey(
              [broadcast._id, anchor.clicks, anchor._creationTime, anchor._id],
              !!before
            )
          )
        : source
    ).take(limit + 1)
    const page = rows.slice(0, limit)
    if (before) page.reverse()
    return {
      has_more: rows.length > limit,
      data: page.map((row) => ({
        id: row._id,
        url: row.url,
        clicks: row.clicks,
        unique_clicks: row.uniqueClicks,
      })),
    }
  },
})

export const create = internalMutation({
  args: { caller: callerValue, body: v.string() },
  returns: v.id("broadcasts"),
  handler: async (ctx, { caller, body }): Promise<Doc<"broadcasts">["_id"]> => {
    return idempotent(
      ctx,
      caller,
      async () => {
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
      (id) => ({ status: 201, body: { object: "broadcast", id } })
    )
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
    return idempotent(
      ctx,
      caller,
      async () => {
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
      (id) => ({
        status: kind === "duplicate" ? 201 : 200,
        body: kind === "send" ? { id } : { object: "broadcast", id },
      })
    )
  },
})
function summary(row: Doc<"broadcasts">) {
  return {
    id: row._id,
    name: row.name,
    topic_id: row.topicId,
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
    path: "/broadcasts/{id}/recipients",
    permission: "full_access",
    handler: async (ctx, { caller, params, query }) => {
      const type = enumField({ type: query.get("type") }, "type", [
        "sent",
        "delivered",
        "opened",
        "clicked",
        "bounced",
        "complained",
        "unsubscribed",
        "suppressed",
      ])
      if (!type)
        throw apiError(
          422,
          "missing_required_field",
          "Missing `type` parameter."
        )
      const bounceType = enumField(
        { bounce_type: query.get("bounce_type") },
        "bounce_type",
        ["permanent", "transient", "undetermined"]
      )
      if (bounceType && type !== "bounced")
        throw invalid("The `bounce_type` filter requires type=bounced.")
      const { limit, after, before } = listParams(query)
      const data: Infer<typeof recipientView>[] = []
      let cursor = before ?? after
      while (data.length <= limit) {
        const page = await ctx.runQuery(internal.api.broadcasts.recipientPage, {
          caller,
          id: params.id,
          type,
          email: query.get("email") ?? undefined,
          bounceType,
          cursor,
          before: !!before,
          limit: limit + 1 - data.length,
        })
        data.push(...page.data)
        if (page.done) break
        cursor = page.cursor
      }
      const selected = data.slice(0, limit)
      if (before) selected.reverse()
      // Hydrate each message in its own bounded transaction.
      if (type === "clicked")
        await Promise.all(
          selected.map(async (recipient) => {
            recipient.clicked_links = await ctx.runQuery(
              internal.api.broadcasts.recipientLinks,
              { caller, broadcastId: params.id, id: recipient.id }
            )
          })
        )
      return {
        body: { object: "list", has_more: data.length > limit, data: selected },
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/broadcasts/{id}/clicked-links",
    permission: "full_access",
    handler: async (ctx, { caller, params, query }) => ({
      body: {
        object: "list",
        ...(await ctx.runQuery(internal.api.broadcasts.clickedLinks, {
          caller,
          id: params.id,
          ...listParams(query),
        })),
      },
    }),
  })
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
        body: listBody(result, summary),
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
          reply_to:
            row.replyToAddresses ?? (row.replyTo ? [row.replyTo] : null),
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
      status: 201,
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
        status: kind === "duplicate" ? 201 : 200,
        body: {
          ...(kind === "send" ? {} : { object: "broadcast" }),
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
