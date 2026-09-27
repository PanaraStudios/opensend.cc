"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import {
  ConfirmSubscriptionCommand,
  GetSubscriptionAttributesCommand,
} from "@aws-sdk/client-sns"
import { connectionClients } from "./aws"
import { certificateUrl, parseSns, verifySignature } from "./sns"
import { limitedBody } from "./web"
/* SNS signs with a few long-lived certificates, so a warm instance reuses the
   ones that already verified a signature instead of fetching one per event.
   Validity is still checked on every message. */
const certificates = new Map<string, string>()
async function certificate(url: string) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error("Unable to fetch SNS certificate")
  return limitedBody(response, 32768)
}
export const receive = internalAction({
  args: { body: v.string() },
  returns: v.null(),
  handler: async (ctx, { body }) => {
    const message = parseSns(body)
    const region = await ctx.runQuery(internal.ses.state.topic, {
      arn: message.TopicArn,
    })
    if (!region) throw new Error("Unknown SNS topic")
    const url = certificateUrl(message)
    const cached = certificates.get(url)
    const pem = cached ?? (await certificate(url))
    verifySignature(message, pem)
    if (!cached) {
      if (certificates.size >= 16) certificates.clear()
      certificates.set(url, pem)
    }
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
