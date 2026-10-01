import { ConvexError, v } from "convex/values"
import { action } from "../_generated/server"

// Wave 5B contract placeholders. Lane 5A replaces this module at integration.
const connectedAccounts = v.object({
  accounts: v.array(
    v.object({
      id: v.id("channelAccounts"),
      channel: v.union(v.literal("messenger"), v.literal("instagram")),
      handle: v.string(),
    })
  ),
})
export const connectFacebookLogin = action({
  args: { organizationId: v.string(), code: v.string() },
  returns: connectedAccounts,
  handler: async (): Promise<typeof connectedAccounts.type> => {
    throw new ConvexError("Not implemented")
  },
})
export const connectPageManual = action({
  args: { organizationId: v.string(), pageId: v.string(), token: v.string() },
  returns: connectedAccounts,
  handler: async (): Promise<typeof connectedAccounts.type> => {
    throw new ConvexError("Not implemented")
  },
})
