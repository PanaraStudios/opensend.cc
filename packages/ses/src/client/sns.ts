/**
 * Amazon SNS HTTP(S) endpoint message handling.
 *
 * Implements the official verification procedure:
 * https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 *
 * - Only accept signing certificates served over HTTPS from an SNS domain.
 * - Build the string to sign from the exact, ordered field list per message type.
 * - Verify with SHA1withRSA (SignatureVersion 1) or SHA256withRSA (SignatureVersion 2).
 * - Callers must additionally reject unexpected `TopicArn`s.
 */
import { literals } from "convex-helpers/validators"
import { v, type Infer } from "convex/values"
import { attemptToParse } from "../component/utils.js"

/* ------------------------------------------------------------------------ */
/* Message shapes                                                            */
/* ------------------------------------------------------------------------ */

const snsCommonFields = {
  MessageId: v.string(),
  TopicArn: v.string(),
  Message: v.string(),
  Timestamp: v.string(),
  SignatureVersion: v.string(),
  Signature: v.string(),
  SigningCertURL: v.string(),
}

export const vSnsMessage = v.union(
  v.object({
    ...snsCommonFields,
    Type: v.literal("Notification"),
    Subject: v.optional(v.string()),
    UnsubscribeURL: v.optional(v.string()),
  }),
  v.object({
    ...snsCommonFields,
    Type: v.literal("SubscriptionConfirmation"),
    Token: v.string(),
    SubscribeURL: v.string(),
  }),
  v.object({
    ...snsCommonFields,
    Type: v.literal("UnsubscribeConfirmation"),
    Token: v.string(),
    SubscribeURL: v.string(),
  })
)
export type SnsMessage = Infer<typeof vSnsMessage>
export type SnsMessageType = SnsMessage["Type"]
export const vSnsMessageType = v.union(
  literals(
    "Notification",
    "SubscriptionConfirmation",
    "UnsubscribeConfirmation"
  )
)

export class SnsVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SnsVerificationError"
  }
}

/** Parse the raw HTTP body of an SNS POST into a typed message. */
export function parseSnsMessage(rawBody: string): SnsMessage {
  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    throw new SnsVerificationError("SNS message body is not valid JSON")
  }
  const result = attemptToParse(vSnsMessage, json)
  if (result.kind === "error") {
    throw new SnsVerificationError("SNS message has an unexpected shape")
  }
  return result.data
}

/* ------------------------------------------------------------------------ */
/* String to sign                                                            */
/* ------------------------------------------------------------------------ */

const NOTIFICATION_FIELDS = [
  "Message",
  "MessageId",
  "Subject",
  "Timestamp",
  "TopicArn",
  "Type",
] as const

const CONFIRMATION_FIELDS = [
  "Message",
  "MessageId",
  "SubscribeURL",
  "Timestamp",
  "Token",
  "TopicArn",
  "Type",
] as const

/**
 * Build the canonical string to sign: `Key\nValue\n` for each present field, in
 * the fixed byte-sorted order mandated by SNS, ending with a single newline.
 */
export function buildStringToSign(message: SnsMessage): string {
  const record: Record<string, string | undefined> = message
  const fields =
    message.Type === "Notification" ? NOTIFICATION_FIELDS : CONFIRMATION_FIELDS
  return fields
    .filter((field) => record[field] !== undefined)
    .map((field) => `${field}\n${record[field]}\n`)
    .join("")
}

/* ------------------------------------------------------------------------ */
/* Signing certificate                                                       */
/* ------------------------------------------------------------------------ */

const SNS_HOSTNAME_REGEX = /^sns\.[a-zA-Z0-9-]{3,}\.amazonaws\.com(\.cn)?$/

/** Only trust URLs served over HTTPS from an Amazon SNS endpoint. */
export function isTrustedSnsUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === "https:" &&
    SNS_HOSTNAME_REGEX.test(parsed.hostname) &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    parsed.hash === ""
  )
}

function isTrustedCertificateUrl(url: string, topicArn: string): boolean {
  if (!isTrustedSnsUrl(url)) return false
  const parsed = new URL(url)
  const [, partition, service, region, account, topic] = topicArn.split(":")
  const suffix = partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com"
  return (
    ["aws", "aws-cn", "aws-us-gov"].includes(partition ?? "") &&
    service === "sns" &&
    /^\d{12}$/.test(account ?? "") &&
    !!topic &&
    parsed.hostname === `sns.${region}.${suffix}` &&
    parsed.search === "" &&
    /^\/SimpleNotificationService-[a-zA-Z0-9_-]+\.pem$/.test(parsed.pathname)
  )
}

/** Bounded reads also protect requests without a Content-Length header. */
export async function readLimitedBody(
  response: Request | Response,
  limit: number
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let bytes = 0
  let result = ""
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > limit)
        throw new SnsVerificationError("SNS body exceeds size limit")
      result += decoder.decode(next.value, { stream: true })
    }
    return result + decoder.decode()
  } finally {
    await reader.cancel()
  }
}

export type CertificateFetcher = (url: string) => Promise<string>

const certificateCache = new Map<
  string,
  { expires: number; value: Promise<string> }
>()

/** Fetch a signing certificate (PEM) with an in-memory cache per isolate. */
export const fetchCertificate: CertificateFetcher = (url) => {
  const cached = certificateCache.get(url)
  if (cached && cached.expires > Date.now()) return cached.value
  const pending = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: controller.signal,
      })
      // Retrieval failures are operational errors: let SNS retry via HTTP 5xx.
      if (!response.ok)
        throw new Error(
          `SNS certificate download failed: HTTP ${response.status}`
        )
      return await readLimitedBody(response, 16 * 1024)
    } finally {
      clearTimeout(timer)
    }
  })()
  pending.catch(() => certificateCache.delete(url))
  if (certificateCache.size >= 16)
    certificateCache.delete(certificateCache.keys().next().value!)
  certificateCache.set(url, { value: pending, expires: Date.now() + 600_000 })
  return pending
}

