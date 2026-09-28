/* A recipient's unsubscribe link carries who it is for, signed with the
   server secret so it cannot be forged or pointed at another contact. It
   holds ids only, never the address. Like Resend's, it never expires: a link
   in an old email must keep working. Rotating the secret retires every link
   already sent. */

export type UnsubscribeTarget = {
  organizationId: string
  contactId: string
  /** Set for a topic-scoped send: one-click then leaves only this topic. */
  topicId?: string
}

const CONTEXT = "opensend:unsubscribe:v1:"
const encoder = new TextEncoder()

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}
function fromBase64url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

function hmacKey(secret: string) {
  if (secret.length < 32)
    throw new Error("The installation server secret is unavailable")
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
}

export async function signUnsubscribeToken(
  target: UnsubscribeTarget,
  secret: string
) {
  const parts = [target.organizationId, target.contactId, target.topicId ?? ""]
  if (parts.some((part) => part.includes(".")) || !parts[0] || !parts[1])
    throw new Error("Invalid unsubscribe target")
  const payload = parts.join(".")
  const mac = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(CONTEXT + payload)
  )
  return `${base64url(encoder.encode(payload))}.${base64url(new Uint8Array(mac))}`
}

/** The link's target, or null for anything this server did not sign. */
export async function readUnsubscribeToken(
  token: string,
  secret: string
): Promise<UnsubscribeTarget | null> {
  if (token.length > 512) return null
  const [encoded, signature, ...rest] = token.split(".")
  const payloadBytes = fromBase64url(encoded ?? "")
  const mac = fromBase64url(signature ?? "")
  if (rest.length || !payloadBytes || !mac) return null
  const payload = new TextDecoder().decode(payloadBytes)
  // Constant-time comparison, done by Web Crypto.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    mac,
    encoder.encode(CONTEXT + payload)
  )
  if (!valid) return null
  const [organizationId, contactId, topicId] = payload.split(".")
  return {
    organizationId,
    contactId,
    ...(topicId ? { topicId } : {}),
  }
}

/** RFC 2369 and RFC 8058 headers: mailbox providers show their own
    unsubscribe button and POST `List-Unsubscribe=One-Click` to the URL. */
export function listUnsubscribeHeaders(oneClickUrl: string) {
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  }
}
