import { parseCsv } from "@/lib/dashboard/csv"
import { REGIONS, type Region } from "@/lib/dashboard/types"
import { POLICY_REVISION, resourcePrefix } from "@/convex/ses/contracts"

export const IAM_USERS_URL = "https://console.aws.amazon.com/iam/home#/users"
export const AWS_SETUP_FILENAME = "opensend-aws-access.json"
export const MAX_CREDENTIAL_CSV_BYTES = 16_384

function checkedRegions(selected: readonly string[]): Region[] {
  if (
    !selected.length ||
    selected.some((region) => !REGIONS.some((item) => item.value === region))
  )
    throw new Error("Choose a supported AWS region")
  return [...new Set(selected)].sort() as Region[]
}
function checkedInstallationId(id: string) {
  if (!/^[a-z0-9]{16,64}$/.test(id))
    throw new Error("Start Opensend setup before creating AWS access")
  return id
}
export function validIamUserName(name: string) {
  return /^[A-Za-z0-9+=,.@_-]{1,64}$/.test(name)
}
export function awsSetupStackName(installationId: string) {
  return `opensend-access-${checkedInstallationId(installationId)}`
}
export function cloudFormationConsoleUrl(region: Region) {
  checkedRegions([region])
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create`
}
const sub = (value: string) => ({ "Fn::Sub": value })
type Statement = {
  Sid: string
  Effect: "Allow"
  Action: string[]
  Resource: "*" | ReturnType<typeof sub>[]
  Condition?: Record<string, Record<string, string | string[]>>
}
type Policy = { Version: "2012-10-17"; Statement: Statement[] }
const policies = { setup: buildAwsSetupPolicy, sending: buildAwsSendingPolicy }
export type AwsPolicyKind = keyof typeof policies
/** IAM caps a managed policy at 6,144 characters, so the permissions ship as
    two policies: setup (revision 1) and sending/receiving (revision 2). */
export const AWS_IAM_POLICY_FILES: Record<AwsPolicyKind, string> = {
  setup: "opensend-iam-policy.json",
  sending: "opensend-iam-sending-policy.json",
}

/** A ready-to-paste policy for repairing an existing IAM user's permissions. */
export function buildAwsIamPolicy(
  installationId: string,
  regions: readonly Region[],
  accountId: string,
  kind: AwsPolicyKind = "setup"
) {
  if (!/^\d{12}$/.test(accountId))
    throw new Error("Use a 12-digit AWS account ID")
  const policy = policies[kind](installationId, regions)
  return {
    ...policy,
    Statement: policy.Statement.map((statement) => ({
      ...statement,
      Resource:
        typeof statement.Resource === "string"
          ? statement.Resource
          : statement.Resource.map((resource) =>
              resource["Fn::Sub"]
                .replaceAll("${AWS::Partition}", "aws")
                .replaceAll("${AWS::AccountId}", accountId)
            ),
    })),
  }
}
function policyScope(installationId: string, selected: readonly Region[]) {
  const prefix = resourcePrefix(checkedInstallationId(installationId))
  const regions = checkedRegions(selected)
  return {
    prefix,
    regions,
    resources: (service: string, suffix: string) =>
      regions.map((region) =>
        sub(
          `arn:\${AWS::Partition}:${service}:${region}:\${AWS::AccountId}:${suffix}`
        )
      ),
    inRegions: { StringEquals: { "aws:RequestedRegion": regions } },
  }
}

/** Permissions for the actual provisioning/domain operations, not account administration. */
export function buildAwsSetupPolicy(
  installationId: string,
  selected: readonly Region[]
): Policy {
  const { prefix, regions, resources, inRegions } = policyScope(
    installationId,
    selected
  )
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "VerifyAccount",
        Effect: "Allow",
        Action: ["sts:GetCallerIdentity"],
        Resource: "*",
      },
      {
        Sid: "ReadSesAccount",
        Effect: "Allow",
        Action: ["ses:GetAccount"],
        Resource: "*",
        Condition: inRegions,
      },
      {
        Sid: "ManageSendingDomains",
        Effect: "Allow",
        Action: [
          "ses:CreateEmailIdentity",
          "ses:GetEmailIdentity",
          "ses:DeleteEmailIdentity",
          "ses:PutEmailIdentityMailFromAttributes",
          "ses:PutEmailIdentityConfigurationSetAttributes",
          "ses:TagResource",
          "ses:UntagResource",
          "ses:CreateTenantResourceAssociation",
          "ses:DeleteTenantResourceAssociation",
          "ses:ListResourceTenants",
        ],
        Resource: resources("ses", "identity/*"),
      },
      {
        Sid: "ManageOpensendConfigurationSets",
        Effect: "Allow",
        Action: [
          "ses:CreateConfigurationSet",
          "ses:GetConfigurationSet",
          "ses:DeleteConfigurationSet",
          "ses:ListTagsForResource",
          "ses:TagResource",
          "ses:PutConfigurationSetSuppressionOptions",
          "ses:PutConfigurationSetDeliveryOptions",
          "ses:PutEmailIdentityConfigurationSetAttributes",
          "ses:GetConfigurationSetEventDestinations",
          "ses:CreateConfigurationSetEventDestination",
          "ses:UpdateConfigurationSetEventDestination",
          "ses:CreateTenantResourceAssociation",
          "ses:DeleteTenantResourceAssociation",
          "ses:ListResourceTenants",
        ],
        Resource: resources("ses", `configuration-set/${prefix}-*`),
      },
      {
        Sid: "CreateTaggedTeamTenants",
        Effect: "Allow",
        Action: ["ses:CreateTenant"],
        Resource: "*",
        Condition: {
          StringEquals: {
            "aws:RequestedRegion": regions,
            "aws:RequestTag/opensend:installation": installationId,
          },
          StringLike: { "aws:RequestTag/opensend:team": "?*" },
        },
      },
      {
        Sid: "ManageTeamTenants",
        Effect: "Allow",
        Action: [
          "ses:GetTenant",
          "ses:DeleteTenant",
          "ses:TagResource",
          "ses:PutTenantSuppressionAttributes",
          "ses:ListTenantResources",
          "ses:CreateTenantResourceAssociation",
          "ses:DeleteTenantResourceAssociation",
        ],
        Resource: resources("ses", `tenant/${prefix}-t-*`),
      },
      {
        Sid: "ManageOpensendNotifications",
        Effect: "Allow",
        Action: [
          "sns:CreateTopic",
          "sns:GetTopicAttributes",
          "sns:ListTagsForResource",
          "sns:TagResource",
          "sns:SetTopicAttributes",
          "sns:ListSubscriptionsByTopic",
          "sns:Subscribe",
          "sns:ConfirmSubscription",
          "sns:GetSubscriptionAttributes",
          "sns:SetSubscriptionAttributes",
        ],
        // SNS subscription actions authorize against the parent topic, not a subscription ARN.
        Resource: resources("sns", `${prefix}-events`),
      },
      {
        Sid: "ManageOpensendDeadLetterQueue",
        Effect: "Allow",
        Action: [
          "sqs:CreateQueue",
          "sqs:GetQueueUrl",
          "sqs:GetQueueAttributes",
          "sqs:ListQueueTags",
          "sqs:TagQueue",
          "sqs:SetQueueAttributes",
        ],
        Resource: resources("sqs", `${prefix}-events-dlq`),
      },
    ],
  }
}

/** What sending, suppression sync, tracking, tenant pausing and receiving
    need. Added in policy revision 2. */
export function buildAwsSendingPolicy(
  installationId: string,
  selected: readonly Region[]
): Policy {
  const { prefix, resources, inRegions } = policyScope(installationId, selected)
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "SendTeamEmail",
        Effect: "Allow",
        Action: ["ses:SendEmail"],
        Resource: [
          ...resources("ses", "identity/*"),
          ...resources("ses", `configuration-set/${prefix}-*`),
        ],
        // A send without one of this installation's tenants is refused.
        Condition: { StringLike: { "ses:TenantName": `${prefix}-t-*` } },
      },
      {
        Sid: "ManageSuppressedDestinations",
        Effect: "Allow",
        Action: [
          "ses:GetSuppressedDestination",
          "ses:ListSuppressedDestinations",
          "ses:PutSuppressedDestination",
          "ses:DeleteSuppressedDestination",
        ],
        // The account-level suppression list has no resource ARN.
        Resource: "*",
        Condition: inRegions,
      },
      {
        Sid: "ConfigureTracking",
        Effect: "Allow",
        Action: ["ses:PutConfigurationSetTrackingOptions"],
        Resource: resources("ses", `configuration-set/${prefix}-*`),
      },
      {
        Sid: "PauseTeamSending",
        Effect: "Allow",
        Action: [
          "ses:GetReputationEntity",
          "ses:UpdateReputationEntityCustomerManagedStatus",
        ],
        Resource: resources("ses", `tenant/${prefix}-t-*`),
      },
      {
        Sid: "ManageInboundRules",
        Effect: "Allow",
        Action: [
          "ses:DescribeActiveReceiptRuleSet",
          "ses:DescribeReceiptRuleSet",
          "ses:DescribeReceiptRule",
          "ses:CreateReceiptRuleSet",
          "ses:SetActiveReceiptRuleSet",
          "ses:CreateReceiptRule",
          "ses:UpdateReceiptRule",
          "ses:DeleteReceiptRule",
        ],
        // Receipt rules have no resource-level permissions.
        Resource: "*",
        Condition: inRegions,
      },
      {
        Sid: "ManageInboundMailBucket",
        Effect: "Allow",
        Action: [
          "s3:CreateBucket",
          "s3:ListBucket",
          "s3:GetBucketPolicy",
          "s3:PutBucketPolicy",
          "s3:GetLifecycleConfiguration",
          "s3:PutLifecycleConfiguration",
          "s3:GetEncryptionConfiguration",
          "s3:PutEncryptionConfiguration",
          "s3:GetBucketTagging",
          "s3:PutBucketTagging",
          "s3:GetObject",
          "s3:DeleteObject",
        ],
        // S3 ARNs carry no region or account; the pattern covers the objects too.
        Resource: [sub(`arn:\${AWS::Partition}:s3:::${prefix}-inbound*`)],
        Condition: inRegions,
      },
      {
        Sid: "ManageInboundNotifications",
        Effect: "Allow",
        Action: [
          "sns:CreateTopic",
          "sns:GetTopicAttributes",
          "sns:ListTagsForResource",
          "sns:TagResource",
          "sns:SetTopicAttributes",
          "sns:ListSubscriptionsByTopic",
          "sns:Subscribe",
          "sns:ConfirmSubscription",
          "sns:GetSubscriptionAttributes",
          "sns:SetSubscriptionAttributes",
        ],
        Resource: resources("sns", `${prefix}-inbound`),
      },
    ],
  }
}

/** Contains no access keys, login profile, or secrets in stack outputs. */
export function buildAwsSetupTemplate(input: {
  installationId: string
  regions: readonly Region[]
  userName?: string
}) {
  const userName = input.userName ?? "opensend"
  if (!validIamUserName(userName))
    throw new Error(
      "Use 1–64 letters, numbers, or +=,.@_- for the AWS user name"
    )
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: `Opensend AWS access, permissions revision ${POLICY_REVISION}. Creates an IAM user that can set up SES tenants and domains, send and receive mail, and manage SNS notifications, SQS recovery and the inbound mail bucket. No console login or access keys are created.`,
    Parameters: {
      UserName: {
        Type: "String",
        Default: userName,
        MinLength: 1,
        MaxLength: 64,
        AllowedPattern: "[A-Za-z0-9+=,.@_-]+",
        Description:
          "Keep this name, or change it if a user with this name already exists.",
      },
    },
    Resources: {
      OpensendPolicy: {
        Type: "AWS::IAM::ManagedPolicy",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          Description:
            "Scoped permissions for Opensend setup and domain management",
          PolicyDocument: buildAwsSetupPolicy(
            input.installationId,
            input.regions
          ),
        },
      },
      OpensendSendingPolicy: {
        Type: "AWS::IAM::ManagedPolicy",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          Description:
            "Scoped permissions for Opensend sending, suppression, tracking and receiving",
          PolicyDocument: buildAwsSendingPolicy(
            input.installationId,
            input.regions
          ),
        },
      },
      OpensendUser: {
        Type: "AWS::IAM::User",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          UserName: { Ref: "UserName" },
          Tags: [{ Key: "opensend:installation", Value: input.installationId }],
          ManagedPolicyArns: [
            { Ref: "OpensendPolicy" },
            { Ref: "OpensendSendingPolicy" },
          ],
        },
      },
    },
    Outputs: {
      AwsAccountId: {
        Description: "Paste this account ID into Opensend.",
        Value: { Ref: "AWS::AccountId" },
      },
      UserName: {
        Description:
          "Open this user in IAM, then Security credentials > Create access key.",
        Value: { Ref: "OpensendUser" },
      },
      OpenIam: {
        Description:
          "Open the user above to create an access key, then return to Opensend.",
        Value: IAM_USERS_URL,
      },
      PolicyRevision: {
        Description: "Opensend checks for this permissions revision.",
        Value: String(POLICY_REVISION),
      },
    },
  }
}

/** The setup template as the file the admin uploads to CloudFormation. */
export const awsSetupTemplateFile = (
  input: Parameters<typeof buildAwsSetupTemplate>[0]
) => JSON.stringify(buildAwsSetupTemplate(input), null, 2) + "\n"

/** AWS's downloaded CSV is parsed locally. Never echo its contents in an error. */
export function parseAwsCredentialsCsv(source: string) {
  if (new TextEncoder().encode(source).byteLength > MAX_CREDENTIAL_CSV_BYTES)
    throw new Error("Choose the small access-key CSV downloaded from AWS")
  const { headers, rows } = parseCsv(source)
  const normalized = headers.map((header) =>
    header.toLowerCase().replace(/[\s_-]+/g, "")
  )
  const accessIndex = normalized.indexOf("accesskeyid")
  const secretIndex = normalized.indexOf("secretaccesskey")
  if (
    accessIndex < 0 ||
    secretIndex < 0 ||
    rows.length !== 1 ||
    new Set(normalized).size !== normalized.length
  )
    throw new Error(
      "Choose an AWS access-key CSV containing exactly one key pair"
    )
  const accessKeyId = rows[0][accessIndex]
  const secretAccessKey = rows[0][secretIndex]
  if (
    !/^AKIA[A-Z0-9]{12,124}$/.test(accessKeyId) ||
    !/^[A-Za-z0-9/+=]{40}$/.test(secretAccessKey)
  )
    throw new Error("This file does not contain a valid IAM access key pair")
  return { accessKeyId, secretAccessKey }
}
