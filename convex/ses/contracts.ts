import { v, ConvexError, type Infer } from "convex/values"
import { isPublicHostname } from "../../lib/net/public-host"
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
/** A DNS provider that applies our Domain Connect template: where to open it. */
export const domainConnectValue = v.object({
  zone: v.string(),
  providerName: v.string(),
  urlSyncUX: v.string(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
})

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
    v.literal("Receiving"),
    v.literal("Tracking")
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
  if (!allowLocal && !isPublicHostname(url.hostname))
    throw new Error("Use a public HTTPS hostname")
  return url.origin
}
/** Bumped whenever the generated IAM policy gains permissions. An installation
    without a recorded revision runs revision 1, the setup-only policy. */
export const POLICY_REVISION = 2
export function resourcePrefix(installationId: string) {
  return `opensend-${installationId}`
}
export function teamTenantName(installationId: string, organizationId: string) {
  return `${resourcePrefix(installationId)}-t-${organizationId.slice(-16)}`
}

/* SES receives mail only in some regions:
   https://docs.aws.amazon.com/general/latest/gr/ses.html#ses_inbound_endpoints */
const RECEIVING_REGIONS = new Set([
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "af-south-1",
  "ap-southeast-3",
  "ap-south-1",
  "ap-northeast-3",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ca-central-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-south-1",
  "eu-west-3",
  "eu-north-1",
  "il-central-1",
  "me-south-1",
  "sa-east-1",
])
export function requireReceivingRegion(region: string) {
  if (!RECEIVING_REGIONS.has(region))
    throw new ConvexError(
      `Amazon SES does not receive email in ${region}. Use a domain in a region that supports receiving.`
    )
}
/** "ap-northeast-1" → "apne1": short enough for an S3 bucket name. */
export function shortRegion(region: string) {
  const [area, direction, number] = region.split("-")
  const compass = direction
    .replace(/north/g, "n")
    .replace(/south/g, "s")
    .replace(/east/g, "e")
    .replace(/west/g, "w")
    .replace(/central/g, "c")
  return `${area}${compass}${number}`
}
/** The region's inbound mail bucket. S3 names are global and at most 63
    characters; the IAM policy allows `${prefix}-inbound*`. */
export function inboundBucketName(installationId: string, region: string) {
  const name = `${resourcePrefix(installationId)}-inbound-${shortRegion(region)}`
  if (name.length > 63 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name))
    throw new ConvexError("This installation ID is too long for an S3 bucket")
  return name
}
/** The rule set Opensend creates when a region has no active one. */
export const inboundRuleSetName = (installationId: string) =>
  `${resourcePrefix(installationId)}-inbound`
/** One receipt rule per domain, named like its configuration set. */
export const receiptRuleName = (installationId: string, domainId: string) =>
  `${resourcePrefix(installationId)}-${domainId.slice(-12)}`
/** Tracking always returns to this self-hosted installation. */
export function trackingTarget(callbackOrigin: string) {
  const url = new URL(callbackOrigin)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Tracking requires a public HTTPS callback origin")
  return url.hostname
}
