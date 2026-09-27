"use node"
import { Resolver } from "node:dns/promises"
import type { GetEmailIdentityResponse } from "@aws-sdk/client-sesv2"
import type { Doc } from "../_generated/dataModel"
import { identityRecords, type DnsRecord } from "./records"
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
export async function checkRecords(
  records: DnsRecord[],
  resolver = new Resolver({ timeout: 3000, tries: 1 })
): Promise<DnsRecord[]> {
  return Promise.all(
    records.map(async (record) => {
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
              (record.kind === "Receiving" ||
                value.priority === record.priority) &&
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
        return { ...record, status: found ? "verified" : "pending" }
      } catch (e) {
        const code = dnsCode(e)
        return {
          ...record,
          status:
            code === "ENOTFOUND" || code === "ENODATA"
              ? "pending"
              : "temporary_failure",
        }
      }
    })
  )
}

/** A domain's status, read from its SES identity and its live DNS. */
export async function verificationState(
  identity: GetEmailIdentityResponse,
  domain: Pick<
    Doc<"domains">,
    "name" | "region" | "customReturnPath" | "receiving"
  >
) {
  const records = await checkRecords(identityRecords(domain, identity))
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
  resolver: Pick<Resolver, "resolveNs"> = new Resolver({
    timeout: 2000,
    tries: 1,
  })
) {
  // Subdomains commonly inherit their parent's DNS host. Bound the lookup work
  // and never query a top-level domain as if it were the user's DNS provider.
  for (const zone of zoneCandidates(name)) {
    try {
      const servers = await resolver.resolveNs(zone)
      if (servers.length) return providerFromNameservers(servers)
    } catch (error) {
      const code = dnsCode(error)
      if (code !== "ENODATA" && code !== "ENOTFOUND") return undefined
    }
  }
  return undefined
}
