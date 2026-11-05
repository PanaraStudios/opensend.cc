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

let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined

function hmacKey(secret: string, validate = true) {
  if (validate && secret.length < 32)
    throw new Error("The installation server secret is unavailable")
  if (cachedKey?.secret === secret) return cachedKey.key
  const key = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
  cachedKey = { secret, key }
  void key.catch(() => {
    if (cachedKey?.key === key) cachedKey = undefined
  })
  return key
}

export async function signToken(
  payload: string,
  context: string,
  secret: string
) {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(context + payload)
  )
  return `${base64url(encoder.encode(payload))}.${base64url(new Uint8Array(mac))}`
}

export async function readToken(
  token: string,
  context: string,
  secret: string
) {
  if (token.length > 512) return null
  const [encoded, signature, ...rest] = token.split(".")
  const payloadBytes = fromBase64url(encoded ?? "")
  const mac = fromBase64url(signature ?? "")
  if (rest.length || !payloadBytes || !mac) return null
  const payload = new TextDecoder().decode(payloadBytes)
  return (await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    mac,
    encoder.encode(context + payload)
  ))
    ? payload
    : null
}

export function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  )
}

export async function hmacHex(payload: string, secret: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, false),
    encoder.encode(payload)
  )
  return toHex(new Uint8Array(signature))
}
