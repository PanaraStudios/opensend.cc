"use node"
import {
  GetReputationEntityCommand,
  UpdateReputationEntityCustomerManagedStatusCommand,
} from "@aws-sdk/client-sesv2"
import { v, ConvexError } from "convex/values"
import { action } from "../_generated/server"
import { internal } from "../_generated/api"
import { requireInstallationAdmin } from "../access"
import { pacedConnection } from "./pacing"
import { awsError } from "./aws"

export const setPaused = action({
  args: { id: v.id("sesTenants"), paused: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, paused }): Promise<null> => {
    await requireInstallationAdmin(ctx)
    const operation = crypto.randomUUID()
    const tenant = await ctx.runMutation(internal.ses.reputation.begin, {
      id,
      operation,
    })
    let sendingStatus = "UNKNOWN"
    let customerSendingStatus: string | undefined
    try {
      const { ses } = await pacedConnection(ctx, tenant.region)
      const entity = {
        ReputationEntityType: "RESOURCE" as const,
        ReputationEntityReference: tenant.arn!,
      }
      await ses.send(
        new UpdateReputationEntityCustomerManagedStatusCommand({
          ...entity,
          SendingStatus: paused ? "DISABLED" : "ENABLED",
        })
      )
      const result = await ses.send(new GetReputationEntityCommand(entity))
      sendingStatus =
        result.ReputationEntity?.SendingStatusAggregate ?? "UNKNOWN"
      customerSendingStatus =
        result.ReputationEntity?.CustomerManagedStatus?.Status
    } catch (error) {
      throw new ConvexError(awsError(error))
    } finally {
      await ctx.runMutation(internal.ses.reputation.finish, {
        id,
        operation,
        generation: tenant.generation,
        sendingStatus,
        customerSendingStatus,
      })
    }
    return null
  },
})
