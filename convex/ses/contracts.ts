import { v } from "convex/values"
export const setupStepValue = v.union(
  v.literal("welcome"),
  v.literal("aws"),
  v.literal("callback"),
  v.literal("resources"),
  v.literal("team"),
  v.literal("domain")
)
export const adoptionValue = v.object({
  fingerprint: v.string(),
  approved: v.boolean(),
  configurationSet: v.optional(v.string()),
  mailFromDomain: v.optional(v.string()),
  behaviorOnMxFailure: v.optional(v.string()),
})
export const dnsProviderValue = v.union(
  v.literal("cloudflare"),
  v.literal("route53"),
  v.literal("godaddy"),
  v.literal("namecheap"),
  v.literal("hostinger"),
  v.literal("other")
)

// Supported commercial regions match the dashboard's existing region selector.
export const regionValue = v.union(
  v.literal("us-east-1"),
  v.literal("eu-west-1"),
  v.literal("sa-east-1"),
  v.literal("ap-northeast-1")
)
export const regions = [
  "us-east-1",
  "eu-west-1",
  "sa-east-1",
  "ap-northeast-1",
] as const
export const phaseValue = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("ready"),
  v.literal("failed")
)
export const credentialsValue = v.union(
  v.object({ kind: v.literal("role") }),
  v.object({
    kind: v.literal("keys"),
    accessKeyId: v.string(),
    secretAccessKey: v.string(),
    sessionToken: v.optional(v.string()),
  })
)
export const quotaValue = v.object({
  production: v.boolean(),
  sendingEnabled: v.boolean(),
  daily: v.number(),
  rate: v.number(),
  sent: v.number(),
})
export const recordValue = v.object({
  id: v.string(),
  kind: v.union(v.literal("DKIM"), v.literal("MX"), v.literal("SPF")),
  type: v.union(v.literal("CNAME"), v.literal("MX"), v.literal("TXT")),
  name: v.string(),
  value: v.string(),
  ttl: v.string(),
  priority: v.optional(v.number()),
  status: v.union(
    v.literal("pending"),
    v.literal("verified"),
    v.literal("temporary_failure")
  ),
})
export const domainStatusValue = v.union(
  v.literal("pending"),
  v.literal("verified"),
  v.literal("partially_verified"),
  v.literal("failed")
)
export const tlsValue = v.union(
  v.literal("opportunistic"),
  v.literal("enforced")
)

export function validateRegion(value: string) {
  if (!regions.some((r) => r === value))
    throw new Error("Unsupported SES region")
}
export function installationUrl(value: string, allowLocal = false) {
  const url = new URL(value)
  const local = ["localhost", "127.0.0.1", "host.docker.internal"].includes(
    url.hostname
  )
  if (
    (url.protocol !== "https:" &&
      !(allowLocal && local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Use an HTTPS origin without a path, query, or credentials")
  if (
    !allowLocal &&
    (local ||
      !url.hostname.includes(".") ||
      /^[\d.]+$/.test(url.hostname) ||
      url.hostname.includes(":"))
  )
    throw new Error("Use a public HTTPS hostname")
  return url.origin
}
export function resourcePrefix(installationId: string) {
  return `opensend-${installationId}`
}
export function teamTenantName(installationId: string, organizationId: string) {
  return `${resourcePrefix(installationId)}-t-${organizationId.slice(-16)}`
}
