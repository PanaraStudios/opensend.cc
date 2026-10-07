"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { connectionClients } from "./aws"
import { confirmSubscription, parseSns, verifySns } from "./sns"
export const receive = internalAction({
  args: { body: v.string() },
  returns: v.null(),
  handler: async (ctx, { body }) => {
    const message = parseSns(body)
    const region = await ctx.runQuery(internal.ses.state.topic, {
      arn: message.TopicArn,
    })
    if (!region) throw new Error("Unknown SNS topic")
    if (!(await verifySns(message))) return null
    if (message.Type === "SubscriptionConfirmation") {
      const installation = await ctx.runQuery(
        internal.installation.connection,
        {}
      )
      const { sns } = connectionClients(installation, region.region)
      const subscriptionArn = await confirmSubscription(
        sns,
        message,
        `${installation.callbackOrigin}/ses/events`
      )
      await ctx.runMutation(internal.ses.state.patchRegion, {
        id: region._id,
        changes: { callbackConfirmed: true, subscriptionArn },
      })
    } else {
      await ctx.runMutation(internal.ses.state.ingest, {
        topicArn: message.TopicArn,
        messageId: message.MessageId,
        message: message.Message,
      })
    }
    return null
  },
})
