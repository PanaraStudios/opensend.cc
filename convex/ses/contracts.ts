import { v, type Infer } from "convex/values"
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
export const regions = [
  "us-east-1",
  "eu-west-1",
  "sa-east-1",
  "ap-northeast-1",
] as const
export const regionValue = v.union(
  ...regions.map((region) => v.literal(region))
)
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
  kind: v.union(
    v.literal("DKIM"),
    v.literal("MX"),
    v.literal("SPF"),
    v.literal("DMARC"),
    v.literal("Receiving")
  ),
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
export const domainOperationValue = v.union(
  v.literal("provision"),
  v.literal("refresh"),
  v.literal("settings"),
  v.literal("remove")
)
/** A failed refresh or settings run leaves AWS exactly as the last successful
    run left it, so the domain keeps everything that run proved. Only an
    unfinished provision or a removal leaves it unusable. */
export const provisioned = (domain: {
  phase: Infer<typeof phaseValue>
  operation: Infer<typeof domainOperationValue>
}) =>
  domain.phase === "ready" ||
  (domain.phase === "failed" &&
    (domain.operation === "refresh" || domain.operation === "settings"))
/** A tenant that finished provisioning and is not being removed. */
export const tenantProvisioned = (tenant: {
  phase: Infer<typeof phaseValue>
  operation: "provision" | "remove"
  deleted: boolean
}) =>
  tenant.phase === "ready" &&
  !tenant.deleted &&
  tenant.operation === "provision"
/** A domain's tenant must be its own team's, in the domain's region. */
export const tenantMatches = (
  tenant: { organizationId: string; region: string },
  domain: { organizationId: string; region: string }
) =>
  tenant.organizationId === domain.organizationId &&
  tenant.region === domain.region

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
