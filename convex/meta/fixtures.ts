import { v } from "convex/values"
import { env, internalMutation } from "../_generated/server"
import { requireFakeGraph } from "../../lib/meta/graph-url"
import { patchRow } from "../counts"

/** Closes a thread's customer service window, as 24 quiet hours would. */
export const expireWindow = internalMutation({
  args: { conversationId: v.id("conversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    requireFakeGraph(env.META_GRAPH_ORIGIN)
    // Past the dashboard clock's 30-second tick, so it shows at once.
    await patchRow(ctx, "conversations", conversationId, {
      windowExpiresAt: Date.now() - 5 * 60_000,
    })
    return null
  },
})
