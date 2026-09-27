"use node"
import { v } from "convex/values"
import { action } from "../_generated/server"
import { internal } from "../_generated/api"
import { detectDnsProvider } from "./dns"
import { discover } from "./domainConnect"

export const inspect = action({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const lookup = await ctx.runMutation(
      internal.domains.claimDnsProviderLookup,
      { id }
    )
    if (!lookup) return null
    const [provider, domainConnect] = await Promise.all([
      detectDnsProvider(lookup.name),
      discover(lookup.name),
    ])
    await ctx.runMutation(internal.domains.saveDnsProvider, {
      id,
      requestedAt: lookup.requestedAt,
      provider,
      domainConnect,
    })
    return null
  },
})
