"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { authoritativeLookups, lookups } from "./dns"

export const verify = internalAction({
  args: { id: v.id("domainClaims"), checkingAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.runQuery(internal.domainClaims.dnsTarget, args)
    if (!claim) return null
    const recursive = lookups(3000)
    const authoritative = await authoritativeLookups(claim.name, recursive)
    const answers = await Promise.allSettled(
      (authoritative ? [authoritative, recursive] : [recursive]).map(
        (resolver) => resolver.resolveTxt(claim.record.name)
      )
    )
    const matches = answers.some(
      (answer) =>
        answer.status === "fulfilled" &&
        answer.value.some((parts) => parts.join("") === claim.record.value)
    )
    await ctx.runMutation(internal.domainClaims.acceptProof, {
      ...args,
      matches,
      ...(!matches
        ? {
            error:
              "TXT record not found. Check the record and try again after DNS updates.",
          }
        : {}),
    })
    return null
  },
})
