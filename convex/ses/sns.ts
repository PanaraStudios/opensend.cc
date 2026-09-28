"use node"
import { publicFetch } from "../../lib/net/public-fetch"
import { X509Certificate, verify } from "node:crypto"
import {
  ConfirmSubscriptionCommand,
  GetSubscriptionAttributesCommand,
  type SNSClient,
} from "@aws-sdk/client-sns"
import { limitedBody } from "./web"

export type SnsMessage = Record<string, string> & {
  Type: "Notification" | "SubscriptionConfirmation"
  TopicArn: string
  MessageId: string
  Message: string
}
export function parseSns(raw: string): SnsMessage {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid SNS envelope")
  const message = value as Record<string, unknown>
  const required = [
    "Type",
    "TopicArn",
    "MessageId",
    "Message",
    "Timestamp",
    "SignatureVersion",
    "Signature",
    "SigningCertURL",
  ]
  if (message.Type === "SubscriptionConfirmation")
    required.push("Token", "SubscribeURL")
  if (
    !["Notification", "SubscriptionConfirmation"].includes(
      String(message.Type)
    ) ||
    required.some((k) => typeof message[k] !== "string") ||
    (message.Subject !== undefined && typeof message.Subject !== "string")
  )
    throw new Error("Invalid SNS envelope")
  return message as SnsMessage
}
export function stringToSign(message: SnsMessage) {
  const keys =
    message.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : [
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ]
  return keys
    .filter((k) => message[k] !== undefined)
    .map((k) => `${k}\n${message[k]}\n`)
    .join("")
}
export function certificateUrl(message: SnsMessage) {
  const [, partition, service, region, account, topic] =
    message.TopicArn.split(":")
  const url = new URL(message.SigningCertURL)
  if (
    partition !== "aws" ||
    service !== "sns" ||
    !/^\d{12}$/.test(account ?? "") ||
    !topic ||
    url.protocol !== "https:" ||
    url.hostname !== `sns.${region}.amazonaws.com` ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^\/SimpleNotificationService-[a-zA-Z0-9_-]+\.pem$/.test(url.pathname)
  )
    throw new Error("Untrusted SNS certificate")
  return url.href
}
export function verifySignature(message: SnsMessage, pem: string) {
  if (!["1", "2"].includes(message.SignatureVersion))
    throw new Error("Unsupported SNS signature")
  const cert = new X509Certificate(pem)
  if (
    Date.now() < Date.parse(cert.validFrom) ||
    Date.now() > Date.parse(cert.validTo)
  )
    throw new Error("Expired SNS certificate")
  if (
    !verify(
      message.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1",
      Buffer.from(stringToSign(message)),
      cert.publicKey,
      Buffer.from(message.Signature, "base64")
    )
  )
    throw new Error("Invalid SNS signature")
}

/* SNS signs with a few long-lived certificates, so a warm instance reuses the
   ones that already verified a signature instead of fetching one per event.
   Validity is still checked on every message. */
const certificates = new Map<string, string>()
async function certificate(url: string) {
  const response = await publicFetch(url, {
    timeoutMs: 10000,
    maxBytes: 32768,
  })
  if (!response.ok) throw new Error("Unable to fetch SNS certificate")
  return limitedBody(response, 32768)
}
/** Throws unless SNS signed the message. Call it only for a topic of ours,
    so a foreign envelope never makes us fetch anything. */
export async function verifySns(message: SnsMessage) {
  const url = certificateUrl(message)
  const cached = certificates.get(url)
  const pem = cached ?? (await certificate(url))
  verifySignature(message, pem)
  if (!cached) {
    if (certificates.size >= 16) certificates.clear()
    certificates.set(url, pem)
  }
}
/** Confirms a verified SubscriptionConfirmation through the API, never by
    following its SubscribeURL, and checks the subscription is the one we
    asked for. Returns its ARN. */
export async function confirmSubscription(
  sns: SNSClient,
  message: SnsMessage,
  endpoint: string
) {
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
    !confirmed.SubscriptionArn ||
    attributes.Attributes?.Endpoint !== endpoint ||
    attributes.Attributes?.TopicArn !== message.TopicArn ||
    attributes.Attributes?.PendingConfirmation === "true"
  )
    throw new Error("Unexpected SNS subscription")
  return confirmed.SubscriptionArn
}
