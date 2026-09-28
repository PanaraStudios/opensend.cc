#!/usr/bin/env node
/* Finds everything Opensend installations created in an AWS account and,
   with --delete, removes it: for test installs you have thrown away, or to
   uninstall. Run it with administrator credentials for the account (the
   usual AWS_PROFILE / environment / SSO chain), never Opensend's own key.

     pnpm aws:cleanup                     list what would be removed
     pnpm aws:cleanup --keep=<id>         leave one installation alone
     pnpm aws:cleanup --only=<id>         touch one installation only
     pnpm aws:cleanup --delete            remove what the list shows

   Resources are matched by Opensend's names (opensend-<installation id>…)
   and its opensend:installation tag, so nothing else in the account is
   touched. A domain Opensend adopted from an earlier SES setup carries the
   same tag and is deleted too: check the list first. */
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts"
import {
  SESv2Client,
  ListTenantsCommand,
  ListTenantResourcesCommand,
  DeleteTenantResourceAssociationCommand,
  DeleteTenantCommand,
  ListEmailIdentitiesCommand,
  ListTagsForResourceCommand,
  DeleteEmailIdentityCommand,
  ListConfigurationSetsCommand,
  DeleteConfigurationSetCommand,
} from "@aws-sdk/client-sesv2"
import {
  SESClient,
  DescribeActiveReceiptRuleSetCommand,
  ListReceiptRuleSetsCommand,
  SetActiveReceiptRuleSetCommand,
  DeleteReceiptRuleSetCommand,
  DeleteReceiptRuleCommand,
} from "@aws-sdk/client-ses"
import {
  SNSClient,
  ListTopicsCommand,
  DeleteTopicCommand,
} from "@aws-sdk/client-sns"
import {
  SQSClient,
  ListQueuesCommand,
  DeleteQueueCommand,
} from "@aws-sdk/client-sqs"
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} from "@aws-sdk/client-s3"
import {
  CloudFormationClient,
  paginateListStacks,
  DeleteStackCommand,
} from "@aws-sdk/client-cloudformation"
import {
  IAMClient,
  paginateListUsers,
  paginateListPolicies,
  ListUserTagsCommand,
  ListAccessKeysCommand,
  DeleteAccessKeyCommand,
  ListAttachedUserPoliciesCommand,
  DetachUserPolicyCommand,
  ListUserPoliciesCommand,
  GetUserPolicyCommand,
  DeleteUserPolicyCommand,
  ListGroupsForUserCommand,
  RemoveUserFromGroupCommand,
  DeleteLoginProfileCommand,
  DeleteUserCommand,
  GetPolicyVersionCommand,
  ListEntitiesForPolicyCommand,
  ListPolicyVersionsCommand,
  DeletePolicyVersionCommand,
  DeletePolicyCommand,
} from "@aws-sdk/client-iam"

// convex/ses/contracts.ts `regions`.
const REGIONS = ["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"]
const NAME = /^opensend-([a-z0-9]{16,64})(?:-|$)/
const STACK = /^opensend-access-([a-z0-9]{16,64})$/

const flag = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1]
const apply = process.argv.includes("--delete")
const keep = flag("keep")
const only = flag("only")
const wanted = (id) => !!id && id !== keep && (!only || id === only)
const installationOf = (name) => NAME.exec(name)?.[1]
const missing = (e) =>
  /NotFound|NoSuchEntity|NoSuchBucket|NonExistent|does not exist/i.test(
    `${e.name} ${e.message}`
  )

/** Every found resource: what it is, whose it is, and how to remove it. */
const plan = []
const add = (installation, kind, name, remove) => {
  if (wanted(installation)) plan.push({ installation, kind, name, remove })
}
async function all(fetchPage, key) {
  const items = []
  let token
  do {
    const page = await fetchPage(token)
    items.push(...(page[key] ?? []))
    token = page.NextToken ?? page.nextToken
  } while (token)
  return items
}

async function sesv2(region, account) {
  const ses = new SESv2Client({ region })
  for (const { TenantName } of await all(
    (NextToken) => ses.send(new ListTenantsCommand({ NextToken })),
    "Tenants"
  ))
    add(
      installationOf(TenantName),
      `SES tenant (${region})`,
      TenantName,
      async () => {
        const resources = await all(
          (NextToken) =>
            ses.send(new ListTenantResourcesCommand({ TenantName, NextToken })),
          "TenantResources"
        )
        for (const { ResourceArn } of resources)
          await ses.send(
            new DeleteTenantResourceAssociationCommand({
              TenantName,
              ResourceArn,
            })
          )
        await ses.send(new DeleteTenantCommand({ TenantName }))
      }
    )
  for (const { IdentityName } of await all(
    (NextToken) => ses.send(new ListEmailIdentitiesCommand({ NextToken })),
    "EmailIdentities"
  )) {
    const { Tags = [] } = await ses.send(
      new ListTagsForResourceCommand({
        ResourceArn: `arn:aws:ses:${region}:${account}:identity/${IdentityName}`,
      })
    )
    const tag = Tags.find((t) => t.Key === "opensend:installation")?.Value
    add(tag, `SES domain (${region})`, IdentityName, () =>
      ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: IdentityName }))
    )
  }
  for (const name of await all(
    (NextToken) => ses.send(new ListConfigurationSetsCommand({ NextToken })),
    "ConfigurationSets"
  ))
    add(installationOf(name), `SES configuration set (${region})`, name, () =>
      ses.send(
        new DeleteConfigurationSetCommand({ ConfigurationSetName: name })
      )
    )
}

