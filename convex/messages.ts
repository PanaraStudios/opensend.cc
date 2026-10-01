import { CHANNELS, CHANNEL_IDS, type LogChannel } from "../lib/channels"
import { renderedChannelTemplate } from "./channels/templates"
import { channelRows } from "./channels/rows"
import { ConvexError, v } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import {
  mergedStream,
  stream,
  type QueryStream,
} from "convex-helpers/server/stream"
import {
  action,
  query,
  internalQuery,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import schema from "./schema"
import { requireTeam } from "./access"
import { countValue, counters } from "./counts"
import { filteredPage, matchesSearch, readTeamRow } from "./lists"
import { EMAIL_SEARCH_BUDGET, emailRows } from "./emails"
import { EMAIL_STATUSES, emailStatusValue } from "./tables/emails"
import {
  CHANNEL_MESSAGE_STATUSES,
  MESSAGING_CHANNELS,
  channelMessageStatusValue,
  literals,
  renderedTemplateValue,
} from "./tables/channels"
import { mediaDownloadLink } from "./channels/downloads"

/* The Messages section's Sending and Receiving logs: email and channel
   messages in one list, newest first. Without a channel filter the
   tables' streams are merged by creation time, so one cursor pages
   through all of them. */

/** The channels the logs filter by; every channel when left out. */
export const LOG_CHANNELS = CHANNEL_IDS.filter(
  (channel): channel is LogChannel => CHANNELS[channel].supports.logs
)
const logChannelValue = literals(LOG_CHANNELS)
type MessagingChannel = (typeof MESSAGING_CHANNELS)[number]

const logFilters = {
  organizationId: v.string(),
  channel: v.optional(logChannelValue),
  search: v.optional(v.string()),
  from: v.optional(v.number()),
  to: v.optional(v.number()),
}
const sendingFilters = v.object({
  ...logFilters,
  /** An email status, a channel message status, or one both have. */
  status: v.optional(v.union(emailStatusValue, channelMessageStatusValue)),
})
const receivingFilters = v.object(logFilters)

const EMAIL_STATUS_SET: readonly string[] = EMAIL_STATUSES
/** A channel message's statuses once sent; inbound ones are `received`. */
const OUTBOUND_STATUSES = CHANNEL_MESSAGE_STATUSES.filter(
  (status) => status !== "received"
)
const isOutboundStatus = (
  status: string
): status is (typeof OUTBOUND_STATUSES)[number] =>
  (OUTBOUND_STATUSES as readonly string[]).includes(status)

const messagingChannels = (channel: LogChannel | undefined) =>
  MESSAGING_CHANNELS.filter(
    (c): c is MessagingChannel & LogChannel =>
      (LOG_CHANNELS as readonly string[]).includes(c) &&
      (channel === undefined || channel === c)
  )

type FilterArgs = {
  status?: Doc<"channelMessages">["status"]
  from?: number
  to?: number
}

/** One stream as it is, or several merged on creation time. */
function merged<T extends Doc<"emails" | "receivedEmails" | "channelMessages">>(
  streams: QueryStream<T>[]
) {
  return streams.length === 1
    ? streams[0]
    : mergedStream(streams, ["_creationTime"])
}

const isChannelMessage = (
  row: Doc<"emails" | "receivedEmails" | "channelMessages">
): row is Doc<"channelMessages"> => "conversationId" in row

const emptyPage = { page: [], isDone: true, continueCursor: "" }

export const sending = query({
  args: { ...sendingFilters.fields, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.union(
      v.object({ kind: v.literal("email"), email: schema.doc("emails") }),
      v.object({
        kind: v.literal("channel"),
        message: schema.doc("channelMessages"),
      })
    )
  ),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const { organizationId: org, status, channel } = args
    const streams: QueryStream<Doc<"emails" | "channelMessages">>[] = []
    if (
      (channel === undefined || channel === "email") &&
      (status === undefined || EMAIL_STATUS_SET.includes(status))
    )
      streams.push(
        emailRows(ctx, org, {
          ...args,
          status: status as Doc<"emails">["status"] | undefined,
        })
      )
    if (status === undefined || isOutboundStatus(status))
      for (const c of messagingChannels(channel))
        streams.push(
          channelRows(ctx, org, c, {
            direction: "outbound",
            ...args,
            status: status as FilterArgs["status"],
          })
        )
    if (!streams.length) return emptyPage
    const search = args.search?.trim().slice(0, 200)
    const matches = matchesSearch(search)
    const { from = 0, to = Number.MAX_SAFE_INTEGER } = args
    const result = await filteredPage(
      merged(streams),
      args.paginationOpts,
      (row) =>
        row._creationTime >= from &&
        row._creationTime <= to &&
        (isChannelMessage(row)
          ? matches(row.from, row.to, row.preview)
          : matches(row.from, ...row.to, row.subject)),
      EMAIL_SEARCH_BUDGET,
      search
    )
    return {
      ...result,
      page: result.page.map((row) =>
        isChannelMessage(row)
          ? { kind: "channel" as const, message: row }
          : { kind: "email" as const, email: row }
      ),
    }
  },
})

