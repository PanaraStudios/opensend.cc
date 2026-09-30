import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import { stream } from "convex-helpers/server/stream"
import {
  internalQuery,
  type QueryCtx,
  type ActionCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import schema from "../schema"
import {
  channelMessageStatusValue,
  directionValue,
  messagingChannelValue,
} from "../tables/channels"
import { channelMessagePayload } from "../channels/payload"
import { mediaDownloadLink } from "../channels/downloads"
import { live } from "../meta/connect"
import { callerValue, requireCaller, notFound, type Caller } from "./caller"
import {
  apiRoute,
  listParams,
  listBody,
  enumField,
  type ApiRouteOptions,
} from "./route"
import { listArgs, cursorPage } from "./paging"
import { object } from "../../lib/meta/webhooks"
import { CHANNEL_MESSAGE_STATUSES, DIRECTIONS } from "../tables/channels"

type Channel = Doc<"channelMessages">["channel"]
async function ownMessage(
  ctx: QueryCtx,
  caller: Caller,
  channel: Channel,
  id: string
) {
  const key = ctx.db.normalizeId("channelMessages", id)
  const row = key ? await ctx.db.get("channelMessages", key) : null
  return row?.organizationId === caller.organizationId &&
    row.channel === channel
    ? row
    : null
}
async function ownConversation(
  ctx: QueryCtx,
  caller: Caller,
  channel: Channel,
  id: string
) {
  const key = ctx.db.normalizeId("conversations", id)
  const row = key ? await ctx.db.get("conversations", key) : null
  return row?.organizationId === caller.organizationId &&
    row.channel === channel
    ? row
    : null
}
export const get = internalQuery({
  args: { caller: callerValue, channel: messagingChannelValue, id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      message: schema.doc("channelMessages"),
      content: v.union(v.null(), schema.doc("channelMessageContents")),
      events: v.array(schema.doc("channelMessageEvents")),
    })
  ),
  handler: async (ctx, { caller, channel, id }) => {
    await requireCaller(ctx, caller)
    const message = await ownMessage(ctx, caller, channel, id)
    if (!message) return null
    return {
      message,
      content: await ctx.db
        .query("channelMessageContents")
        .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
        .unique(),
      events: await ctx.db
        .query("channelMessageEvents")
        .withIndex("by_messageId_and_at", (q) => q.eq("messageId", message._id))
        .order("asc")
        .take(200),
    }
  },
})
export const list = internalQuery({
  args: {
    caller: callerValue,
    channel: messagingChannelValue,
    ...listArgs,
    status: v.optional(channelMessageStatusValue),
    direction: v.optional(directionValue),
    phoneNumberId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
  },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("channelMessages")),
  }),
  handler: async (
    ctx,
    {
      caller,
      channel,
      status,
      direction,
      phoneNumberId,
      conversationId,
      ...page
    }
  ) => {
    await requireCaller(ctx, caller)
    const account = phoneNumberId
      ? await findAccount(ctx, caller, channel, phoneNumberId)
      : null
    if (phoneNumberId && !account) throw notFound("Phone number")
    const conversation = conversationId
      ? await ownConversation(ctx, caller, channel, conversationId)
      : null
    if (conversationId && !conversation) throw notFound("Conversation")
    const matches = (row: Doc<"channelMessages"> | null) =>
      row &&
      (!status || row.status === status) &&
      (!direction || row.direction === direction) &&
      (!account || row.accountId === account._id) &&
      (!conversation || row.conversationId === conversation._id)
    return cursorPage(
      page,
      async (id) => {
        const row = await ownMessage(ctx, caller, channel, id)
        return matches(row) ? row : null
      },
      (order) => {
        const base = stream(ctx.db, schema).query("channelMessages")
        if (conversation)
          return base
            .withIndex("by_conversationId", (q) =>
              q.eq("conversationId", conversation._id)
            )
            .order(order)
        const org = caller.organizationId
        if (account) {
          if (status && direction)
            return base
              .withIndex("by_team_channel_account_status_direction", (q) =>
                q
                  .eq("organizationId", org)
                  .eq("channel", channel)
                  .eq("accountId", account._id)
                  .eq("status", status)
                  .eq("direction", direction)
              )
              .order(order)
          if (status)
            return base
              .withIndex("by_team_channel_account_status_direction", (q) =>
                q
                  .eq("organizationId", org)
                  .eq("channel", channel)
                  .eq("accountId", account._id)
                  .eq("status", status)
              )
              .order(order)
          if (direction)
            return base
              .withIndex("by_team_channel_account_direction", (q) =>
                q
                  .eq("organizationId", org)
                  .eq("channel", channel)
                  .eq("accountId", account._id)
                  .eq("direction", direction)
              )
              .order(order)
          return base
            .withIndex("by_team_channel_account_direction", (q) =>
              q
                .eq("organizationId", org)
                .eq("channel", channel)
                .eq("accountId", account._id)
            )
            .order(order)
        }
        if (status && direction)
          return base
            .withIndex("by_team_channel_status_direction", (q) =>
              q
                .eq("organizationId", org)
                .eq("channel", channel)
                .eq("status", status)
                .eq("direction", direction)
            )
            .order(order)
        if (status)
          return base
            .withIndex("by_team_channel_status_direction", (q) =>
              q
                .eq("organizationId", org)
                .eq("channel", channel)
                .eq("status", status)
            )
            .order(order)
        if (direction)
          return base
            .withIndex("by_team_channel_direction", (q) =>
              q
                .eq("organizationId", org)
                .eq("channel", channel)
                .eq("direction", direction)
            )
            .order(order)
        return base
          .withIndex("by_organizationId_and_channel", (q) =>
            q.eq("organizationId", org).eq("channel", channel)
          )
          .order(order)
      }
    )
  },
})
async function findAccount(
  ctx: QueryCtx,
  caller: Caller,
  channel: Channel,
  id: string
) {
  const key = ctx.db.normalizeId("channelAccounts", id)
  const row = key
    ? await ctx.db.get("channelAccounts", key)
    : ((
        await ctx.db
          .query("channelAccounts")
          .withIndex("by_channel_and_externalId", (q) =>
            q.eq("channel", channel).eq("externalId", id)
          )
          .take(20)
      ).find((a) => a.organizationId === caller.organizationId && live(a)) ??
      null)
  return row?.organizationId === caller.organizationId &&
    row.channel === channel &&
    live(row)
    ? row
    : null
}
export const accounts = internalQuery({
  args: {
    caller: callerValue,
    channel: messagingChannelValue,
    ...listArgs,
    id: v.optional(v.string()),
  },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("channelAccounts").omit("encryptedToken")),
  }),
  handler: async (ctx, { caller, channel, id, ...page }) => {
    await requireCaller(ctx, caller)
    const result = id
      ? {
          has_more: false,
          data: [await findAccount(ctx, caller, channel, id)].filter(
            (a): a is Doc<"channelAccounts"> => a !== null
          ),
        }
      : await cursorPage(
          page,
          (id) => findAccount(ctx, caller, channel, id),
          (order) =>
            stream(ctx.db, schema)
              .query("channelAccounts")
              .withIndex(
                "by_organizationId_and_channel_and_disconnectedAt",
                (q) =>
                  q
                    .eq("organizationId", caller.organizationId)
                    .eq("channel", channel)
                    .eq("disconnectedAt", undefined)
              )
              .order(order)
        )
    return {
      ...result,
      data: result.data.map(({ encryptedToken: secret, ...row }) => {
        void secret
        return row
      }),
    }
  },
})
export const conversations = internalQuery({
  args: { caller: callerValue, channel: messagingChannelValue, ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("conversations")),
  }),
  handler: async (ctx, { caller, channel, ...page }) => {
    await requireCaller(ctx, caller)
    return cursorPage(
      page,
      (id) => ownConversation(ctx, caller, channel, id),
      (order) =>
        stream(ctx.db, schema)
          .query("conversations")
          .withIndex("by_organizationId_and_channel_and_lastMessageAt", (q) =>
            q.eq("organizationId", caller.organizationId).eq("channel", channel)
          )
          .order(order)
    )
  },
})
const accountPayload = (a: Omit<Doc<"channelAccounts">, "encryptedToken">) => ({
  id: a._id,
  phone_number_id: a.externalId,
  display_phone_number: a.handle,
  verified_name: a.displayName,
  status: a.status,
  quality: a.quality ?? "unknown",
  throughput: a.throughputMps,
  messaging_limit: a.messagingLimit ?? null,
  waba_id: a.wabaId ?? null,
  created_at: new Date(a._creationTime).toISOString(),
})
const conversationPayload = (c: Doc<"conversations">) => ({
  id: c._id,
  channel: c.channel,
  account_id: c.accountId ?? null,
  channel_contact_id: c.channelContactId ?? null,
  contact_id: c.contactId ?? null,
  status: c.status,
  last_message_at: new Date(c.lastMessageAt).toISOString(),
  last_preview: c.lastPreview,
  last_direction: c.lastDirection,
  window_expires_at: c.windowExpiresAt
    ? new Date(c.windowExpiresAt).toISOString()
    : null,
  unread: c.unread,
})

