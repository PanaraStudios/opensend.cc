"use node"
import { v, ConvexError } from "convex/values"
import { internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import {
  CreateBucketCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  GetBucketTaggingCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutBucketTaggingCommand,
  type BucketLocationConstraint,
  type S3Client,
} from "@aws-sdk/client-s3"
import {
  CreateReceiptRuleCommand,
  CreateReceiptRuleSetCommand,
  DeleteReceiptRuleCommand,
  DescribeActiveReceiptRuleSetCommand,
  DescribeReceiptRuleCommand,
  DescribeReceiptRuleSetCommand,
  SetActiveReceiptRuleSetCommand,
  UpdateReceiptRuleCommand,
  type SESClient,
} from "@aws-sdk/client-ses"
import {
  assertOwned,
  awsError,
  connectionClients,
  mergePolicy,
  missing,
} from "./aws"
import { pacedConnection } from "./pacing"
import {
  inboundBucketName,
  inboundRuleSetName,
  receiptRuleName,
  resourcePrefix,
} from "./contracts"
import { confirmSubscription, parseSns, verifySns } from "./sns"
import { ensureSubscription, ensureTopic } from "./topics"

type Installation = Doc<"installation">
type InboundRegion = Doc<"inboundRegions">
/** Every receipt rule of this installation, in any rule set. SES names the
    rule in the source ARN it writes and publishes with. */
const ruleArns = (installation: Installation, region: string) =>
  `arn:aws:ses:${region}:${installation.accountId}:receipt-rule-set/*:receipt-rule/${resourcePrefix(installation._id)}-*`

/** The bucket SES stores inbound mail in: created in the region, tagged,
    and writable by SES only through this installation's receipt rules.
    S3 encrypts new objects by default (SSE-S3), and blocks public access
    on new buckets. */
async function ensureBucket(
  s3: S3Client,
  installation: Installation,
  region: string
) {
  const Bucket = inboundBucketName(installation._id, region)
  const owner = { Bucket, ExpectedBucketOwner: installation.accountId }
  if (!(await missing(() => s3.send(new HeadBucketCommand(owner))))) {
    try {
      await s3.send(
        new CreateBucketCommand({
          Bucket,
          // us-east-1 is S3's default location and refuses an explicit one.
          ...(region === "us-east-1"
            ? {}
            : {
                CreateBucketConfiguration: {
                  LocationConstraint: region as BucketLocationConstraint,
                },
              }),
        })
      )
    } catch (e) {
      if (!(e instanceof Error && e.name === "BucketAlreadyOwnedByYou")) throw e
    }
  }
  const tagging = await missing(() =>
    s3.send(new GetBucketTaggingCommand(owner))
  )
  /* The name carries this installation's ID and the bucket is in our
     account, so an untagged one is ours from a run that stopped before
     tagging it. A tagged one must carry our tag. */
  if (tagging) assertOwned(tagging.TagSet, installation._id)
  else
    await s3.send(
      new PutBucketTaggingCommand({
        ...owner,
        Tagging: {
          TagSet: [{ Key: "opensend:installation", Value: installation._id }],
        },
      })
    )
  const policy = await missing(() => s3.send(new GetBucketPolicyCommand(owner)))
  // https://docs.aws.amazon.com/ses/latest/dg/receiving-email-permissions.html
  await s3.send(
    new PutBucketPolicyCommand({
      ...owner,
      Policy: mergePolicy(policy?.Policy, {
        Sid: "OpensendSesInbound",
        Effect: "Allow",
        Principal: { Service: "ses.amazonaws.com" },
        Action: "s3:PutObject",
        Resource: `arn:aws:s3:::${Bucket}/*`,
        Condition: {
          StringEquals: { "AWS:SourceAccount": installation.accountId },
          ArnLike: { "AWS:SourceArn": ruleArns(installation, region) },
        },
      }),
    })
  )
  const lifecycle = await missing(() =>
    s3.send(new GetBucketLifecycleConfigurationCommand(owner))
  )
  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      ...owner,
      LifecycleConfiguration: {
        Rules: [
          ...(lifecycle?.Rules ?? []).filter(
            (rule) => rule.ID !== "opensend-transient-inbound"
          ),
          {
            ID: "opensend-transient-inbound",
            Status: "Enabled",
            Filter: { Prefix: "" },
            Expiration: { Days: 1 },
          },
        ],
      },
    })
  )
  return Bucket
}
const activeRuleSet = async (ses: SESClient) =>
  (await ses.send(new DescribeActiveReceiptRuleSetCommand({}))).Metadata?.Name
