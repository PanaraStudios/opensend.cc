"use node"
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto"
import type { Infer } from "convex/values"
import { credentialsValue } from "./contracts"

function legacyKey() {
  const value = process.env.SES_ENCRYPTION_KEY ?? ""
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error("The previous installation encryption key is unavailable")
  return Buffer.from(value, "hex")
}
function wrappingKey(installationId: string) {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32)
    throw new Error("The installation server secret is unavailable")
  return Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      installationId,
      "opensend:ses:key-wrapping:v1",
      32
    )
  )
}
function seal(value: Buffer, key: Buffer, context: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(Buffer.from(context))
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()])
  return [nonce, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64"))
    .join(".")
}
function open(value: string, key: Buffer, context: string) {
  const parts = value.split(".")
  if (parts.length !== 3 || parts.some((part) => !part))
    throw new Error("Invalid encrypted value")
  const [nonce, tag, ciphertext] = parts.map((part) =>
    Buffer.from(part, "base64")
  )
  const cipher = createDecipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(Buffer.from(context))
  cipher.setAuthTag(tag)
  return Buffer.concat([cipher.update(ciphertext), cipher.final()])
}
/** Store only a wrapped random key in Convex; the wrapping secret stays on the server. */
export function createWrappedKey(installationId: string) {
  return seal(
    randomBytes(32),
    wrappingKey(installationId),
    `opensend:ses:wrapped-key:${installationId}`
  )
}
function encryptionKey(installationId: string, wrappedKey?: string) {
  return wrappedKey
    ? open(
        wrappedKey,
        wrappingKey(installationId),
        `opensend:ses:wrapped-key:${installationId}`
      )
    : legacyKey()
}
export function checkEncryption(installationId: string, wrappedKey?: string) {
  encryptionKey(installationId, wrappedKey)
}
export function encryptCredentials(
  credentials: Infer<typeof credentialsValue>,
  installationId: string,
  wrappedKey?: string
) {
  const version = wrappedKey ? "v2" : "v1"
  return `${version}.${seal(Buffer.from(JSON.stringify(credentials)), encryptionKey(installationId, wrappedKey), `opensend:ses:${version}:${installationId}`)}`
}
export function decryptCredentials(
  value: string,
  installationId: string,
  wrappedKey?: string
): Infer<typeof credentialsValue> {
  const [version, ...parts] = value.split(".")
  if (version !== "v1" && version !== "v2")
    throw new Error("Invalid stored AWS credentials")
  if (version === "v2" && !wrappedKey)
    throw new Error("The installation encryption key is unavailable")
  return JSON.parse(
    open(
      parts.join("."),
      encryptionKey(installationId, version === "v2" ? wrappedKey : undefined),
      `opensend:ses:${version}:${installationId}`
    ).toString("utf8")
  )
}
