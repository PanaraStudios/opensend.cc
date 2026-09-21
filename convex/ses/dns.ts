"use node"
import { Resolver } from "node:dns/promises"
import type { GetEmailIdentityResponse } from "@aws-sdk/client-sesv2"
import type { Infer } from "convex/values"
import { recordValue } from "./contracts"
export type DnsRecord = Infer<typeof recordValue>
export function identityRecords(
  name: string,
  region: string,
  returnPath: string,
  identity: GetEmailIdentityResponse
): DnsRecord[] {
  const dkim = identity.DkimAttributes
  if (!dkim?.SigningHostedZone || !dkim.Tokens?.length)
    throw new Error(
      "AWS did not return Easy DKIM tokens and a signing hosted zone"
    )
  const records: DnsRecord[] = dkim.Tokens.map((token) => ({
    id: token,
    kind: "DKIM",
    type: "CNAME",
    name: `${token}._domainkey.${name}`,
    value: `${token}.${dkim.SigningHostedZone!.replace(/\.$/, "")}`,
    ttl: "300",
    status: "pending",
  }))
  records.push(
    {
      id: "mail-from-mx",
      kind: "MX",
      type: "MX",
      name: `${returnPath}.${name}`,
      value: `feedback-smtp.${region}.amazonses.com`,
      priority: 10,
      ttl: "300",
      status: "pending",
    },
    {
      id: "mail-from-spf",
      kind: "SPF",
      type: "TXT",
      name: `${returnPath}.${name}`,
      value: "v=spf1 include:amazonses.com ~all",
      ttl: "300",
      status: "pending",
    }
  )
  return records
}
const canonical = (value: string) => value.toLowerCase().replace(/\.$/, "")
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
              value.priority === record.priority &&
              canonical(value.exchange) === canonical(record.value)
          )
        else {
          const spf = (await resolver.resolveTxt(record.name))
            .map((parts) => parts.join(""))
            .filter((value) => value.startsWith("v=spf1 "))
          found =
            spf.length === 1 &&
            spf[0].split(/\s+/).includes("include:amazonses.com")
        }
        return { ...record, status: found ? "verified" : "pending" }
      } catch (e) {
        const code = e && typeof e === "object" && "code" in e ? e.code : ""
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
  const labels = name.split(".")
  // Subdomains commonly inherit their parent's DNS host. Bound the lookup work
  // and never query a top-level domain as if it were the user's DNS provider.
  for (let offset = 0; offset < Math.min(labels.length - 1, 6); offset++) {
    try {
      const servers = await resolver.resolveNs(labels.slice(offset).join("."))
      if (servers.length) return providerFromNameservers(servers)
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error ? error.code : ""
      if (code !== "ENODATA" && code !== "ENOTFOUND") return undefined
    }
  }
  return undefined
}
