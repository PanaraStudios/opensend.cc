"use node"
import {
  CreateTopicCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
  ListTagsForResourceCommand,
  SetSubscriptionAttributesCommand,
  SetTopicAttributesCommand,
  SubscribeCommand,
  type SNSClient,
} from "@aws-sdk/client-sns"
import type { Doc } from "../_generated/dataModel"
import { assertOwned, mergePolicy, missing } from "./aws"

/** An installation-owned SNS topic that SES may publish to, created if
    missing. Other statements in its policy are kept. */
export async function ensureTopic(
  sns: SNSClient,
  installation: Doc<"installation">,
  region: string,
  name: string,
  publisher: { Sid: string; SourceArn: string }
) {
  const topicArn = `arn:aws:sns:${region}:${installation.accountId}:${name}`
  let topic = await missing(() =>
    sns.send(new GetTopicAttributesCommand({ TopicArn: topicArn }))
  )
  if (!topic) {
    await sns.send(
      new CreateTopicCommand({
        Name: name,
        Tags: [{ Key: "opensend:installation", Value: installation._id }],
      })
    )
    topic = await sns.send(
      new GetTopicAttributesCommand({ TopicArn: topicArn })
    )
  }
  assertOwned(
    (await sns.send(new ListTagsForResourceCommand({ ResourceArn: topicArn })))
      .Tags,
    installation._id
  )
  await sns.send(
    new SetTopicAttributesCommand({
      TopicArn: topicArn,
      AttributeName: "SignatureVersion",
      AttributeValue: "2",
    })
  )
  await sns.send(
    new SetTopicAttributesCommand({
      TopicArn: topicArn,
      AttributeName: "Policy",
      AttributeValue: mergePolicy(topic.Attributes?.Policy, {
        Sid: publisher.Sid,
        Effect: "Allow",
        Principal: { Service: "ses.amazonaws.com" },
        Action: "sns:Publish",
        Resource: topicArn,
        Condition: {
          StringEquals: { "AWS:SourceAccount": installation.accountId },
          ArnLike: { "AWS:SourceArn": publisher.SourceArn },
        },
      }),
    })
  )
  return topicArn
}

/** Subscribes the HTTPS callback once, or brings an existing subscription's
    attributes up to date. Returns its ARN once SNS has one. Persist the
    topic before calling: SNS can confirm immediately. */
export async function ensureSubscription(
  sns: SNSClient,
  topicArn: string,
  endpoint: string,
  attributes: Record<string, string>
) {
  let subscriptionArn: string | undefined
  let token: string | undefined
  do {
    const page = await sns.send(
      new ListSubscriptionsByTopicCommand({
        TopicArn: topicArn,
        NextToken: token,
      })
    )
    subscriptionArn = page.Subscriptions?.find(
      (s) => s.Protocol === "https" && s.Endpoint === endpoint
    )?.SubscriptionArn
    token = page.NextToken
  } while (!subscriptionArn && token)
  if (!subscriptionArn || subscriptionArn === "PendingConfirmation") {
    const result = await sns.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: "https",
        Endpoint: endpoint,
        ReturnSubscriptionArn: true,
        Attributes: attributes,
      })
    )
    subscriptionArn = result.SubscriptionArn
  } else {
    for (const [AttributeName, AttributeValue] of Object.entries(attributes))
      await sns.send(
        new SetSubscriptionAttributesCommand({
          SubscriptionArn: subscriptionArn,
          AttributeName,
          AttributeValue,
        })
      )
  }
  return subscriptionArn && subscriptionArn !== "PendingConfirmation"
    ? subscriptionArn
    : undefined
}
