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

export function createWebhookSecret(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return `whsec_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

export function tokenParts(token: string): { prefix: string; last4: string } {
  return {
    prefix: token.slice(0, 10),
    last4: token.slice(-4),
  }
}
