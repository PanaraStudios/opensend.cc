"use node"
import { Resolver } from "node:dns/promises"
import type { GetEmailIdentityResponse } from "@aws-sdk/client-sesv2"
import { identityRecords, type DnsRecord, type RecordDomain } from "./records"
export const canonical = (value: string) =>
  value.trim().toLowerCase().replace(/\.$/, "")
const isSpf = (value: string) => /^v=spf1(\s|$)/i.test(value)
const isDmarc = (value: string) => /^v=dmarc1(\s|;|$)/i.test(value)
/** An SPF policy that authorizes SES to send for its domain. */
const includesSes = (spf: string) =>
  spf.split(/\s+/).includes("include:amazonses.com")
/** Parent zones to try, longest first. Bounded, and never a bare TLD. */
export function zoneCandidates(name: string) {
  const labels = canonical(name).split(".")
  const candidates: string[] = []
  for (let offset = 0; offset <= Math.min(labels.length - 2, 5); offset++)
    candidates.push(labels.slice(offset).join("."))
  return candidates
}
const dnsCode = (e: unknown) =>
  e && typeof e === "object" && "code" in e ? e.code : ""
type Lookup = Pick<
  Resolver,
  "resolveCname" | "resolveMx" | "resolveTxt" | "resolveNs"
> & { resolve4(hostname: string): Promise<string[]> }
type RecordLookup = Pick<Lookup, "resolveCname" | "resolveMx" | "resolveTxt">
/** DNS lookups, each on a resolver of its own. Concurrent queries on one
    resolver share its socket, and behind some NATs (Docker Desktop's, for
    one) the remote answers are dropped, each costing a full timeout. */
export function lookups(timeout: number, servers?: string[]): Lookup {
  const fresh = () => {
    const resolver = new Resolver({ timeout, tries: 1 })
    if (servers) resolver.setServers(servers)
    return resolver
  }
  return {
    resolveCname: (host) => fresh().resolveCname(host),
    resolveMx: (host) => fresh().resolveMx(host),
    resolveTxt: (host) => fresh().resolveTxt(host),
    resolveNs: (host) => fresh().resolveNs(host),
    resolve4: (host) => fresh().resolve4(host),
  }
}
/** One resolver's view of one record. */
async function lookup(
  record: DnsRecord,
  resolver: RecordLookup
): Promise<DnsRecord["status"]> {
  try {
    let found = false
    if (record.type === "CNAME")
      found = (await resolver.resolveCname(record.name)).some(
        (value) => canonical(value) === canonical(record.value)
      )
    else if (record.type === "MX")
      found = (await resolver.resolveMx(record.name)).some(
        (value) =>
          // Inbound mail keeps whatever priority the operator chose.
          (record.kind === "Receiving" || value.priority === record.priority) &&
          canonical(value.exchange) === canonical(record.value)
      )
    else if (record.kind === "DMARC")
      found = (await resolver.resolveTxt(record.name))
        .map((parts) => parts.join(""))
        .some(isDmarc)
    else {
      const spf = (await resolver.resolveTxt(record.name))
        .map((parts) => parts.join(""))
        .filter(isSpf)
      // RFC 7208 allows one SPF policy per name; two make both invalid.
      found = spf.length === 1 && includesSes(spf[0])
    }
    return found ? "verified" : "pending"
  } catch (e) {
    const code = dnsCode(e)
    return code === "ENOTFOUND" || code === "ENODATA"
      ? "pending"
      : "temporary_failure"
  }
}
/** A record any resolver finds is published, and the first to find it
    settles it. Otherwise one a resolver positively did not find is pending,
    and one no resolver could answer for is a temporary failure. */