async function receipts(region) {
  const ses = new SESClient({ region })
  let active
  try {
    active = await ses.send(new DescribeActiveReceiptRuleSetCommand({}))
  } catch {
    return // Receiving is not offered in every region.
  }
  const activeName = active.Metadata?.Name
  // Opensend adds its rule to someone else's active set, never replaces it.
  if (activeName && !installationOf(activeName))
    for (const rule of active.Rules ?? [])
      add(
        installationOf(rule.Name),
        `SES receipt rule (${region})`,
        `${activeName}/${rule.Name}`,
        () =>
          ses.send(
            new DeleteReceiptRuleCommand({
              RuleSetName: activeName,
              RuleName: rule.Name,
            })
          )
      )
  for (const { Name } of await all(
    (NextToken) => ses.send(new ListReceiptRuleSetsCommand({ NextToken })),
    "RuleSets"
  ))
    add(
      installationOf(Name),
      `SES receipt rule set (${region})`,
      Name,
      async () => {
        if (Name === activeName)
          await ses.send(new SetActiveReceiptRuleSetCommand({}))
        await ses.send(new DeleteReceiptRuleSetCommand({ RuleSetName: Name }))
      }
    )
}

async function notifications(region) {
  const sns = new SNSClient({ region })
  for (const { TopicArn } of await all(
    (NextToken) => sns.send(new ListTopicsCommand({ NextToken })),
    "Topics"
  )) {
    const name = TopicArn.split(":").pop()
    add(installationOf(name), `SNS topic (${region})`, name, () =>
      sns.send(new DeleteTopicCommand({ TopicArn }))
    )
  }
  const sqs = new SQSClient({ region })
  for (const QueueUrl of await all(
    (NextToken) =>
      sqs.send(
        new ListQueuesCommand({ QueueNamePrefix: "opensend-", NextToken })
      ),
    "QueueUrls"
  ))
    add(
      installationOf(QueueUrl.split("/").pop()),
      `SQS queue (${region})`,
      QueueUrl.split("/").pop(),
      () => sqs.send(new DeleteQueueCommand({ QueueUrl }))
    )
}

async function stacks(region) {
  const cfn = new CloudFormationClient({ region })
  for await (const page of paginateListStacks({ client: cfn }, {}))
    for (const stack of page.StackSummaries ?? []) {
      const id = STACK.exec(stack.StackName)?.[1]
      if (id && stack.StackStatus !== "DELETE_COMPLETE")
        // Its user and policy are retained on delete; the IAM pass removes them.
        add(id, `CloudFormation stack (${region})`, stack.StackName, () =>
          cfn.send(new DeleteStackCommand({ StackName: stack.StackName }))
        )
    }
}

async function buckets() {
  const s3 = new S3Client({ region: "us-east-1" })
  const { Buckets = [] } = await s3.send(new ListBucketsCommand({}))
  for (const { Name } of Buckets) {
    if (!/-inbound-[a-z0-9]+$/.test(Name)) continue
    add(installationOf(Name), "S3 inbound bucket", Name, async () => {
      const { LocationConstraint } = await s3.send(
        new GetBucketLocationCommand({ Bucket: Name })
      )
      const regional = new S3Client({
        region: LocationConstraint || "us-east-1",
      })
      let page
      do {
        page = await regional.send(
          new ListObjectVersionsCommand({ Bucket: Name })
        )
        const Objects = [
          ...(page.Versions ?? []),
          ...(page.DeleteMarkers ?? []),
        ].map(({ Key, VersionId }) => ({ Key, VersionId }))
        if (Objects.length)
          await regional.send(
            new DeleteObjectsCommand({ Bucket: Name, Delete: { Objects } })
          )
      } while (page.IsTruncated)
      await regional.send(new DeleteBucketCommand({ Bucket: Name }))
    })
  }
}

/** The installation a policy document grants access for, if it is Opensend's. */
const policyInstallation = (document) =>
  /arn:[^"]*:opensend-([a-z0-9]{16,64})-/.exec(
    decodeURIComponent(document)
  )?.[1]

