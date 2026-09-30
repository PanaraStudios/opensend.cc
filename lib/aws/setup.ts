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
export const AWS_IAM_POLICY_FILE = "opensend-iam-policy.json"

/** The policy, ready to paste into IAM for the connected account. */
export function buildAwsIamPolicy(
  installationId: string,
  regions: readonly Region[],
  accountId: string
) {
  if (!/^\d{12}$/.test(accountId))
    throw new Error("Use a 12-digit AWS account ID")
  const policy = buildAwsPolicy(installationId, regions)
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

/** Everything Opensend does in AWS, as ONE managed policy so setup is a
    single paste. IAM caps a managed policy at 6,144 characters, so ARNs name
    any region and each statement's condition limits it to the enabled ones:
    the same grants as listing every region, at a fraction of the size. */
export function buildAwsPolicy(
  installationId: string,
  selected: readonly Region[]
): Policy {
  const prefix = resourcePrefix(checkedInstallationId(installationId))
  const regions = checkedRegions(selected)
  const arn = (service: string, suffix: string) =>
    sub(`arn:\${AWS::Partition}:${service}:*:\${AWS::AccountId}:${suffix}`)
  const inRegions = { StringEquals: { "aws:RequestedRegion": regions } }
  const scoped = (
    Sid: string,
    Action: string[],
    Resource: Statement["Resource"]
  ): Statement => ({
    Sid,
    Effect: "Allow",
    Action,
    Resource,
    Condition: inRegions,
  })
  const tenantAssociations = [
    "ses:CreateTenantResourceAssociation",
    "ses:DeleteTenantResourceAssociation",
  ]
  /* A domain's ARN is just its name, so identity statements cannot be
     narrowed by prefix. Tags do it instead: Opensend changes, sends from and
     deletes only domains tagged with this installation, and may tag only a
     domain no other installation has claimed (a new one, or one the admin
     approved for adoption). */
  const ownTag = "aws:ResourceTag/opensend:installation"
  const domainTagKeys = {
    "ForAllValues:StringEquals": {
      "aws:TagKeys": ["opensend:installation", "opensend:domain"],
    },
  }
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "VerifyAccount",
        Effect: "Allow",
        Action: ["sts:GetCallerIdentity"],
        Resource: "*",
      },
      // These SES APIs have no resource ARN: the account, its suppression
      // list and receipt rules.
      scoped(
        "UseSesAccount",
        [
          "ses:GetAccount",
          "ses:DeleteSuppressedDestination",
          "ses:DescribeActiveReceiptRuleSet",
          "ses:DescribeReceiptRuleSet",
          "ses:DescribeReceiptRule",
          "ses:CreateReceiptRuleSet",
          "ses:SetActiveReceiptRuleSet",
          "ses:CreateReceiptRule",
          "ses:UpdateReceiptRule",
          "ses:DeleteReceiptRule",
        ],
        "*"
      ),
      // Reading is how Opensend tells its own domains from anyone else's.
      scoped(
        "ReadDomains",
        ["ses:GetEmailIdentity", "ses:ListResourceTenants"],
        [arn("ses", "identity/*")]
      ),
      {
        Sid: "ClaimDomains",
        Effect: "Allow",
        Action: ["ses:CreateEmailIdentity", "ses:TagResource"],
        Resource: [arn("ses", "identity/*")],
        Condition: {
          StringEquals: {
            ...inRegions.StringEquals,
            "aws:RequestTag/opensend:installation": installationId,
          },
          StringEqualsIfExists: { [ownTag]: installationId },
          ...domainTagKeys,
        },
      },
      {
        Sid: "ManageOwnDomains",
        Effect: "Allow",
        Action: [
          "ses:DeleteEmailIdentity",
          "ses:PutEmailIdentityMailFromAttributes",
          "ses:PutEmailIdentityConfigurationSetAttributes",
          "ses:PutEmailIdentityFeedbackAttributes",
          "ses:UntagResource",
          ...tenantAssociations,
        ],
        Resource: [arn("ses", "identity/*")],
        Condition: {
          StringEquals: { ...inRegions.StringEquals, [ownTag]: installationId },
          ...domainTagKeys,
        },
      },
      scoped(
        "ManageOpensendConfigurationSets",
        [
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
          ...tenantAssociations,
          "ses:ListResourceTenants",
        ],
        [arn("ses", `configuration-set/${prefix}-*`)]
      ),
      {
        Sid: "SendTeamEmail",
        Effect: "Allow",
        Action: ["ses:SendEmail"],
        Resource: [
          arn("ses", "identity/*"),
          arn("ses", `configuration-set/${prefix}-*`),
        ],
        /* A send without one of this installation's tenants is refused, and
           SES sends through a tenant only from domains associated with it,
           which takes the ownership tag (ManageOwnDomains). */
        Condition: {
          ...inRegions,
          StringLike: { "ses:TenantName": `${prefix}-t-*` },
        },
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
      scoped(
        "ManageTeamTenants",
        [
          "ses:GetTenant",
          "ses:DeleteTenant",
          "ses:TagResource",
          "ses:PutTenantSuppressionAttributes",
          "ses:ListTenantResources",
          ...tenantAssociations,
          "ses:GetReputationEntity",
          "ses:UpdateReputationEntityCustomerManagedStatus",
        ],
        [arn("ses", `tenant/${prefix}-t-*`)]
      ),
      scoped(
        "ManageOpensendNotifications",
        [
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
        // Subscription actions authorize against the parent topic.
        [arn("sns", `${prefix}-events`), arn("sns", `${prefix}-inbound`)]
      ),
      scoped(
        "ManageOpensendDeadLetterQueue",
        [
          "sqs:CreateQueue",
          "sqs:GetQueueUrl",
          "sqs:GetQueueAttributes",
          "sqs:ListQueueTags",
          "sqs:TagQueue",
          "sqs:SetQueueAttributes",
        ],
        [arn("sqs", `${prefix}-events-dlq`)]
      ),
      // SES receiving drops mail here; Opensend copies it into Convex and
      // deletes it. S3 ARNs carry no region or account.
      scoped(
        "ManageInboundMailBucket",
        [
          "s3:CreateBucket",
          "s3:ListBucket",
          "s3:GetBucketPolicy",
          "s3:PutBucketPolicy",
          "s3:GetLifecycleConfiguration",
          "s3:PutLifecycleConfiguration",
          "s3:GetBucketTagging",
          "s3:PutBucketTagging",
          "s3:GetObject",
          "s3:DeleteObject",
        ],
        [sub(`arn:\${AWS::Partition}:s3:::${prefix}-inbound*`)]
      ),
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
            "Scoped permissions for Opensend: SES domains, tenants, sending and receiving",
          PolicyDocument: buildAwsPolicy(input.installationId, input.regions),
        },
      },
      OpensendUser: {
        Type: "AWS::IAM::User",
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
        Properties: {
          UserName: { Ref: "UserName" },
          Tags: [{ Key: "opensend:installation", Value: input.installationId }],
          ManagedPolicyArns: [{ Ref: "OpensendPolicy" }],
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