export const sendingCount = query({
  args: sendingFilters.fields,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    if (args.search?.trim()) return { total: null }
    const { organizationId: org, status, channel } = args
    const totals: (number | null)[] = []
    if (
      (channel === undefined || channel === "email") &&
      (status === undefined || EMAIL_STATUS_SET.includes(status))
    )
      totals.push(
        await counters.emails.total(
          ctx,
          org,
          [
            {
              is: status as Doc<"emails">["status"] | undefined,
              among: EMAIL_STATUSES,
            },
          ],
          args
        )
      )
    if (status === undefined || isOutboundStatus(status))
      totals.push(
        await channelTotal(ctx, org, messagingChannels(channel), args, [
          status ?? undefined,
          OUTBOUND_STATUSES,
        ])
      )
    return { total: sum(totals) }
  },
})

export const receiving = query({
  args: { ...receivingFilters.fields, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.union(
      v.object({
        kind: v.literal("email"),
        email: schema.doc("receivedEmails"),
      }),
      v.object({
        kind: v.literal("channel"),
        message: schema.doc("channelMessages"),
        /** The number (Page, account) it arrived on. */
        account: v.string(),
      })
    )
  ),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "read")
    const { organizationId: org, channel } = args
    const { from = 0, to = Number.MAX_SAFE_INTEGER } = args
    const streams: QueryStream<Doc<"receivedEmails" | "channelMessages">>[] = []
    if (channel === undefined || channel === "email")
      streams.push(
        stream(ctx.db, schema)
          .query("receivedEmails")
          .withIndex("by_organizationId", (q) =>
            q
              .eq("organizationId", org)
              .gte("_creationTime", from)
              .lte("_creationTime", to)
          )
          .order("desc")
      )
    for (const c of messagingChannels(channel))
      streams.push(channelRows(ctx, org, c, { ...args, direction: "inbound" }))
    const search = args.search?.trim().slice(0, 200)
    const matches = matchesSearch(search)
    const result = await filteredPage(
      merged(streams),
      args.paginationOpts,
      (row) =>
        isChannelMessage(row)
          ? matches(row.from, row.to, row.preview)
          : matches(row.from, row.subject, ...row.to),
      { rows: 100, bytes: 1024 * 1024 },
      search
    )
    const handles = new Map<Id<"channelAccounts">, string>()
    const page = []
    for (const row of result.page) {
      if (!isChannelMessage(row)) {
        page.push({ kind: "email" as const, email: row })
        continue
      }
      if (!handles.has(row.accountId))
        handles.set(
          row.accountId,
          (await ctx.db.get("channelAccounts", row.accountId))?.handle ?? ""
        )
      page.push({
        kind: "channel" as const,
        message: row,
        account: handles.get(row.accountId)!,
      })
    }
    return { ...result, page }
  },
})

export const receivingCount = query({
  args: receivingFilters.fields,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "read")
    if (args.search?.trim()) return { total: null }
    const { organizationId: org, channel } = args
    const totals: (number | null)[] = []
    if (channel === undefined || channel === "email")
      totals.push(await counters.receivedEmails.total(ctx, org, [], args))
    totals.push(
      await channelTotal(ctx, org, messagingChannels(channel), args, [
        "received",
        CHANNEL_MESSAGE_STATUSES,
      ])
    )
    return { total: sum(totals) }
  },
})

