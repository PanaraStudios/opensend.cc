"use node"
import type { ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Infer } from "convex/values"
import { regionValue } from "./contracts"
import { connectionClients } from "./aws"
export function controlPlanePacer(
  ctx: ActionCtx,
  region: Infer<typeof regionValue>
) {
  return async () => {
    const wait = await ctx.runMutation(internal.ses.limits.reserve, { region })
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }
}
/** The installation and its AWS clients for one region, with every SES
    management call paced. */
export async function pacedConnection(
  ctx: ActionCtx,
  region: Infer<typeof regionValue>
) {
  const installation = await ctx.runQuery(internal.installation.connection, {})
  return {
    installation,
    ...connectionClients(installation, region, controlPlanePacer(ctx, region)),
  }
}
