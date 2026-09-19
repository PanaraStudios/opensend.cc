/* Time-based one-time passwords (RFC 6238), as authenticator apps make them:
   HMAC-SHA1 over the 30-second counter, six digits. */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const STEP_MS = 30_000

export function createTotpSecret(length = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => BASE32[byte % BASE32.length]).join("")
}

function base32Bytes(secret: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const char of secret.toUpperCase().replace(/[\s=]/g, "")) {
    const index = BASE32.indexOf(char)
    if (index < 0) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

/** What the QR code holds. */
export function totpUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`
}

export async function totpCode(secret: string, at: number): Promise<string> {
  const counter = new DataView(new ArrayBuffer(8))
  counter.setUint32(4, Math.floor(at / STEP_MS))
  const key = await crypto.subtle.importKey(
    "raw",
    base32Bytes(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  )
  const hash = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, counter.buffer)
  )
  const offset = hash[hash.length - 1]! & 0x0f
  const binary =
    ((hash[offset]! & 0x7f) << 24) |
    (hash[offset + 1]! << 16) |
    (hash[offset + 2]! << 8) |
    hash[offset + 3]!
  return String(binary % 1_000_000).padStart(6, "0")
}

/** Accepts the code of this step and of the one either side, since phones
    and servers rarely agree to the second. */
export async function verifyTotp(
  secret: string,
  code: string,
  at: number
): Promise<boolean> {
  for (const drift of [0, -1, 1]) {
    if ((await totpCode(secret, at + drift * STEP_MS)) === code) return true
  }
  return false
}
