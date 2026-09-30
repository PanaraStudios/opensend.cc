"use node"
import { v } from "convex/values"
import { GetEmailIdentityCommand } from "@aws-sdk/client-sesv2"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { assertOwned, awsError } from "./aws"
import { pacedConnection } from "./pacing"
import { verificationState } from "./dns"

/** A domain's status check: one paced SES read and its DNS lookups. It never
    changes AWS, so it can run as often as the schedule asks. */
export const run = internalAction({
  args: { domainId: v.id("domains"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { domainId, attempt }) => {
    const domain = await ctx.runQuery(internal.domains.checkTarget, {
      id: domainId,
    })
    if (!domain) return null
    let result
    try {
      const { installation, ses } = await pacedConnection(ctx, domain.region)
      const identity = await ses.send(
        new GetEmailIdentityCommand({ EmailIdentity: domain.name })
      )
      assertOwned(identity.Tags, installation._id, domainId)
      result = await verificationState(
        identity,
        domain,
        installation.callbackOrigin
      )
    } catch (e) {
      result = { error: awsError(e) }
    }
    await ctx.runMutation(internal.domains.saveCheck, {
      id: domainId,
      attempt,
      checkedAt: domain.checkedAt,
      result,
    })
    return null
  },
})
