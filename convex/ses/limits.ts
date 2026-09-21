import { RateLimiter } from "@convex-dev/rate-limiter"
import { components } from "../_generated/api"
import { internalMutation } from "../_generated/server"
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
})
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