/** Shared routes. Channel adapters supply their send/media handlers without
 * copying pagination, isolation, timeline or signed-download behavior. */
export function channelMessageRoutes(channel: Channel) {
  return (
    http: HttpRouter,
    adapters: {
      send?: ApiRouteOptions["handler"]
      media?: { handler: ApiRouteOptions["handler"]; maxBody: number }
    } = {}
  ) => {
    const prefix = `/${channel}`
    if (adapters.send)
      apiRoute(http, {
        method: "POST",
        path: `${prefix}/messages`,
        permission: "sending",
        handler: adapters.send,
      })
    if (adapters.media)
      apiRoute(http, {
        method: "POST",
        path: `${prefix}/media`,
        permission: "sending",
        bodyFormat: "multipart-binary",
        maxBody: adapters.media.maxBody,
        handler: adapters.media.handler,
      })
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/messages`,
      permission: "full_access",
      handler: async (ctx, { caller, query }) => {
        const filters = Object.fromEntries(
          ["status", "direction"].map((key) => [
            key,
            query.get(key) ?? undefined,
          ])
        )
        const result = await ctx.runQuery(internal.api.channelMessages.list, {
          caller,
          channel,
          ...listParams(query),
          status: enumField(filters, "status", CHANNEL_MESSAGE_STATUSES),
          direction: enumField(filters, "direction", DIRECTIONS),
          phoneNumberId: query.get("phone_number_id") ?? undefined,
        })
        return { body: listBody(result, (m) => channelMessagePayload(m)) }
      },
    })
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/messages/{id}`,
      permission: "full_access",
      handler: async (ctx, { caller, params }) => ({
        body: await detail(ctx, caller, channel, params.id),
      }),
    })
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/phone-numbers`,
      permission: "full_access",
      handler: async (ctx, { caller, query }) => ({
        body: listBody(
          await ctx.runQuery(internal.api.channelMessages.accounts, {
            caller,
            channel,
            ...listParams(query),
          }),
          accountPayload
        ),
      }),
    })
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/phone-numbers/{id}`,
      permission: "full_access",
      handler: async (ctx, { caller, params }) => {
        const result = await ctx.runQuery(
          internal.api.channelMessages.accounts,
          { caller, channel, limit: 1, id: params.id }
        )
        if (!result.data[0]) throw notFound("Phone number")
        return { body: accountPayload(result.data[0]) }
      },
    })
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/conversations`,
      permission: "full_access",
      handler: async (ctx, { caller, query }) => ({
        body: listBody(
          await ctx.runQuery(internal.api.channelMessages.conversations, {
            caller,
            channel,
            ...listParams(query),
          }),
          conversationPayload
        ),
      }),
    })
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/conversations/{id}/messages`,
      permission: "full_access",
      handler: async (ctx, { caller, query, params }) => ({
        body: listBody(
          await ctx.runQuery(internal.api.channelMessages.list, {
            caller,
            channel,
            ...listParams(query),
            conversationId: params.id,
          }),
          (m) => channelMessagePayload(m)
        ),
      }),
    })
  }
}
async function detail(
  ctx: ActionCtx,
  caller: Caller,
  channel: Channel,
  id: string
): Promise<unknown> {
  const result = await ctx.runQuery(internal.api.channelMessages.get, {
    caller,
    channel,
    id,
  })
  if (!result) throw notFound("Message")
  const payload = result.content
    ? object(JSON.parse(result.content.payload))
    : {}
  return {
    ...channelMessagePayload(result.message, payload),
    last_event: result.message.status,
    events: result.events.map((e) => ({
      type: e.type,
      created_at: new Date(e.at).toISOString(),
      details: e.details ? JSON.parse(e.details) : null,
    })),
    media: await Promise.all(
      (result.content?.media ?? []).map(async (file) => {
        const link =
          file.mediaId &&
          (file.storageId || result.message.direction === "outbound")
            ? await mediaDownloadLink(ctx, result.message._id, file.mediaId)
            : null
        return {
          id: file.mediaId ?? null,
          content_type: file.contentType,
          filename: file.filename ?? null,
          size: file.size ?? null,
          download_url: link?.download_url ?? null,
          expires_at: link?.expires_at ?? null,
          error: file.error ?? null,
        }
      })
    ),
  }
}
