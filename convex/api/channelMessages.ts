import { CHANNELS, PAGE_CHANNELS } from "../../lib/channels"
import { teamRow } from "../lists"
import {
  findChannelAccount,
  createChannelMessage,
  channelInputValue,
} from "../channels/messages"
import { assertChannelSendingKey } from "./whatsapp"
import { idempotent } from "./idempotency"
import { channelRows } from "../channels/rows"
import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import { stream } from "convex-helpers/server/stream"
import {
  internalQuery,
  internalMutation,
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
import {
  channelMessagePayload,
  hydratedChannelMessage,
} from "../channels/payload"
import { mediaDownloadLink } from "../channels/downloads"
import {
  callerValue,
  requireCaller,
  notFound,
  invalid,
  apiError,
  type Caller,
} from "./caller"
import {
  apiRoute,
  listParams,
  listBody,
  enumField,
  objectBody,
  stringField,
  arrayField,
  type ApiRouteOptions,
} from "./route"
import { listArgs, cursorPage } from "./paging"
import { WHATSAPP_SEND_TYPES } from "../../lib/meta/payloads"
import { object } from "../../lib/meta/webhooks"
import { CHANNEL_MESSAGE_STATUSES, DIRECTIONS } from "../tables/channels"

type Channel = Doc<"channelMessages">["channel"]
async function ownMessage(
  ctx: QueryCtx,
  caller: Caller,
  channel: Channel,
  id: string
) {
  return teamRow(ctx, "channelMessages", caller.organizationId, id, {
    keep: (row) => row.channel === channel,
  })
}
async function ownConversation(
  ctx: QueryCtx,
  caller: Caller,
  channel: Channel,
  id: string
) {
  return teamRow(ctx, "conversations", caller.organizationId, id, {
    keep: (row) => row.channel === channel,
  })
}
export const get = internalQuery({
  args: {
    caller: callerValue,
    channel: messagingChannelValue,
    id: v.string(),
    now: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      message: schema.doc("channelMessages"),
      content: v.union(v.null(), schema.doc("channelMessageContents")),
      events: v.array(schema.doc("channelMessageEvents")),
      normalized: v.record(v.string(), v.any()),
    })
  ),
  handler: async (ctx, { caller, channel, id, now }) => {
    await requireCaller(ctx, caller)
    const message = await ownMessage(ctx, caller, channel, id)
    if (!message) return null
    return {
      normalized: await hydratedChannelMessage(
        ctx,
        message,
        now ?? message._creationTime
      ),
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
    now: v.optional(v.number()),
  },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("channelMessages")),
    normalized: v.array(v.record(v.string(), v.any())),
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
      now,
      ...page
    }
  ) => {
    await requireCaller(ctx, caller)
    const account = phoneNumberId
      ? await findAccount(ctx, caller, channel, phoneNumberId)
      : null
    if (phoneNumberId && !account) throw notFound(CHANNELS[channel].accountNoun)
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
    const result = await cursorPage(
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
        return channelRows(
          ctx,
          caller.organizationId,
          channel,
          { accountId: account?._id, status, direction },
          order
        )
      }
    )
    return {
      ...result,
      normalized: await Promise.all(
        result.data.map((m) =>
          hydratedChannelMessage(ctx, m, now ?? m._creationTime)
        )
      ),
    }
  },
})
async function findAccount(
  ctx: QueryCtx,
  caller: Caller,
  channel: Channel,
  id: string
) {
  return findChannelAccount(ctx, caller.organizationId, id, channel)
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
const accountPayload = (
  account: Omit<Doc<"channelAccounts">, "encryptedToken">
) => {
  const definition: {
    accountFields: Record<string, string>
    accountDefaults: Record<string, unknown>
  } = CHANNELS[account.channel]
  // The legacy Page contract tolerates rows created before pageId was stored.
  const values = {
    ...account,
    pageId: account.pageId ?? account.externalId,
  } as Record<string, unknown>
  return {
    id: account._id,
    ...Object.fromEntries(
      Object.entries(definition.accountFields).map(([name, field]) => [
        name,
        values[field] ?? definition.accountDefaults[name],
      ])
    ),
    status: account.status,
    created_at: new Date(account._creationTime).toISOString(),
  }
}
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
    const definition = CHANNELS[channel]
    const accountResource = definition.resource
    if (adapters.send)
      apiRoute(http, {
        method: "POST",
        path: `${prefix}/messages`,
        scope: { resource: channel, access: "write" },
        handler: adapters.send,
      })
    if (adapters.media)
      apiRoute(http, {
        method: "POST",
        path: `${prefix}/media`,
        scope: { resource: channel, access: "write" },
        bodyFormat: "multipart-binary",
        maxBody: adapters.media.maxBody,
        handler: adapters.media.handler,
      })
    for (const read of [true, false]) {
      apiRoute(http, {
        method: "POST",
        path: read
          ? `${prefix}/messages/{id}/read`
          : `${prefix}/conversations/{id}/typing`,
        scope: { resource: channel, access: "write" },
        handler: async (ctx, { caller, params, body }) => {
          const input = objectBody(body)
          const field = read ? "typing" : "on"
          const value = input[field]
          if ((!read || value !== undefined) && typeof value !== "boolean")
            throw invalid(`The \`${field}\` field must be a boolean.`)
          const job = await ctx.runMutation(
            internal.channels.controls.prepare,
            {
              caller,
              channel,
              id: params.id,
              read,
              ...(typeof value === "boolean" ? { typing: value } : {}),
            }
          )
          if (!job) return { status: 202, body: { id: params.id } }
          const result = await ctx.runAction(
            internal.channels.controlActions.send,
            job
          )
          if (result.error) throw apiError(502, "meta_api_error", result.error)
          return { body: { id: params.id } }
        },
      })
    }
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/messages`,
      scope: { resource: channel, access: "read" },
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
          now: Date.now(),
          status: enumField(filters, "status", CHANNEL_MESSAGE_STATUSES),
          direction: enumField(filters, "direction", DIRECTIONS),
          phoneNumberId: query.get(definition.idParam) ?? undefined,
        })
        return {
          body: listBody({ ...result, data: result.normalized }, (m) => m),
        }
      },
    })
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/messages/{id}`,
      scope: { resource: channel, access: "read" },
      handler: async (ctx, { caller, params }) => ({
        body: await detail(ctx, caller, channel, params.id),
      }),
    })
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/${accountResource}`,
      scope: { resource: channel, access: "read" },
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
      path: `${prefix}/${accountResource}/{id}`,
      scope: { resource: channel, access: "read" },
      handler: async (ctx, { caller, params }) => {
        const result = await ctx.runQuery(
          internal.api.channelMessages.accounts,
          { caller, channel, limit: 1, id: params.id }
        )
        if (!result.data[0]) throw notFound(CHANNELS[channel].accountNoun)
        return { body: accountPayload(result.data[0]) }
      },
    })
    apiRoute(http, {
      method: "GET",
      path: `${prefix}/conversations`,
      scope: { resource: channel, access: "read" },
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
      scope: { resource: channel, access: "read" },
      handler: async (ctx, { caller, query, params }) => {
        const result = await ctx.runQuery(internal.api.channelMessages.list, {
          caller,
          channel,
          ...listParams(query),
          conversationId: params.id,
          now: Date.now(),
        })
        return {
          body: listBody({ ...result, data: result.normalized }, (m) => m),
        }
      },
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
    now: Date.now(),
  })
  if (!result) throw notFound("Message")
  const payload = result.content
    ? object(JSON.parse(result.content.payload))
    : {}
  return {
    ...channelMessagePayload(result.message, payload),
    ...result.normalized,
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
          (file.storageId ||
            file.fileId ||
            result.message.direction === "outbound")
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

/** Shared REST envelope parsing; adapters retain only their wire fields. */
export function channelSendInput(body: unknown, channel: Channel) {
  const input = objectBody(body)
  const tags = arrayField(input, "tags").map((raw) => {
    const tag = objectBody(raw)
    return {
      name: stringField(tag, "name", true)!,
      value: stringField(tag, "value", true)!,
    }
  })
  const fields =
    channel === "whatsapp"
      ? [
          ...WHATSAPP_SEND_TYPES,
          "recipient",
          "context",
          "biz_opaque_callback_data",
        ]
      : ["text", "attachment", "template", "quick_replies", "tag"]
  const messageBody = Object.fromEntries(
    fields
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]])
  )
  if (channel === "whatsapp") {
    const type = enumField(input, "type", WHATSAPP_SEND_TYPES)
    if (type) messageBody.type = type
  }
  return {
    channel,
    from: stringField(input, "from"),
    to: stringField(
      input,
      "to",
      channel !== "whatsapp" || input.recipient === undefined
    ),
    body: messageBody,
    replyTo:
      stringField(input, "reply_to") ??
      (channel === "whatsapp" && input.context
        ? stringField(objectBody(input.context), "message_id", true)
        : undefined),
    tags,
  }
}

/** Page channels share the established sending mutation, idempotency and routes. */
export function registerPageMessageRoutes(http: HttpRouter) {
  for (const channel of PAGE_CHANNELS)
    channelMessageRoutes(channel)(http, {
      send: async (ctx, { caller, body }) => {
        const id = await ctx.runMutation(internal.api.channelMessages.send, {
          caller,
          input: channelSendInput(body, channel),
        })
        return { body: { id } }
      },
    })
}

/** Shared sending entry point for every messaging channel. */
export const send = internalMutation({
  args: { caller: callerValue, input: channelInputValue },
  returns: v.id("channelMessages"),
  handler: async (ctx, { caller, input }) => {
    await requireCaller(ctx, caller, "sending")
    assertChannelSendingKey(caller)
    return idempotent(
      ctx,
      caller,
      () =>
        createChannelMessage(ctx, input, {
          organizationId: caller.organizationId,
          source: "api",
          apiKeyId: caller.apiKeyId,
        }),
      (id) => ({ body: { id } })
    )
  },
})
