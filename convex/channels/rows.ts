import type { MutationCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"

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
