import { v } from "convex/values"
import type { HttpRouter, PaginationOptions } from "convex/server"
import { paginationOptsValidator } from "convex/server"
import {
  mergedStream,
  stream,
  type QueryStream,
} from "convex-helpers/server/stream"
import { internalQuery, type QueryCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import schema from "../schema"
import { emailRows } from "../emails"
import { channelRows } from "../channels/rows"
import { hydratedChannelMessage } from "../channels/payload"
import { emailContact, emailMessageShape } from "../messageShape"
import { teamRow } from "../lists"
import { EMAIL_STATUSES } from "../tables/emails"
import { CHANNEL_MESSAGE_STATUSES } from "../tables/channels"
import {
  callerValue,
  requireCaller,
  lacksPermission,
  invalid,
  notFound,
  type Caller,
} from "./caller"
import {
  apiRoute,
  objectBody,
  objectField,
  stringField,
  enumField,
  arrayField,
  listParams,
} from "./route"
import { sendEmailBody, MAX_SEND_BODY } from "./emails"
import { channelSendInput } from "./channelMessages"

export const MESSAGE_CHANNELS = [
  "email",
  "whatsapp",
  "messenger",
  "instagram",
] as const
const channelValue = v.union(...MESSAGE_CHANNELS.map((c) => v.literal(c)))
type Channel = (typeof MESSAGE_CHANNELS)[number]
type Row = Doc<"emails" | "receivedEmails" | "channelMessages">
const resource = (
  channel: Channel
): "emails" | "whatsapp" | "messenger" | "instagram" =>
  channel === "email" ? "emails" : channel
const readScope = (channel: Channel) => ({
  resource: resource(channel),
  access: "read" as const,
})
const readable = (caller: Caller, channel: Channel) =>
  !lacksPermission(caller, readScope(channel))
const filters = {
  channel: v.optional(channelValue),
  direction: v.optional(v.union(v.literal("inbound"), v.literal("outbound"))),
  status: v.optional(v.string()),
  contact_id: v.optional(v.string()),
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  created_after: v.optional(v.number()),
  created_before: v.optional(v.number()),
}

async function own(
  ctx: QueryCtx,
  caller: Caller,
  id: string
): Promise<Row | null> {
  for (const table of [
    "emails",
    "receivedEmails",
    "channelMessages",
  ] as const) {
    const row = await teamRow(ctx, table, caller.organizationId, id)
    if (row) return row
  }
  return null
}
const rowChannel = (row: Row): Channel =>
  "channel" in row ? row.channel : "email"
const shape = (ctx: QueryCtx, row: Row, now: number) =>
  "channel" in row
    ? hydratedChannelMessage(ctx, row, now)
    : emailMessageShape(ctx, row)

export const get = internalQuery({
  args: { caller: callerValue, id: v.string(), now: v.number() },
  returns: v.union(v.null(), v.record(v.string(), v.any())),
  handler: async (ctx, { caller, id, now }) => {
    await requireCaller(ctx, caller)
    const row = await own(ctx, caller, id)
    if (!row) return null
    await requireCaller(ctx, { ...caller, scope: readScope(rowChannel(row)) })
    return shape(ctx, row, now)
  },
})

export const list = internalQuery({
  args: {
    caller: callerValue,
    ...filters,
    paginationOpts: paginationOptsValidator,
    now: v.number(),
  },
  returns: v.object({
    object: v.literal("list"),
    data: v.array(v.record(v.string(), v.any())),
    has_more: v.boolean(),
    next_cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { caller, paginationOpts, now, ...args }) => {
    await requireCaller(ctx, caller)
    if (args.channel)
      await requireCaller(ctx, { ...caller, scope: readScope(args.channel) })
    const channels = MESSAGE_CHANNELS.filter(
      (c) => (!args.channel || c === args.channel) && readable(caller, c)
    )
    // Bind cursors to filters and readable channels. A cursor never grants access.
    const binding = JSON.stringify([channels, args])
    let cursor = paginationOpts.cursor
    if (cursor) {
      try {
        const decoded = JSON.parse(cursor)
        if (decoded.binding !== binding || typeof decoded.cursor !== "string")
          throw new Error()
        const key = JSON.parse(decoded.cursor)
        if (
          !Array.isArray(key) ||
          key.length < 2 ||
          typeof key.at(-2) !== "number" ||
          !Number.isFinite(key.at(-2)) ||
          typeof key.at(-1) !== "string"
        )
          throw new Error()
        cursor = decoded.cursor
      } catch {
        throw invalid("Invalid message cursor or changed filters/scopes.")
      }
    }
    const range = { from: args.created_after, to: args.created_before }
    const streams: QueryStream<Row>[] = []
    for (const channel of channels) {
      if (channel === "email") {
        if (
          args.direction !== "inbound" &&
          (!args.status ||
            (EMAIL_STATUSES as readonly string[]).includes(args.status))
        )
          streams.push(
            emailRows(ctx, caller.organizationId, {
              ...range,
              status: args.status as Doc<"emails">["status"] | undefined,
            })
          )
        if (
          args.direction !== "outbound" &&
          (!args.status || args.status === "received")
        )
          streams.push(
            stream(ctx.db, schema)
              .query("receivedEmails")
              .withIndex("by_organizationId", (q) =>
                q
                  .eq("organizationId", caller.organizationId)
                  .gte("_creationTime", range.from ?? 0)
                  .lte("_creationTime", range.to ?? Number.MAX_SAFE_INTEGER)
              )
              .order("desc")
          )
      } else if (
        !args.status ||
        (CHANNEL_MESSAGE_STATUSES as readonly string[]).includes(args.status)
      ) {
        // Split directions so every stream orders by creation time even with a status index.
        for (const direction of ["inbound", "outbound"] as const)
          if (!args.direction || args.direction === direction)
            streams.push(
              channelRows(ctx, caller.organizationId, channel, {
                ...range,
                direction,
                status: args.status as
                  Doc<"channelMessages">["status"] | undefined,
              })
            )
      }
    }
    if (!streams.length)
      return {
        object: "list" as const,
        data: [],
        has_more: false,
        next_cursor: null,
      }
    const rows =
      streams.length === 1
        ? streams[0]
        : mergedStream(streams, ["_creationTime"])
    const opts: PaginationOptions = { ...paginationOpts, cursor }
    const result = await rows
      .filterWith(async (row) => {
        if (args.from && row.from !== args.from) return false
        if (
          args.to &&
          (typeof row.to === "string"
            ? row.to !== args.to
            : !row.to.includes(args.to))
        )
          return false
        if (
          args.contact_id &&
          ("channel" in row
            ? ((await ctx.db.get("channelContacts", row.channelContactId))
                ?.contactId ?? null)
            : await emailContact(ctx, row)) !== args.contact_id
        )
          return false
        return true
      })
      .paginate({
        ...opts,
        maximumRowsRead: 200,
        maximumBytesRead: 2 * 1024 * 1024,
      })
    return {
      object: "list" as const,
      data: await Promise.all(result.page.map((row) => shape(ctx, row, now))),
      has_more: !result.isDone,
      next_cursor: result.isDone
        ? null
        : JSON.stringify({ binding, cursor: result.continueCursor }),
    }
  },
})

/** Only adapts the neutral envelope; existing senders validate and persist it. */
export function messageSendBody(body: unknown) {
  const input = objectBody(body)
  const channel = enumField(input, "channel", MESSAGE_CHANNELS)
  if (!channel) throw invalid("The `channel` field is required.")
  if (input.to === undefined) throw invalid("The `to` field is required.")
  const template = objectField(input, "template")
  if (template) {
    const id = stringField(template, "id")
    const alias = stringField(template, "alias")
    if (Number(!!id) + Number(!!alias) !== 1)
      throw invalid("Supply exactly one template `id` or `alias`.")
  }
  const media = arrayField(input, "media")
  const mapped: Record<string, unknown> = { ...input }
  delete mapped.channel
  delete mapped.media
  if (channel === "email") {
    if (template)
      mapped.template = { ...template, id: template.id ?? template.alias }
    if (media.length)
      mapped.attachments = media.map((raw) => {
        const file = objectBody(raw)
        const { type, url, ...fields } = file
        void type
        return { ...fields, ...(url !== undefined ? { path: url } : {}) }
      })
  } else {
    for (const field of ["subject", "html"])
      if (input[field] !== undefined)
        throw invalid(`The \`${field}\` field is only supported for email.`)
    if (
      Number(input.text !== undefined) +
        Number(!!template) +
        Number(media.length > 0) !==
      1
    )
      throw invalid("Supply exactly one `text`, `template`, or `media` body.")
    if (media.length > 1)
      throw invalid("Meta channels support one media item per message.")
    if (input.text !== undefined) {
      const text = stringField(input, "text", true)!
      mapped.text = channel === "whatsapp" ? { body: text } : text
    }
    if (media.length) {
      const file = objectBody(media[0])
      const type = enumField(file, "type", [
        "image",
        "video",
        "audio",
        "file",
      ] as const)
      if (!type)
        throw invalid("Media `type` must be image, video, audio, or file.")
      if (channel === "whatsapp") {
        const key = type === "file" ? "document" : type
        const { type: ignored, url, ...fields } = file
        void ignored
        mapped[key] = { ...fields, ...(url !== undefined ? { link: url } : {}) }
      } else mapped.attachment = file
    }
  }
  return { channel, body: mapped }
}

function selectedChannel(query: URLSearchParams) {
  return enumField(
    { channel: query.get("channel") ?? undefined },
    "channel",
    MESSAGE_CHANNELS
  )
}
export function registerMessageRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/messages",
    scope: "full_access",
    maxBody: MAX_SEND_BODY,
    resolveScopes: ({ body }) => [
      {
        resource: resource(
          enumField(objectBody(body), "channel", MESSAGE_CHANNELS) ?? "email"
        ),
        access: "write",
      },
    ],
    handler: async (ctx, { caller, body }) => {
      const adapted = messageSendBody(body)
      if (adapted.channel === "email")
        return sendEmailBody(ctx, caller, adapted.body)
      const id = await ctx.runMutation(internal.api.channelMessages.send, {
        caller,
        input: channelSendInput(adapted.body, adapted.channel),
      })
      return { body: { id } }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/messages",
    scope: "full_access",
    resolveScopes: ({ query }) => {
      const channel = selectedChannel(query)
      return (channel ? [channel] : MESSAGE_CHANNELS).map(readScope)
    },
    handler: async (ctx, { caller, query }) => {
      const { limit, after, before } = listParams(query)
      if (after || before)
        throw invalid("Use `cursor` for the merged message list.")
      const date = (key: string) => {
        const raw = query.get(key)
        if (raw === null) return undefined
        const ms = Date.parse(raw)
        if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || !Number.isFinite(ms))
          throw invalid(`The \`${key}\` parameter must be an ISO 8601 date.`)
        return ms
      }
      const created_after = date("created_after"),
        created_before = date("created_before")
      if (
        created_after !== undefined &&
        created_before !== undefined &&
        created_after > created_before
      )
        throw invalid("`created_after` must be before `created_before`.")
      return {
        body: await ctx.runQuery(internal.api.messages.list, {
          caller,
          channel: selectedChannel(query),
          direction: enumField(
            { direction: query.get("direction") ?? undefined },
            "direction",
            ["inbound", "outbound"] as const
          ),
          status: enumField(
            { status: query.get("status") ?? undefined },
            "status",
            [...EMAIL_STATUSES, ...CHANNEL_MESSAGE_STATUSES]
          ),
          contact_id: query.get("contact_id") ?? undefined,
          from: query.get("from") ?? undefined,
          to: query.get("to") ?? undefined,
          created_after,
          created_before,
          paginationOpts: { numItems: limit, cursor: query.get("cursor") },
          now: Date.now(),
        }),
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/messages/{id}",
    scope: "full_access",
    resolveScopes: () => MESSAGE_CHANNELS.map(readScope),
    handler: async (ctx, { caller, params }) => {
      const body = await ctx.runQuery(internal.api.messages.get, {
        caller,
        id: params.id,
        now: Date.now(),
      })
      if (!body) throw notFound("Message")
      return { body }
    },
  })
}
