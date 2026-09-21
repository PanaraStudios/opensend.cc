"use node"
import { SESv2Client, GetAccountCommand } from "@aws-sdk/client-sesv2"
import { SNSClient } from "@aws-sdk/client-sns"
import { SQSClient } from "@aws-sdk/client-sqs"
import { STSClient } from "@aws-sdk/client-sts"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { ConvexError, type Infer } from "convex/values"
import { credentialsValue, validateRegion } from "./contracts"
import { decryptCredentials } from "./crypto"
import type { Doc } from "../_generated/dataModel"

function clientConfig(
  region: string,
  credentials: Infer<typeof credentialsValue>
) {
  validateRegion(region)
  return {
    region,
    maxAttempts: 1,
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
/** For AWS clients this module does not build, such as global Route 53. */
export function connectionConfig(
  installation: Doc<"installation">,
  region: string
) {
  return clientConfig(region, installationCredentials(installation))
}
export function clients(
  region: string,
  credentials: Infer<typeof credentialsValue>,
  beforeSesCall?: () => Promise<void>
) {
  const config = clientConfig(region, credentials)
  const result = {
    ses: new SESv2Client(config),
    sns: new SNSClient(config),
    sqs: new SQSClient(config),
    sts: new STSClient(config),
  }
  for (const client of Object.values(result)) {
    const stack = client.middlewareStack as SESv2Client["middlewareStack"]
    stack.add(
      (next, context) => async (args) => {
        if (client === result.ses) await beforeSesCall?.()
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
  if (/AccessDenied|Unauthorized|AuthorizationError/.test(name))
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
