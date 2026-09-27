/* Webhooks are signed exactly as Svix signs them, so Resend's and Svix's
   verification libraries accept ours unchanged:
   https://docs.svix.com/receiving/verifying-payloads/how-manual */

const encoder = new TextEncoder()

function secretBytes(secret: string) {
  const key = atob(secret.replace(/^whsec_/, ""))
  return Uint8Array.from(key, (char) => char.charCodeAt(0))
}

async function sign(secret: string, content: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(content))
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
}

/** The `svix-signature` header: one `v1,<base64 HMAC-SHA256>` per secret,
    space separated, over `${id}.${timestamp}.${body}`. Several secrets sign
    at once while a rotated-out one is still in its grace period. */
export async function webhookSignature(input: {
  id: string
  /** Unix seconds, as sent in `svix-timestamp`. */
  timestamp: number
  body: string
  secrets: readonly string[]
}) {
  const content = `${input.id}.${input.timestamp}.${input.body}`
  const signatures = await Promise.all(
    input.secrets.map(async (secret) => `v1,${await sign(secret, content)}`)
  )
  return signatures.join(" ")
}

/** The headers Svix sends with every attempt. The id stays the same across
    retries and replays so receivers can drop duplicates; the timestamp is
    the attempt's own, so a late retry still passes their freshness check. */
export async function webhookHeaders(input: {
  id: string
  timestamp: number
  body: string
  secrets: readonly string[]
}) {
  return {
    "content-type": "application/json",
    "svix-id": input.id,
    "svix-timestamp": String(input.timestamp),
    "svix-signature": await webhookSignature(input),
  }
}
