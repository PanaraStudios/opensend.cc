"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import {
  ConfirmSubscriptionCommand,
  GetSubscriptionAttributesCommand,
} from "@aws-sdk/client-sns"
import { connectionClients } from "./aws"
import { certificateUrl, limitedBody, parseSns, verifySignature } from "./sns"
export const receive = internalAction({
  args: { body: v.string() },
  returns: v.null(),
  handler: async (ctx, { body }) => {
    const message = parseSns(body)
    const region = await ctx.runQuery(internal.ses.state.topic, {
      arn: message.TopicArn,
    })
    if (!region) throw new Error("Unknown SNS topic")
    const response = await fetch(certificateUrl(message), {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error("Unable to fetch SNS certificate")
    verifySignature(message, await limitedBody(response, 32768))
    if (message.Type === "SubscriptionConfirmation") {
      const installation = await ctx.runQuery(
        internal.installation.connection,
        {}
      )
      const { sns } = connectionClients(installation, region.region)
      // Never follow a SubscribeURL supplied in the request.
      const confirmed = await sns.send(
        new ConfirmSubscriptionCommand({
          TopicArn: message.TopicArn,
          Token: message.Token,
          AuthenticateOnUnsubscribe: "true",
        })
      )
      const attributes = await sns.send(
        new GetSubscriptionAttributesCommand({
          SubscriptionArn: confirmed.SubscriptionArn,
        })
      )
      if (
        attributes.Attributes?.Endpoint !==
          `${installation.callbackOrigin}/ses/events` ||
        attributes.Attributes?.TopicArn !== message.TopicArn ||
        attributes.Attributes?.PendingConfirmation === "true"
      )
        throw new Error("Unexpected SNS subscription")
      await ctx.runMutation(internal.ses.state.patchRegion, {
        id: region._id,
        changes: {
          callbackConfirmed: true,
          subscriptionArn: confirmed.SubscriptionArn,
        },
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
