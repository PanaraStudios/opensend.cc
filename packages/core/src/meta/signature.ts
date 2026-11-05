/* Meta signs every webhook delivery with the app secret: the
   `X-Hub-Signature-256` header is `sha256=` and the hex HMAC-SHA256 of the
   raw body. https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads */

const encoder = new TextEncoder()
const PREFIX = "sha256="

const bytes = (body: string | Uint8Array): Uint8Array<ArrayBuffer> =>
  typeof body === "string" ? encoder.encode(body) : new Uint8Array(body)

const hmacKey = (appSecret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  )

function fromHex(hex: string) {
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) return null
  return Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16))
}

/** The `X-Hub-Signature-256` header value for a body. */
export async function metaSignature(
  appSecret: string,
  body: string | Uint8Array
) {
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await hmacKey(appSecret, "sign"),
      bytes(body)
    )
  )
  return (
    PREFIX + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")
  )
}

/** Whether the header signs this exact body. Web Crypto's HMAC verify
    compares in constant time. */
export async function verifyMetaSignature(
  appSecret: string,
  body: string | Uint8Array,
  header: string | null | undefined
) {
  if (!appSecret || !header?.startsWith(PREFIX)) return false
  const mac = fromHex(header.slice(PREFIX.length))
  if (!mac) return false
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(appSecret, "verify"),
    mac,
    bytes(body)
  )
}

/** Compares two secrets without revealing where they first differ. */
export function sameSecret(a: string, b: string) {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let difference = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return difference === 0
}
