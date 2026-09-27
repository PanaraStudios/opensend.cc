export function createId(prefix: string): string {
  const entropy = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  return `${prefix}_${entropy}`
}

export function createToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 32)
  return `os_${body}`
}

/** Svix's format: the HMAC key's bytes in base64 after `whsec_`, which is
    what every Svix/Resend verification library decodes. Call it where
    `crypto` is a CSPRNG (not in a Convex query or mutation, whose random
    source is seeded). */
export function createWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return `whsec_${btoa(String.fromCharCode(...bytes))}`
}

export function tokenParts(token: string): { prefix: string; last4: string } {
  return {
    prefix: token.slice(0, 10),
    last4: token.slice(-4),
  }
}
