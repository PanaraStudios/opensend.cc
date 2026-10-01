import { stream } from "convex-helpers/server/stream"
import schema from "../schema"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Id, Doc } from "../_generated/dataModel"

/** Deletes a channel message's content and its stored media. */
export async function deleteChannelMessageContent(
  ctx: MutationCtx,
  id: Id<"channelMessages">
) {
  const content = await ctx.db
    .query("channelMessageContents")
    .withIndex("by_messageId", (q) => q.eq("messageId", id))
    .unique()
  if (!content) return
  for (const media of content.media ?? [])
    if (media.storageId) await ctx.storage.delete(media.storageId)
  await ctx.db.delete("channelMessageContents", content._id)
}

/** Pick by account/status, then constrain direction on that same index. */
export function channelRows(
  ctx: QueryCtx,
  organizationId: string,
  channel: Doc<"channelMessages">["channel"],
  filters: {
    accountId?: Id<"channelAccounts">
    status?: Doc<"channelMessages">["status"]
    direction?: Doc<"channelMessages">["direction"]
    from?: number
    to?: number
  } = {},
  order: "asc" | "desc" = "desc"
) {
  const {
    accountId,
    status,
    direction,
    from = 0,
    to = Number.MAX_SAFE_INTEGER,
  } = filters
  const base = stream(ctx.db, schema).query("channelMessages")
  const rows = accountId
    ? status
      ? base.withIndex("by_team_channel_account_status_direction", (q) => {
          const range = q
            .eq("organizationId", organizationId)
            .eq("channel", channel)
            .eq("accountId", accountId)
            .eq("status", status)
          return direction
            ? range
                .eq("direction", direction)
                .gte("_creationTime", from)
                .lte("_creationTime", to)
            : range
        })
      : base.withIndex("by_team_channel_account_direction", (q) => {
          const range = q
            .eq("organizationId", organizationId)
            .eq("channel", channel)
            .eq("accountId", accountId)
          return direction
            ? range
                .eq("direction", direction)
                .gte("_creationTime", from)
                .lte("_creationTime", to)
            : range
        })
    : status
      ? base.withIndex("by_team_channel_status_direction", (q) => {
          const range = q
            .eq("organizationId", organizationId)
            .eq("channel", channel)
            .eq("status", status)
          return direction
            ? range
                .eq("direction", direction)
                .gte("_creationTime", from)
                .lte("_creationTime", to)
            : range
        })
      : direction
        ? base.withIndex("by_team_channel_direction", (q) =>
            q
              .eq("organizationId", organizationId)
              .eq("channel", channel)
              .eq("direction", direction)
              .gte("_creationTime", from)
              .lte("_creationTime", to)
          )
        : base.withIndex("by_organizationId_and_channel", (q) =>
            q
              .eq("organizationId", organizationId)
              .eq("channel", channel)
              .gte("_creationTime", from)
              .lte("_creationTime", to)
          )
  return rows.order(order)
}