/** Bytes backed by a plain `ArrayBuffer`, as WebCrypto requires. */
export type Bytes = Uint8Array<ArrayBuffer>

export function base64ToBytes(base64: string): Bytes {
  let binary: string
  try {
    binary = atob(base64.replace(/\s+/g, ""))
  } catch {
    throw new SnsVerificationError(
      "Invalid base64 in SNS signature or certificate"
    )
  }
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Decode the first certificate in a PEM bundle to DER bytes. */
export function pemToDer(pem: string): Bytes {
  const match =
    /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem)
  if (!match?.[1]) {
    throw new SnsVerificationError(
      "Signing certificate is not a PEM certificate"
    )
  }
  return base64ToBytes(match[1])
}

type Tlv = { tag: number; start: number; contentStart: number; end: number }

/** Read one DER tag-length-value triple starting at `offset`. */
function readTlv(bytes: Uint8Array, offset: number): Tlv {
  const tag = bytes[offset]
  const first = bytes[offset + 1]
  if (tag === undefined || first === undefined) {
    throw new SnsVerificationError("Malformed certificate: truncated DER")
  }
  let length: number
  let headerLength: number
  if (first < 0x80) {
    length = first
    headerLength = 2
  } else {
    const lengthBytes = first & 0x7f
    if (lengthBytes === 0 || lengthBytes > 4) {
      throw new SnsVerificationError("Malformed certificate: bad DER length")
    }
    length = 0
    for (let i = 0; i < lengthBytes; i++) {
      const b = bytes[offset + 2 + i]
      if (b === undefined) {
        throw new SnsVerificationError("Malformed certificate: truncated DER")
      }
      length = length * 256 + b
    }
    headerLength = 2 + lengthBytes
  }
  const contentStart = offset + headerLength
  const end = contentStart + length
  if (end > bytes.length) {
    throw new SnsVerificationError("Malformed certificate: DER length overflow")
  }
  return { tag, start: offset, contentStart, end }
}

function readChildren(bytes: Uint8Array, parent: Tlv): Tlv[] {
  const children: Tlv[] = []
  let offset = parent.contentStart
  while (offset < parent.end) {
    const child = readTlv(bytes, offset)
    if (child.end > parent.end)
      throw new SnsVerificationError(
        "Malformed certificate: child exceeds parent"
      )
    children.push(child)
    offset = child.end
  }
  return children
}

const DER_SEQUENCE = 0x30
const DER_CONTEXT_0 = 0xa0

/**
 * Extract the DER-encoded SubjectPublicKeyInfo from an X.509 certificate.
 *
 * Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
 * TBSCertificate ::= SEQUENCE { version [0] OPTIONAL, serialNumber, signature,
 *   issuer, validity, subject, subjectPublicKeyInfo, ... }
 */
export function extractSubjectPublicKeyInfo(der: Bytes): Bytes {
  const certificate = readTlv(der, 0)
  const [tbsCertificate] = readChildren(der, certificate)
  if (
    certificate.tag !== DER_SEQUENCE ||
    tbsCertificate?.tag !== DER_SEQUENCE
  ) {
    throw new SnsVerificationError("Malformed certificate: expected SEQUENCE")
  }
  const fields = readChildren(der, tbsCertificate)
  const versionOffset = fields[0]?.tag === DER_CONTEXT_0 ? 1 : 0
  const spki = fields[versionOffset + 5]
  if (!spki || spki.tag !== DER_SEQUENCE) {
    throw new SnsVerificationError(
      "Malformed certificate: subjectPublicKeyInfo not found"
    )
  }
  return der.slice(spki.start, spki.end)
}

/* ------------------------------------------------------------------------ */
/* Verification                                                              */
/* ------------------------------------------------------------------------ */

const HASH_FOR_SIGNATURE_VERSION: Record<string, "SHA-1" | "SHA-256"> = {
  "1": "SHA-1",
  "2": "SHA-256",
}

export type VerifyOptions = {
  /** Override certificate retrieval (e.g. in tests). Defaults to a cached HTTPS fetch. */
  fetchCertificate?: CertificateFetcher
}

/**
 * Verify an SNS message signature. Throws {@link SnsVerificationError} when the
 * message cannot be trusted; resolves when the signature is valid.
 */
export async function verifySnsMessage(
  message: SnsMessage,
  options: VerifyOptions = {}
): Promise<void> {
  const hash = Object.hasOwn(
    HASH_FOR_SIGNATURE_VERSION,
    message.SignatureVersion
  )
    ? HASH_FOR_SIGNATURE_VERSION[message.SignatureVersion]
    : undefined
  if (!hash) {
    throw new SnsVerificationError(
      `Unsupported SNS SignatureVersion "${message.SignatureVersion}"`
    )
  }
  if (!isTrustedCertificateUrl(message.SigningCertURL, message.TopicArn)) {
    throw new SnsVerificationError(
      `SigningCertURL "${message.SigningCertURL}" is not an Amazon SNS HTTPS endpoint`
    )
  }

  const pem = await (options.fetchCertificate ?? fetchCertificate)(
    message.SigningCertURL
  )
  const spki = extractSubjectPublicKeyInfo(pemToDer(pem))
  const key = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "RSASSA-PKCS1-v1_5", hash },
    false,
    ["verify"]
  )
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64ToBytes(message.Signature),
    new TextEncoder().encode(buildStringToSign(message))
  )
  if (!valid) {
    throw new SnsVerificationError("SNS message signature is invalid")
  }
}
