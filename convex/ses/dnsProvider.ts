"use node"
import { v } from "convex/values"
import { action } from "../_generated/server"
import { internal } from "../_generated/api"
import { detectDnsProvider } from "./dns"

export const inspect = action({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const lookup = await ctx.runMutation(
      internal.domains.claimDnsProviderLookup,
      { id }
    )
    if (!lookup) return null
    const provider = await detectDnsProvider(lookup.name)
    await ctx.runMutation(internal.domains.saveDnsProvider, {
      id,
      requestedAt: lookup.requestedAt,
      provider,
    })
    return null
  },
})