/** A region has one active receipt rule set per account. Opensend adds its
    rules to the active one, and creates and activates its own only when
    none is active. IAM cannot stop a replacement, so this code never
    activates a set while another one is active. */
async function ensureRuleSet(ses: SESClient, installation: Installation) {
  const ours = inboundRuleSetName(installation._id)
  const active = await activeRuleSet(ses)
  if (active) return { ruleSet: active, ownsRuleSet: active === ours }
  if (
    !(await missing(() =>
      ses.send(new DescribeReceiptRuleSetCommand({ RuleSetName: ours }))
    ))
  )
    await ses.send(new CreateReceiptRuleSetCommand({ RuleSetName: ours }))
  if (await activeRuleSet(ses))
    throw new ConvexError(
      "Another receipt rule set was activated in this region meanwhile. Retry to add Opensend's rules to it."
    )
  await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: ours }))
  return { ruleSet: ours, ownsRuleSet: true }
}

async function provisionInbound(
  ctx: ActionCtx,
  aws: Awaited<ReturnType<typeof pacedConnection>>,
  row: InboundRegion
) {
  const { installation, s3, sns, sesClassic } = aws
  const bucket = await ensureBucket(s3, installation, row.region)
  const topicArn = await ensureTopic(
    sns,
    installation,
    row.region,
    `${resourcePrefix(installation._id)}-inbound`,
    {
      Sid: "OpensendSesInboundPublish",
      SourceArn: ruleArns(installation, row.region),
    }
  )
  // Persist the allowlist before subscribing: SNS can confirm immediately.
  await ctx.runMutation(internal.ses.inboundRegions.save, {
    id: row._id,
    generation: row.generation,
    changes: { bucket, topicArn },
  })
  const subscriptionArn = await ensureSubscription(
    sns,
    topicArn,
    `${installation.callbackOrigin}/ses/inbound`,
    { RawMessageDelivery: "false" }
  )
  return {
    bucket,
    topicArn,
    ...(subscriptionArn ? { subscriptionArn } : {}),
    ...(await ensureRuleSet(sesClassic, installation)),
  }
}
/** After the region's last receiving domain: a rule set Opensend activated
    is deactivated again once it holds no rules at all, so the account is
    left without an active set, as it was. An adopted set is never touched.
    The bucket, its mail and the topic stay: the mail may not be processed
    yet, the IAM policy grants no deletion, and turning receiving on again
    reuses them. The bucket policy only admits this installation's rules,
    and none remain. */
async function cleanupInbound(ses: SESClient, row: InboundRegion) {
  if (!row.ownsRuleSet || !row.ruleSet) return {}
  const set = await missing(() =>
    ses.send(new DescribeReceiptRuleSetCommand({ RuleSetName: row.ruleSet }))
  )
  if (set && !set.Rules?.length && (await activeRuleSet(ses)) === row.ruleSet)
    await ses.send(new SetActiveReceiptRuleSetCommand({}))
  return {}
}

export const region = internalAction({
  args: { id: v.id("inboundRegions"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, generation }) => {
    const row = await ctx.runQuery(internal.ses.inboundRegions.get, { id })
    if (row.generation !== generation || row.phase !== "running") return null
    try {
      const aws = await pacedConnection(ctx, row.region)
      const changes =
        row.operation === "provision"
          ? await provisionInbound(ctx, aws, row)
          : await cleanupInbound(aws.sesClassic, row)
      await ctx.runMutation(internal.ses.inboundRegions.finish, {
        id,
        generation,
        changes,
      })
    } catch (e) {
      await ctx.runMutation(internal.ses.inboundRegions.finish, {
        id,
        generation,
        changes: {},
        error: awsError(e),
      })
    }
    return null
  },
})

/** Deletes the domain's rule wherever it may be. A missing rule or set is
    already gone. */