async function recordStatus(
  record: DnsRecord,
  resolvers: RecordLookup[]
): Promise<DnsRecord["status"]> {
  const answers = resolvers.map((resolver) => lookup(record, resolver))
  try {
    return await Promise.any(
      answers.map(async (answer) => {
        if ((await answer) !== "verified") throw new Error("Not found")
        return "verified" as const
      })
    )
  } catch {
    return (await Promise.all(answers)).includes("pending")
      ? "pending"
      : "temporary_failure"
  }
}
export async function checkRecords(
  records: DnsRecord[],
  resolvers: RecordLookup[]
): Promise<DnsRecord[]> {
  return Promise.all(
    records.map(async (record) => ({
      ...record,
      status: await recordStatus(record, resolvers),
    }))
  )
}
/** The nameservers of the zone that holds `name`, or none. */
async function zoneNameservers(
  name: string,
  resolver: Pick<Lookup, "resolveNs">
) {
  // Subdomains commonly inherit their parent's zone. Bound the lookup work
  // and never query a top-level domain as if it were the user's zone.
  for (const zone of zoneCandidates(name)) {
    try {
      const servers = await resolver.resolveNs(zone)
      if (servers.length) return servers
    } catch (error) {
      const code = dnsCode(error)
      if (code !== "ENODATA" && code !== "ENOTFOUND") return []
    }
  }
  return []
}
/** Lookups against the zone's own nameservers. They answer from the zone
    itself, so a record added a moment ago is found at once, where a recursive
    resolver can keep a cached "not found" for the zone's negative TTL
    (RFC 2308). */
export async function authoritativeLookups(
  name: string,
  recursive: Pick<Lookup, "resolveNs" | "resolve4">
) {
  const servers = await zoneNameservers(name, recursive)
  const addresses = (
    await Promise.allSettled(
      servers.slice(0, 4).map((server) => recursive.resolve4(server))
    )
  ).flatMap((result) => (result.status === "fulfilled" ? result.value : []))
  return addresses.length ? lookups(2000, addresses) : undefined
}

/** A domain's status, read from its SES identity and its live DNS. */
export async function verificationState(
  identity: GetEmailIdentityResponse,
  domain: RecordDomain
) {
  const recursive = lookups(3000)
  const authoritative = await authoritativeLookups(domain.name, recursive)
  const records = await checkRecords(
    identityRecords(domain, identity),
    authoritative ? [authoritative, recursive] : [recursive]
  )
  const sesVerified = !!identity.VerifiedForSendingStatus
  const dkimVerified =
    identity.DkimAttributes?.Status === "SUCCESS" &&
    !!identity.DkimAttributes.SigningEnabled
  const mailFromVerified =
    identity.MailFromAttributes?.MailFromDomainStatus === "SUCCESS" &&
    identity.MailFromAttributes.MailFromDomain ===
      `${domain.customReturnPath}.${domain.name}` &&
    identity.MailFromAttributes.BehaviorOnMxFailure === "REJECT_MESSAGE"
  /* DMARC is advisory, so it never holds a domain back from verified, and
     a resolver that timed out proves nothing: only a record the resolver
     positively did not find keeps a domain partially verified. */
  const allVerified =
    sesVerified &&
    dkimVerified &&
    mailFromVerified &&
    records.every((r) => r.kind === "DMARC" || r.status !== "pending")
  return {
    records,
    sesVerified,
    dkimVerified,
    mailFromVerified,
    status: allVerified
      ? ("verified" as const)
      : sesVerified
        ? ("partially_verified" as const)
        : ("pending" as const),
  }
}

/** Infer the DNS host from all authoritative nameservers, not the registrar. */
export function providerFromNameservers(servers: string[]) {
  if (!servers.length) return undefined
  const normalized = servers.map(canonical)
  if (normalized.every((server) => server.endsWith(".ns.cloudflare.com")))
    return "cloudflare" as const
  if (
    normalized.every((server) =>
      /^ns-\d+\.awsdns-\d+\.(com|net|org|co\.uk)$/.test(server)
    )
  )
    return "route53" as const
  if (normalized.every((server) => server.endsWith(".domaincontrol.com")))
    return "godaddy" as const
  if (normalized.every((server) => server.endsWith(".dns-parking.com")))
    return "hostinger" as const
  if (
    normalized.every(
      (server) =>
        server.endsWith(".registrar-servers.com") ||
        server.endsWith(".namecheaphosting.com")
    )
  )
    return "namecheap" as const
  return "other" as const
}

export async function detectDnsProvider(
  name: string,
  resolver: Pick<Lookup, "resolveNs"> = lookups(2000)
) {
  return providerFromNameservers(await zoneNameservers(name, resolver))
}
