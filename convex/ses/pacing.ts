"use node"
import type { ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Infer } from "convex/values"
import { regionValue } from "./contracts"
export function controlPlanePacer(
  ctx: ActionCtx,
  region: Infer<typeof regionValue>
) {
  return async () => {
    const wait = await ctx.runMutation(internal.ses.limits.reserve, { region })
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }
}