async function deleteRule(
  ses: SESClient,
  ruleSet: string,
  installation: Installation,
  domainId: string
) {
  await missing(() =>
    ses.send(
      new DeleteReceiptRuleCommand({
        RuleSetName: ruleSet,
        RuleName: receiptRuleName(installation._id, domainId),
      })
    )
  )
}
/** Removes a removed domain's receipt rule. */
export async function removeReceiptRule(
  ses: SESClient,
  installation: Installation,
  domain: Doc<"domains">,
  inbound: InboundRegion | null
) {
  for (const set of new Set([domain.receiptRuleSet, inbound?.ruleSet]))
    if (set && (domain.receiptRuleSet || domain.receiving))
      await deleteRule(ses, set, installation, domain._id)
}
/** Brings the domain's receipt rule in line with its receiving switch.
    Returns the rule set now holding it, or null when it has none. */
export async function syncReceiptRule(
  ctx: ActionCtx,
  ses: SESClient,
  installation: Installation,
  domain: Doc<"domains">,
  inbound: InboundRegion | null
): Promise<string | null> {
  // A rule left in a set that is no longer the active one receives nothing.
  if (
    domain.receiptRuleSet &&
    (!domain.receiving || domain.receiptRuleSet !== inbound?.ruleSet)
  )
    await deleteRule(ses, domain.receiptRuleSet, installation, domain._id)
  if (!domain.receiving) return null
  if (
    inbound?.operation !== "provision" ||
    inbound.phase !== "ready" ||
    !inbound.ruleSet ||
    !inbound.bucket ||
    !inbound.topicArn
  )
    throw new ConvexError(
      inbound?.error
        ? `Inbound mail setup for this region failed: ${inbound.error}`
        : "Inbound mail setup for this region is not ready. Retry."
    )
  const RuleSetName = inbound.ruleSet
  const Rule = {
    Name: receiptRuleName(installation._id, domain._id),
    Enabled: true,
    TlsPolicy: "Optional" as const,
    ScanEnabled: true,
    Recipients: [domain.name],
    /* S3 keeps the whole message (up to 40 MB); an SNS action would carry
       only 150 KB. The notification names the stored object. */
    Actions: [
      {
        S3Action: {
          BucketName: inbound.bucket,
          ObjectKeyPrefix: `${domain._id}/`,
          TopicArn: inbound.topicArn,
        },
      },
    ],
  }
  // Recorded first, so a run that stops after creating it still removes it.
  await ctx.runMutation(internal.domains.saveReceiptRule, {
    id: domain._id,
    ruleSet: RuleSetName,
  })
  const existing = await missing(() =>
    ses.send(
      new DescribeReceiptRuleCommand({ RuleSetName, RuleName: Rule.Name })
    )
  )
  // Without `After`, SES puts a new rule first, so a stop action in an
  // adopted set's own rules never keeps mail from it.
  await ses.send(
    existing
      ? new UpdateReceiptRuleCommand({ RuleSetName, Rule })
      : new CreateReceiptRuleCommand({ RuleSetName, Rule })
  )
  return RuleSetName
}

/** A notification from a region's inbound topic, verified before use. */
export const receive = internalAction({
  args: { body: v.string() },
  returns: v.null(),
  handler: async (ctx, { body }) => {
    const message = parseSns(body)
    const inbound = await ctx.runQuery(internal.ses.inboundRegions.topic, {
      arn: message.TopicArn,
    })
    if (!inbound) throw new Error("Unknown SNS topic")
    if (!(await verifySns(message))) return null
    if (message.Type === "SubscriptionConfirmation") {
      const installation = await ctx.runQuery(
        internal.installation.connection,
        {}
      )
      const { sns } = connectionClients(installation, inbound.region)
      await ctx.runMutation(internal.ses.inboundRegions.confirm, {
        id: inbound._id,
        subscriptionArn: await confirmSubscription(
          sns,
          message,
          `${installation.callbackOrigin}/ses/inbound`
        ),
      })
    } else
      await ctx.runMutation(internal.ses.inboundMessages.ingest, {
        topicArn: message.TopicArn,
        messageId: message.MessageId,
        message: message.Message,
      })
    return null
  },
})