/** Channel messages counted by channel and status, within the range. */
function channelTotal(
  ctx: QueryCtx,
  org: string,
  channels: readonly MessagingChannel[],
  range: { from?: number; to?: number },
  [status, among]: [
    Doc<"channelMessages">["status"] | undefined,
    readonly Doc<"channelMessages">["status"][],
  ]
) {
  if (!channels.length) return 0
  return counters.channelMessages.total(
    ctx,
    org,
    [
      {
        is: channels.length === 1 ? channels[0] : undefined,
        among: channels,
      },
      // Unset, a status counts only among these (sent, or received).
      { is: status, among },
    ],
    // Without a range, the status part still has to be enumerated.
    range.from === undefined && range.to === undefined ? { from: 0 } : range
  )
}
const sum = (totals: (number | null)[]) =>
  totals.some((total) => total === null)
    ? null
    : totals.reduce<number>((a, b) => a + (b ?? 0), 0)

/** A WhatsApp (or later Messenger, Instagram) message with its body and
    timeline, for its detail page. */
export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      message: schema.doc("channelMessages"),
      payload: v.string(),
      rendered: v.optional(renderedTemplateValue),
      media: v.array(
        v.object({
          mediaId: v.optional(v.string()),
          contentType: v.string(),
          filename: v.optional(v.string()),
          size: v.optional(v.number()),
          ready: v.boolean(),
          error: v.optional(v.string()),
        })
      ),
      events: v.array(schema.doc("channelMessageEvents")),
      account: v.union(
        v.null(),
        v.object({ handle: v.string(), displayName: v.string() })
      ),
    })
  ),
  handler: async (ctx, { id }) => {
    const message = await readTeamRow(ctx, "channelMessages", id)
    if (!message) return null
    const content = await ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
      .unique()
    const account = await ctx.db.get("channelAccounts", message.accountId)
    const rendered = await renderedChannelTemplate(
      ctx,
      message,
      content,
      account
    )
    return {
      message,
      ...(rendered ? { rendered } : {}),
      payload: content?.payload ?? "{}",
      media: mediaFiles(message, content),
      events: await ctx.db
        .query("channelMessageEvents")
        .withIndex("by_messageId_and_at", (q) => q.eq("messageId", message._id))
        .take(200),
      account: account
        ? { handle: account.handle, displayName: account.displayName }
        : null,
    }
  },
})

/** A message's files as the dashboard lists them; a file is `ready` to
    download once it is stored (inbound) or was sent from storage. */
export function mediaFiles(
  message: Doc<"channelMessages">,
  content: Doc<"channelMessageContents"> | null
) {
  return (content?.media ?? []).map((file) => ({
    ...(file.mediaId ? { mediaId: file.mediaId } : {}),
    contentType: file.contentType,
    ...(file.filename ? { filename: file.filename } : {}),
    ...(file.size !== undefined ? { size: file.size } : {}),
    ready:
      !!file.mediaId &&
      (!!file.storageId || !!file.fileId || message.direction === "outbound") &&
      !file.error,
    ...(file.error ? { error: file.error } : {}),
  }))
}

/** A signed, hour-long download link for one of a message's files. */
export const mediaLink = action({
  args: { messageId: v.string(), mediaId: v.string() },
  returns: v.string(),
  handler: async (ctx, { messageId, mediaId }): Promise<string> => {
    // Checks the caller's team.
    const found: { message: Doc<"channelMessages"> } | null =
      await ctx.runQuery(internal.messages.mediaMessage, { id: messageId })
    const file = found
      ? await ctx.runQuery(internal.channels.mediaState.file, {
          messageId,
          mediaId,
        })
      : null
    if (!found || !file) throw new ConvexError("The file is not available")
    return (await mediaDownloadLink(ctx, found.message._id, mediaId))
      .download_url
  },
})

/** Download authorization reads only the team row, without hydrating a detail. */
export const mediaMessage = internalQuery({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({ message: schema.doc("channelMessages") })
  ),
  handler: async (ctx, { id }) => {
    const message = await readTeamRow(ctx, "channelMessages", id)
    return message ? { message } : null
  },
})
