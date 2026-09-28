"use node"
import {
  SESv2Client,
  GetAccountCommand,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2"
import {
  SESClient,
  DescribeActiveReceiptRuleSetCommand,
} from "@aws-sdk/client-ses"
import { S3Client } from "@aws-sdk/client-s3"
import { SNSClient } from "@aws-sdk/client-sns"
import { SQSClient } from "@aws-sdk/client-sqs"
import { STSClient } from "@aws-sdk/client-sts"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { ConvexError, type Infer } from "convex/values"
import { credentialsValue, teamTenantName, validateRegion } from "./contracts"
import { decryptCredentials } from "./crypto"
import type { Doc } from "../_generated/dataModel"

function clientConfig(
  region: string,
  credentials: Infer<typeof credentialsValue>
) {
  validateRegion(region)
  return {
    region,
    /* The SDK's standard retry mode (3 attempts, exponential backoff with full
       jitter, longer for throttling) is AWS's recommended default:
       https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html */
    requestHandler: { connectionTimeout: 5000, requestTimeout: 15000 },
    credentials:
      credentials.kind === "role"
        ? fromNodeProviderChain()
        : {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
          },
  }
}
function installationCredentials(installation: Doc<"installation">) {
  return installation.credentialKind === "role"
    ? { kind: "role" as const }
    : decryptCredentials(
        installation.encryptedCredentials ?? "",
        installation._id,
        installation.wrappedEncryptionKey
      )
}
export function clients(
  region: string,
  credentials: Infer<typeof credentialsValue>,
  beforeSesCall?: () => Promise<void>
) {
  const config = clientConfig(region, credentials)
  const result = {
    ses: new SESv2Client(config),
    // Receipt rules exist only in the classic SES API.
    sesClassic: new SESClient(config),
    s3: new S3Client(config),
    sns: new SNSClient(config),
    sqs: new SQSClient(config),
    sts: new STSClient(config),
  }
  for (const client of Object.values(result)) {
    const stack = client.middlewareStack as SESv2Client["middlewareStack"]
    stack.add(
      (next, context) => async (args) => {
        try {
          return await next(args)
        } catch (error) {
          // Preserve AWS's error name for idempotent missing-resource handling.
          if (error instanceof Error)
            Object.assign(error, { opensendOperation: context.commandName })
          throw error
        }
      },
      { step: "initialize", name: "opensendOperation" }
    )
  }
  // Placed inside the SDK's retry loop, so every attempt, retries included,
  // waits its turn in the region's pacer.
  // Receipt rules share the region's SES management call budget.
  if (beforeSesCall)
    for (const client of [result.ses, result.sesClassic])
      (client.middlewareStack as SESv2Client["middlewareStack"]).addRelativeTo(
        <Args, Output>(next: (args: Args) => Promise<Output>) =>
          async (args: Args) => {
            await beforeSesCall()
            return next(args)
          },
        {
          relation: "after",
          toMiddleware: "retryMiddleware",
          name: "opensendPacer",
        }
      )
  return result
}
export function connectionClients(
  installation: Doc<"installation">,
  region: string,
  beforeSesCall?: () => Promise<void>
) {
  return clients(region, installationCredentials(installation), beforeSesCall)
}
export async function readAccount(ses: SESv2Client) {
  const result = await ses.send(new GetAccountCommand({}))
  return {
    production: !!result.ProductionAccessEnabled,
    sendingEnabled: !!result.SendingEnabled,
    daily: result.SendQuota?.Max24HourSend ?? 0,
    rate: result.SendQuota?.MaxSendRate ?? 0,
    sent: result.SendQuota?.SentLast24Hours ?? 0,
  }
}
/** An email identity that exists in AWS but is not ours. An installation admin
    can review and adopt it, so the failure carries that structurally instead of
    leaving the dashboard to read the message. The message is unchanged: the
    data is a string, so `awsError` still reports it verbatim. */
export class AdoptionConflict extends ConvexError<string> {}
const denied = (error: unknown) =>
  error instanceof Error &&
  /AccessDenied|Unauthorized|AuthorizationError/.test(error.name)
export function awsError(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string")
    return error.data
  const name = error instanceof Error ? error.name : "Error"
  const operation =
    error &&
    typeof error === "object" &&
    "opensendOperation" in error &&
    typeof error.opensendOperation === "string" &&
    /^[A-Za-z]+Command$/.test(error.opensendOperation)
      ? `${error.opensendOperation.replace(/Command$/, "")}: `
      : ""
  // Provider errors can echo request details. Return a safe operation/code, not raw messages.
  if (denied(error))
    return `${operation}AWS denied this operation. Check the installation IAM policy and the selected region.`
  if (
    /InvalidClientTokenId|UnrecognizedClient|SignatureDoesNotMatch|ExpiredToken|CredentialsProviderError/.test(
      name
    )
  )
    return "AWS credentials are invalid or expired. Validate a replacement in installation settings."
  if (/Throttl|TooMany/.test(name))
    return "AWS throttled the request. Wait briefly and retry."
  return `${operation}AWS operation failed (${/^[A-Za-z0-9]+$/.test(name) ? name : "Error"}). Retry or check the AWS configuration.`
}
/** Harmless calls only the current IAM policy revision allows. IAM authorizes
    a call before SES looks at it, so an AWS rejection that is not an access
    denial proves the permission. The send comes from a domain that can never
    be verified, so SES always rejects it and nothing is sent. */
export async function hasPolicyRevision(
  aws: ReturnType<typeof clients>,
  installationId: string
) {
  const probes: { run: () => Promise<unknown>; rejections: string[] }[] = [
    {
      run: () =>
        aws.ses.send(
          new SendEmailCommand({
            FromEmailAddress: "probe@permission-check.invalid",
            Destination: { ToAddresses: ["success@simulator.amazonses.com"] },
            Content: {
              Simple: {
                Subject: { Data: "Opensend permission check" },
                Body: { Text: { Data: "Opensend permission check" } },
              },
            },
            TenantName: teamTenantName(installationId, "permissioncheck"),
          })
        ),
      // SendEmail's documented errors that follow authorization.
      rejections: [
        "MessageRejected",
        "MailFromDomainNotVerifiedException",
        "NotFoundException",
        "BadRequestException",
        "SendingPausedException",
        "AccountSuspendedException",
        "LimitExceededException",
      ],
    },
    {
      run: () =>
        aws.sesClassic.send(new DescribeActiveReceiptRuleSetCommand({})),
      rejections: [],
    },
  ]
  for (const probe of probes)
    try {
      await probe.run()
    } catch (e) {
      if (denied(e)) return false
      if (!(e instanceof Error && probe.rejections.includes(e.name))) throw e
    }
  return true
}
export async function missing<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (e) {
    if (
      e instanceof Error &&
      [
        "NotFound",
        "NotFoundException",
        "QueueDoesNotExist",
        "AWS.SimpleQueueService.NonExistentQueue",
        "NoSuchBucketPolicy",
        "NoSuchTagSet",
        "RuleSetDoesNotExistException",
        "RuleDoesNotExistException",
      ].includes(e.name)
    )
      return null
    throw e
  }
}
export function assertOwned(
  tags: { Key?: string; Value?: string }[] | undefined,
  installationId: string,
  domainId?: string
) {
  if (
    !tags?.some(
      (t) => t.Key === "opensend:installation" && t.Value === installationId
    ) ||
    (domainId &&
      !tags.some((t) => t.Key === "opensend:domain" && t.Value === domainId))
  )
    throw new ConvexError(
      "An AWS resource with this name already exists and is not owned by this installation. No existing configuration was changed."
    )
}
/** Preserve statements unrelated to Opensend's named grant. */
export function mergePolicy(
  raw: string | undefined,
  statement: Record<string, unknown>
) {
  const policy = raw
    ? JSON.parse(raw)
    : { Version: "2012-10-17", Statement: [] }
  const statements: Record<string, unknown>[] = Array.isArray(policy.Statement)
    ? policy.Statement
    : policy.Statement
      ? [policy.Statement]
      : []
  return JSON.stringify({
    ...policy,
    Statement: [
      ...statements.filter((s) => s.Sid !== statement.Sid),
      statement,
    ],
  })
}
