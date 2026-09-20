/** The only public permission registry. offline_access is protocol-internal. */
export const oauthScopes = {
  "emails:send": "Send emails",
  full_access: "Full team access",
} as const
export type OAuthScope = keyof typeof oauthScopes
export const publicScopes = Object.keys(oauthScopes) as OAuthScope[]
export function parseScopes(value: unknown): OAuthScope[] {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Choose an explicit permission")
  const scopes = [...new Set(value.trim().split(/\s+/))]
  if (scopes.some((scope) => !Object.hasOwn(oauthScopes, scope)))
    throw new Error("Unsupported permission")
  return scopes as OAuthScope[]
}
export function validateCallback(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\s\\*#]/.test(value)
  )
    throw new Error("Invalid callback URL")
  const url = new URL(value)
  if (url.username || url.password || url.hash)
    throw new Error("Invalid callback URL")
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
  const native =
    /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+:$/.test(url.protocol) &&
    !["javascript:", "data:", "file:", "vbscript:", "about:", "ftp:"].includes(
      url.protocol
    ) &&
    !url.host &&
    url.pathname.startsWith("/")
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && loopback) &&
    !native
  )
    throw new Error(
      "Use HTTPS, a loopback URL, or a reverse-domain native callback"
    )
  return value
}
export function authContinuation(value: string | null): string {
  if (value?.startsWith("/invitation?")) return value
  if (value && /^\/oauth\/consent\?flow=[a-f0-9]{64}$/.test(value)) return value
  return "/emails"
}
export async function tokenHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}
