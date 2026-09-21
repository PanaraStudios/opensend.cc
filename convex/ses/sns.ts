"use node"
import { X509Certificate, verify } from "node:crypto"

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
export async function limitedBody(response: Request | Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let size = 0
  let body = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error("SNS body too large")
      body += decoder.decode(value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    await reader.cancel()
  }
}
