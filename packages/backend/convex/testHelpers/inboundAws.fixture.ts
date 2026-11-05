import { vi } from "vitest"
import { S3Client } from "@aws-sdk/client-s3"
import { SNSClient } from "@aws-sdk/client-sns"
import { SESClient, type ReceiptRule } from "@aws-sdk/client-ses"

const failure = (name: string) =>
  Object.assign(new Error("provider detail that must stay private"), { name })

/** The AWS boundary of inbound mail: an S3 bucket, the inbound SNS topic and
    the region's receipt rule sets, kept in memory. `fail` makes the named
    command throw an AWS error of the given name. */
export function mockInboundAws(installationId: string) {
  const state = {
    bucket: false,
    bucketTags: undefined as { Key: string; Value: string }[] | undefined,
    bucketPolicy: undefined as string | undefined,
    topic: false,
    topicPolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Sid: "__default_statement_ID" }],
    }),
    subscribed: false,
    active: undefined as string | undefined,
    sets: new Map<string, ReceiptRule[]>(),
    calls: [] as { name: string; input: Record<string, unknown> }[],
    fail: {} as Record<string, string>,
    /** Runs before each call is answered, to change the world mid-run. */
    onCall: undefined as ((name: string) => void) | undefined,
  }
  const count = (name: string) =>
    state.calls.filter((call) => call.name === name).length
  const record = (command: object) => {
    const name = command.constructor.name
    const input = (command as { input: Record<string, unknown> }).input
    state.calls.push({ name, input })
    state.onCall?.(name)
    if (state.fail[name]) throw failure(state.fail[name])
    return { name, input }
  }
  vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
    const { name, input } = record(command)
    if (name === "HeadBucketCommand" && !state.bucket) throw failure("NotFound")
    if (name === "CreateBucketCommand") state.bucket = true
    if (name === "GetBucketTaggingCommand") {
      if (!state.bucketTags) throw failure("NoSuchTagSet")
      return { TagSet: state.bucketTags } as never
    }
    if (name === "PutBucketTaggingCommand")
      state.bucketTags = (
        input.Tagging as { TagSet: typeof state.bucketTags }
      ).TagSet
    if (name === "GetBucketPolicyCommand") {
      if (!state.bucketPolicy) throw failure("NoSuchBucketPolicy")
      return { Policy: state.bucketPolicy } as never
    }
    if (name === "PutBucketPolicyCommand")
      state.bucketPolicy = input.Policy as string
    return {} as never
  })
  vi.spyOn(SNSClient.prototype, "send").mockImplementation(async (command) => {
    const { name, input } = record(command)
    if (name === "GetTopicAttributesCommand") {
      if (!state.topic) throw failure("NotFoundException")
      return { Attributes: { Policy: state.topicPolicy } } as never
    }
    if (name === "CreateTopicCommand") state.topic = true
    if (name === "ListTagsForResourceCommand")
      return {
        Tags: [{ Key: "opensend:installation", Value: installationId }],
      } as never
    if (
      name === "SetTopicAttributesCommand" &&
      input.AttributeName === "Policy"
    )
      state.topicPolicy = input.AttributeValue as string
    if (name === "ListSubscriptionsByTopicCommand")
      return {
        Subscriptions: state.subscribed
          ? [
              {
                Protocol: "https",
                Endpoint: "https://api.opensend.test/ses/inbound",
                SubscriptionArn: `${input.TopicArn}:subscription`,
              },
            ]
          : [],
      } as never
    if (name === "SubscribeCommand") {
      state.subscribed = true
      return { SubscriptionArn: "PendingConfirmation" } as never
    }
    return {} as never
  })
  vi.spyOn(SESClient.prototype, "send").mockImplementation(async (command) => {
    const { name, input } = record(command)
    const setName = input.RuleSetName as string | undefined
    const rules = setName ? state.sets.get(setName) : undefined
    const missingSet = () => {
      if (!rules) throw failure("RuleSetDoesNotExistException")
      return rules
    }
    if (name === "DescribeActiveReceiptRuleSetCommand")
      return (
        state.active
          ? {
              Metadata: { Name: state.active },
              Rules: state.sets.get(state.active),
            }
          : {}
      ) as never
    if (name === "DescribeReceiptRuleSetCommand")
      return { Metadata: { Name: setName }, Rules: missingSet() } as never
    if (name === "CreateReceiptRuleSetCommand") state.sets.set(setName!, [])
    if (name === "SetActiveReceiptRuleSetCommand") state.active = setName
    const rule = input.Rule as ReceiptRule | undefined
    if (name === "DescribeReceiptRuleCommand") {
      const found = missingSet().find((r) => r.Name === input.RuleName)
      if (!found) throw failure("RuleDoesNotExistException")
      return { Rule: found } as never
    }
    if (name === "CreateReceiptRuleCommand") missingSet().unshift(rule!)
    if (name === "UpdateReceiptRuleCommand") {
      const list = missingSet()
      list.splice(
        list.findIndex((r) => r.Name === rule!.Name),
        1,
        rule!
      )
    }
    if (name === "DeleteReceiptRuleCommand") {
      const list = missingSet()
      const index = list.findIndex((r) => r.Name === input.RuleName)
      if (index >= 0) list.splice(index, 1)
    }
    return {} as never
  })
  return { state, count }
}
