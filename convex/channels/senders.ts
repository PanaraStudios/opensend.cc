import { v } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import {
  mergedStream,
  stream,
  type QueryStream,
} from "convex-helpers/server/stream"
import { query, type QueryCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import schema from "../schema"
import { requireTeam } from "../access"
import { countValue, counters } from "../counts"
import { filteredPage, matchesSearch } from "../lists"
import { channelValue } from "../tables/channels"
import { accountValue, publicAccount } from "../meta/connect"
import { MESSAGING_CHANNELS, type Channel } from "../../lib/channels"

/* The Channels page: a team's email domains and its WhatsApp numbers,
   Pages and Instagram accounts in one list, newest first. Each table is one
   bounded index stream; without a channel filter the two are merged on
   creation time, so one cursor pages through both, as Messages does. */

const senderFilters = {
  organizationId: v.string(),
  channel: v.optional(channelValue),
  search: v.optional(v.string()),
}

export const SENDER_SEARCH_BUDGET = { rows: 512, bytes: 4 * 1024 * 1024 }

type SenderRow = Doc<"domains"> | Doc<"channelAccounts">
const isDomain = (row: SenderRow): row is Doc<"domains"> => "records" in row

function senderRows(ctx: QueryCtx, organizationId: string, channel?: Channel) {
  const streams: QueryStream<SenderRow>[] = []
  const rows = stream(ctx.db, schema)
  if (channel === undefined || channel === "email")
    streams.push(
      rows
        .query("domains")
        .withIndex("by_organizationId_and_deleted", (q) =>
          q.eq("organizationId", organizationId).eq("deleted", false)
        )
        .order("desc")
    )
  if (channel !== "email")
    streams.push(
      (channel
        ? rows
            .query("channelAccounts")
            .withIndex(
              "by_organizationId_and_channel_and_disconnectedAt",
              (q) =>
                q
                  .eq("organizationId", organizationId)
                  .eq("channel", channel)
                  .eq("disconnectedAt", undefined)
            )
        : rows
            .query("channelAccounts")
            .withIndex("by_organizationId_and_disconnectedAt", (q) =>
              q
                .eq("organizationId", organizationId)
                .eq("disconnectedAt", undefined)
            )
      ).order("desc")
    )
  return streams.length === 1
    ? streams[0]
    : mergedStream(streams, ["_creationTime"])
}

export const list = query({
  args: { ...senderFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.union(
      v.object({ kind: v.literal("domain"), domain: schema.doc("domains") }),
      v.object({ kind: v.literal("account"), account: accountValue })
    )
  ),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const search = args.search?.trim().slice(0, 253)
    const matches = matchesSearch(search)
    const result = await filteredPage(
      senderRows(ctx, args.organizationId, args.channel),
      args.paginationOpts,
      (row) =>
        isDomain(row)
          ? matches(row.name)
          : matches(row.displayName, row.handle),
      SENDER_SEARCH_BUDGET,
      search
    )
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (row) =>
          isDomain(row)
            ? { kind: "domain" as const, domain: row }
            : {
                kind: "account" as const,
                account: await publicAccount(ctx, row),
              }
        )
      ),
    }
  },
})

export const count = query({
  args: senderFilters,
  returns: countValue,
  handler: async (ctx, { organizationId, channel, search }) => {
    await requireTeam(ctx, organizationId)
    if (search?.trim()) return { total: null }
    const domains =
      channel === undefined || channel === "email"
        ? await counters.domains.total(ctx, organizationId)
        : 0
    const accounts =
      channel === "email"
        ? 0
        : await counters.channelAccounts.total(ctx, organizationId, [
            { is: channel, among: MESSAGING_CHANNELS },
          ])
    return {
      total: domains === null || accounts === null ? null : domains + accounts,
    }
  },
})