async function iam() {
  const client = new IAMClient({ region: "us-east-1" })
  const policies = new Map()
  for await (const page of paginateListPolicies({ client }, { Scope: "Local" }))
    for (const policy of page.Policies ?? []) {
      const { PolicyVersion } = await client.send(
        new GetPolicyVersionCommand({
          PolicyArn: policy.Arn,
          VersionId: policy.DefaultVersionId,
        })
      )
      const id = policyInstallation(PolicyVersion?.Document ?? "")
      if (id) policies.set(policy.Arn, id)
    }
  for await (const page of paginateListUsers({ client }, {}))
    for (const { UserName } of page.Users ?? []) {
      const { Tags = [] } = await client.send(
        new ListUserTagsCommand({ UserName })
      )
      const attached = await client.send(
        new ListAttachedUserPoliciesCommand({ UserName })
      )
      const inline = await client.send(
        new ListUserPoliciesCommand({ UserName })
      )
      let id =
        Tags.find((t) => t.Key === "opensend:installation")?.Value ??
        attached.AttachedPolicies?.map((p) => policies.get(p.PolicyArn)).find(
          Boolean
        )
      for (const PolicyName of inline.PolicyNames ?? []) {
        if (id) break
        const { PolicyDocument } = await client.send(
          new GetUserPolicyCommand({ UserName, PolicyName })
        )
        id = policyInstallation(PolicyDocument ?? "")
      }
      add(id, "IAM user", UserName, async () => {
        const keys = await client.send(new ListAccessKeysCommand({ UserName }))
        for (const { AccessKeyId } of keys.AccessKeyMetadata ?? [])
          await client.send(
            new DeleteAccessKeyCommand({ UserName, AccessKeyId })
          )
        for (const { PolicyArn } of attached.AttachedPolicies ?? [])
          await client.send(
            new DetachUserPolicyCommand({ UserName, PolicyArn })
          )
        for (const PolicyName of inline.PolicyNames ?? [])
          await client.send(
            new DeleteUserPolicyCommand({ UserName, PolicyName })
          )
        const groups = await client.send(
          new ListGroupsForUserCommand({ UserName })
        )
        for (const { GroupName } of groups.Groups ?? [])
          await client.send(
            new RemoveUserFromGroupCommand({ UserName, GroupName })
          )
        await client
          .send(new DeleteLoginProfileCommand({ UserName }))
          .catch((e) => {
            if (!missing(e)) throw e
          })
        await client.send(new DeleteUserCommand({ UserName }))
      })
    }
  // Policies go after users, once nothing is attached to them.
  for (const [PolicyArn, id] of policies)
    add(id, "IAM policy", PolicyArn.split("/").pop(), async () => {
      const entities = await client.send(
        new ListEntitiesForPolicyCommand({ PolicyArn })
      )
      if (
        entities.PolicyUsers?.length ||
        entities.PolicyGroups?.length ||
        entities.PolicyRoles?.length
      )
        throw new Error("still attached to something else; left in place")
      const { Versions = [] } = await client.send(
        new ListPolicyVersionsCommand({ PolicyArn })
      )
      for (const { VersionId, IsDefaultVersion } of Versions)
        if (!IsDefaultVersion)
          await client.send(
            new DeletePolicyVersionCommand({ PolicyArn, VersionId })
          )
      await client.send(new DeletePolicyCommand({ PolicyArn }))
    })
}

const { Account } = await new STSClient({ region: "us-east-1" })
  .send(new GetCallerIdentityCommand({}))
  .catch((e) => {
    console.error(
      `No usable AWS credentials (${e.name}). Set AWS_PROFILE, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, for an administrator of the account.`
    )
    process.exit(1)
  })
console.log(
  `AWS account ${Account}${keep ? `, keeping ${keep}` : ""}${only ? `, only ${only}` : ""}\n`
)
// Dependents before what they depend on: associations and rules, then the
// resources, then the stacks and IAM access last.
for (const region of REGIONS) {
  await sesv2(region, Account)
  await receipts(region)
  await notifications(region)
}
await buckets()
for (const region of REGIONS) await stacks(region)
await iam()

if (!plan.length) {
  console.log("Nothing from Opensend found.")
  process.exit(0)
}
// Node 20 (AWS CloudShell) has no Map.groupBy.
for (const installation of new Set(plan.map((item) => item.installation))) {
  console.log(`Installation ${installation}`)
  for (const item of plan.filter((row) => row.installation === installation))
    console.log(`  ${item.kind}: ${item.name}`)
}
if (!apply) {
  console.log(
    `\n${plan.length} resources. Nothing was changed; add --delete to remove them.`
  )
  process.exit(0)
}
let failed = 0
for (const item of plan)
  try {
    await item.remove()
    console.log(`deleted  ${item.kind}: ${item.name}`)
  } catch (e) {
    if (missing(e)) continue
    failed++
    console.log(`FAILED   ${item.kind}: ${item.name} — ${e.name}: ${e.message}`)
  }
console.log(failed ? `\n${failed} could not be removed.` : "\nDone.")
process.exit(failed ? 1 : 0)
