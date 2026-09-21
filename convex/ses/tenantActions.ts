"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { awsError, connectionClients } from "./aws"
import { controlPlanePacer } from "./pacing"
import { provisionTenant, removeTenant } from "./tenantProvider"
export const run = internalAction({
  args: { tenantId: v.id("sesTenants"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.tenants.get, { id: args.tenantId })
    if (
      !row ||
      row.deleted ||
      row.generation !== args.generation ||
      row.phase !== "running"
    )
      return null
    try {
      const installation = await ctx.runQuery(
        internal.installation.connection,
        {}
      )
      const { ses } = connectionClients(
        installation,
        row.region,
        controlPlanePacer(ctx, row.region)
      )
      if (row.operation === "remove") {
        await removeTenant(ses, installation, row)
        await ctx.runMutation(internal.tenants.finish, {
          id: row._id,
          generation: args.generation,
          removed: true,
        })
      } else {
        const tenant = await provisionTenant(ses, installation, row)
        await ctx.runMutation(internal.tenants.finish, {
          id: row._id,
          generation: args.generation,
          arn: tenant.TenantArn,
          providerId: tenant.TenantId,
          sendingStatus: tenant.SendingStatus ?? "UNKNOWN",
        })
      }
    } catch (error) {
      await ctx.runMutation(internal.tenants.finish, {
        id: row._id,
        generation: args.generation,
        error: awsError(error),
      })
    }
    return null
  },
})
