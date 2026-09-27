import { RateLimiter } from "@convex-dev/rate-limiter"
import { components } from "../_generated/api"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { v, ConvexError } from "convex/values"
import { regionValue } from "./contracts"
const limiter = new RateLimiter(components.rateLimiter, {
  sesManagement: {
    kind: "token bucket",
    rate: 1,
    period: 1100,
    capacity: 1,
    maxReserved: 30,
  },
  // One manual status check per domain at a time, however often it is asked.
  domainCheck: { kind: "token bucket", rate: 1, period: 10000, capacity: 1 },
})
export async function limitDomainCheck(
  ctx: MutationCtx,
  domainId: Id<"domains">
) {
  const result = await limiter.limit(ctx, "domainCheck", { key: domainId })
  if (!result.ok)
    throw new ConvexError(
      `Checked just now. Try again in ${Math.ceil(result.retryAfter / 1000)} seconds.`
    )
}
export const reserve = internalMutation({
  args: { region: regionValue },
  returns: v.number(),
  handler: async (ctx, { region }) => {
    const result = await limiter.limit(ctx, "sesManagement", {
      key: region,
      reserve: true,
    })
    if (!result.ok)
      throw new ConvexError("AWS setup is busy. Please retry shortly.")
    return Math.ceil(result.retryAfter ?? 0)
  },
})
