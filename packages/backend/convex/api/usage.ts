import type { HttpRouter } from "convex/server"
import { internal } from "../_generated/api"
import { internalQuery } from "../_generated/server"
import { readUsage, usageValue } from "../usage"
import { callerValue, requireCaller } from "./caller"
import { apiRoute } from "./route"

export const get = internalQuery({
  args: { caller: callerValue },
  returns: usageValue,
  handler: async (ctx, { caller }) => {
    await requireCaller(ctx, caller)
    return (await readUsage(ctx, caller.organizationId)).usage
  },
})

export function registerUsageRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/usage",
    scope: "full_access",
    handler: async (ctx, { caller }) => ({
      body: await ctx.runQuery(internal.api.usage.get, { caller }),
    }),
  })
}
