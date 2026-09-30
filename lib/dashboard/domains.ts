import {
  dmarcRecord as serverDmarcRecord,
  receivingRecord as serverReceivingRecord,
  trackingRecord as serverTrackingRecord,
} from "../../convex/ses/records"
import { isDomainName, pluralize } from "./format"
import type {
  DnsProvider,
  DnsRecord,
  Domain,
  DomainEventType,
  DomainStatus,
  Region,
} from "./types"
import { REGION_DETAILS } from "./types"

export const DEFAULT_RETURN_PATH = "send"
export const DEFAULT_TRACKING_SUBDOMAIN = "links"
/* "Auto" is what providers show for an inherited TTL; a zone file needs a
   number, and 300s is the usual default. */
const ZONE_TTL = 300

/* ------------------------------------------------------------- providers */

const PROVIDERS: Record<DnsProvider, { label: string; url: string }> = {
  cloudflare: {
    label: "Cloudflare",
    url: "https://dash.cloudflare.com",
  },
  route53: {
    label: "Route 53",
    url: "https://console.aws.amazon.com/route53",
  },
  godaddy: {
    label: "GoDaddy",
    url: "https://dcc.godaddy.com/control/dnsmanagement",
  },
  namecheap: {
    label: "Namecheap",
    url: "https://ap.www.namecheap.com/domains/list",
  },
  other: { label: "Other provider", url: "" },
  hostinger: {
    label: "Hostinger",
    url: "https://hpanel.hostinger.com",
  },
}

export function providerLabel(provider: DnsProvider | undefined): string {
  return provider ? PROVIDERS[provider].label : "Not detected"
}

export function providerUrl(provider: DnsProvider | undefined): string | null {
  const url = provider ? PROVIDERS[provider].url : ""
  return url === "" ? null : url
}

export function regionFlag(region: Region): string {
  return REGION_DETAILS[region]?.flag ?? "🌐"
}

/* ------------------------------------------------------------ validation */

export function normalizeDomainName(value: string): string {
  return value.trim().toLowerCase()
}

/** Error message for the Add domain form, or null when the name is usable. */
export function validateDomainName(
  value: string,
  taken: readonly string[]
): string | null {
  const name = normalizeDomainName(value)
  if (name === "") return "Enter a domain"
  if (!isDomainName(name))
    return "Enter a valid domain, like updates.example.com"
  if (taken.some((item) => normalizeDomainName(item) === name)) {
    return "That domain is already added"
  }
  return null
}

/** A single DNS label, the shape a return-path or tracking subdomain takes. */
function isDnsLabel(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value.trim())
}

export function validateDnsLabel(value: string): string | null {
  return isDnsLabel(value)
    ? null
    : "Use one label of letters, numbers, or hyphens, like send"
}

/* --------------------------------------------------------------- records */

/** Host part of a record name, the way a DNS provider's form asks for it. */
export function dnsHost(name: string, domainName: string): string {
  if (name === domainName || name === "@") return "@"
  const suffix = `.${domainName}`
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

export function trackingEnabled(domain: Domain): boolean {
  return (
    (domain.trackingSubdomain ?? "") !== "" &&
    (domain.openTracking || domain.clickTracking)
  )
}

export function sendingEnabled(domain: Domain): boolean {
  return domain.sending !== false
}

/** A record the switches ask for before the server has stored it: the
    server's own values, not yet started. */
const unstarted = (domain: Domain, record: DnsRecord): DnsRecord => ({
  ...record,
  id: `${domain.id}_${record.id}`,
  ttl: "Auto",
  status: "not_started",
})

function trackingRecord(domain: Domain): DnsRecord {
  return unstarted(
    domain,
    serverTrackingRecord(
      `${domain.trackingSubdomain}.${domain.name}`,
      domain.trackingTarget ??
        domain.records.find((r) => r.kind === "Tracking")?.value ??
        ""
    )
  )
}

function receivingRecord(domain: Domain): DnsRecord {
  return unstarted(domain, serverReceivingRecord(domain.name, domain.region))
}

/** The policy we recommend. Only synthesized for a domain stored before SES
    started returning one; the stored record wins as soon as it arrives. */
function dmarcRecord(domain: Domain): DnsRecord {
  return unstarted(domain, serverDmarcRecord(domain.name))
}

/** Stored records, plus the optional ones the current switches ask for and
    minus the ones they turn off. A record that appears starts unverified,
    which is what pulls a verified domain back to partially verified. */
export function domainRecords(domain: Domain): DnsRecord[] {
  const tracking = trackingEnabled(domain)
  /* A stored tracking record only survives under the same name: a new
     subdomain is a different CNAME, and it has not been verified yet. */
  const trackingName = trackingRecord(domain).name
  const records = domain.records.filter((record) => {
    if (record.kind === "Tracking") {
      return tracking && record.name === trackingName
    }
    if (record.kind === "Receiving") return domain.receiving
    return true
  })
  if (tracking && !records.some((record) => record.kind === "Tracking")) {
    records.push(trackingRecord(domain))
  }
  if (
    domain.receiving &&
    !records.some((record) => record.kind === "Receiving")
  ) {
    records.push(receivingRecord(domain))
  }
  if (!records.some((record) => record.kind === "DMARC")) {
    records.push(dmarcRecord(domain))
  }
  return records
}

/** Records that decide the domain status. DMARC is recommended, not required,
    and the sending block only counts while sending is on. */
function requiredRecords(domain: Domain, records: DnsRecord[]): DnsRecord[] {
  return records.filter((record) => {
    if (record.kind === "DMARC") return false
    if (record.kind === "SPF" || record.kind === "MX")
      return sendingEnabled(domain)
    return true
  })
}

export function deriveDomainStatus(
  domain: Domain,
  records: DnsRecord[] = domainRecords(domain)
): DomainStatus {
  const required = requiredRecords(domain, records)
  if (required.length === 0) return "not_started"
  const some = (status: DomainStatus) =>
    required.some((record) => record.status === status)
  const every = (status: DomainStatus) =>
    required.every((record) => record.status === status)
  if (some("failed")) return "failed"
  if (some("temporary_failure")) return "temporary_failure"
  if (every("verified")) return "verified"
  if (every("not_started")) return "not_started"
  if (some("verified")) return "partially_verified"
  return "pending"
}

export type DomainEventStep = {
  type: DomainEventType
  label: string
  at?: number
}

/** The four-step trail under the meta strip. A step without a time is one
    this domain has not reached, and renders dimmed. */
export function domainEventSteps(domain: Domain): DomainEventStep[] {
  const partial = domain.partiallyVerifiedAt || undefined
  return [
    {
      type: "added",
      label: "Domain added",
      at: domain.createdAt,
    },
    {
      type: "dns_verified",
      label: "DNS verified",
      at: domain.dnsVerifiedAt || undefined,
    },
    ...(partial !== undefined || domain.status === "partially_verified"
      ? [
          {
            type: "partially_verified" as const,
            label: "Partially verified",
            at: partial,
          },
        ]
      : []),
    {
      type: "verified",
      label: "Domain verified",
      at: domain.verifiedAt || undefined,
    },
  ]
}

/* -------------------------------------------------------------- sections */

type DomainRecordSection = {
  id: "verification" | "sending" | "receiving" | "dmarc"
  title: string
  /** Record type this block is about, linked to the docs. */
  docLabel: string
  description: string
  /** Which domain switch owns the block, when one does. */
  toggle?: "sending" | "receiving"
  enabled: boolean
  showPriority: boolean
  records: DnsRecord[]
}

/** The Records tab, top to bottom. One shape for every block so the table
    below each heading is the same component. */
export function domainRecordSections(
  domain: Domain,
  records: DnsRecord[] = domainRecords(domain)
): DomainRecordSection[] {
  const of = (...kinds: DnsRecord["kind"][]) =>
    records.filter((record) => kinds.includes(record.kind))
  return [
    {
      id: "verification",
      title: "Domain Verification",
      docLabel: "DKIM",
      description:
        "Proves you own this domain and signs every message Opensend sends through your SES account.",
      enabled: true,
      showPriority: false,
      records: of("DKIM"),
    },
    {
      id: "sending",
      title: "Enable Sending",
      docLabel: "SPF",
      description:
        "Lets receiving servers accept mail from SES and routes bounces back to your return-path.",
      toggle: "sending",
      enabled: sendingEnabled(domain),
      showPriority: true,
      records: of("SPF", "MX"),
    },
    {
      id: "receiving",
      title: "Enable Receiving",
      docLabel: "MX",
      description:
        "Points inbound mail for this domain at SES. The MX record replaces the mail provider the domain uses today, such as Google Workspace, so use a subdomain if that mailbox must keep working.",
      toggle: "receiving",
      enabled: domain.receiving,
      showPriority: true,
      records: of("Receiving"),
    },
    {
      id: "dmarc",
      title: "Recommended",
      docLabel: "DMARC",
      description:
        "Tells inboxes what to do with mail that fails SPF or DKIM. Optional, but it improves deliverability.",
      enabled: true,
      showPriority: false,
      records: of("DMARC"),
    },
  ]
}

export function domainTrackingRecords(domain: Domain): DnsRecord[] {
  return domainRecords(domain).filter((record) => record.kind === "Tracking")
}

/* --------------------------------------------------------------- banners */

export type DomainBanner = {
  tone: "default" | "success" | "warning" | "destructive"
  title: string
  description: string
}

export function domainBanner(domain: Domain): DomainBanner {
  /* Every record is published, but Amazon SES has not confirmed them yet. SES
     checks DNS on its own schedule, so this is the wait people otherwise
     mistake for missing records. */
  if (domain.status !== "verified" && deriveDomainStatus(domain) === "verified")
    return {
      tone: "default",
      title: "Records found",
      description:
        "Every record is published. Amazon SES confirms them on its own schedule, which can take up to 72 hours. We keep checking automatically.",
    }
  switch (domain.status) {
    case "verified":
      return {
        tone: "success",
        title: "Domain verified",
        description: "Your domain is ready to send emails.",
      }
    case "partially_verified":
      return {
        tone: "warning",
        title: "Domain partially verified",
        description:
          "Some records resolve and some do not. The unverified rows below are still missing at your DNS provider.",
      }
    case "pending":
      return {
        tone: "warning",
        title: "Waiting for your DNS records",
        description:
          "Add the records at your DNS provider, then click Check DNS records. We also check them automatically for 72 hours, since DNS changes can take that long to propagate.",
      }
    case "failed":
      return {
        tone: "destructive",
        title: "Verification failed",
        description:
          "We could not find these records at your DNS provider. Review them, then click Check DNS records to try again.",
      }
    case "temporary_failure":
      return {
        tone: "warning",
        title: "Temporary failure",
        description:
          "Your DNS provider did not answer our last lookup. Click Check DNS records to try again.",
      }
    case "not_started":
      return {
        tone: "default",
        title: "Verification not started",
        description:
          "Add the records below at your DNS provider, then click Check DNS records.",
      }
  }
}

const TOAST_TYPE = {
  success: "success",
  default: "info",
  warning: "warning",
  destructive: "error",
} as const

/** What a finished "Check DNS records" found, as a toast. */
export function domainCheckResult(domain: Domain) {
  const missing = requiredRecords(domain, domainRecords(domain)).filter(
    (record) => record.status === "pending"
  ).length
  const banner = domainBanner(domain)
  return {
    type: TOAST_TYPE[banner.tone],
    title: missing
      ? `${pluralize(missing, "record")} not found yet`
      : banner.title,
  }
}

/* --------------------------------------------------------------- exports */

function zoneLine(record: DnsRecord, domainName: string): string {
  const name = record.name === "@" ? domainName : record.name
  const data =
    record.type === "TXT"
      ? `"${record.value}"`
      : `${record.priority === undefined ? "" : `${record.priority} `}${record.value}.`
  return `${name}.\t${ZONE_TTL}\tIN\t${record.type}\t${data}`
}

/** BIND-style zone file for the records this domain needs, ready to import
    at a provider that accepts one. */
export function domainZoneFile(
  domain: Domain,
  records: DnsRecord[] = domainRecords(domain)
): string {
  const lines = records.map((record) => zoneLine(record, domain.name))
  return [`; Opensend DNS records for ${domain.name}`, ...lines].join("\n")
}

const csvCell = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`

/** The same records as a spreadsheet, for a provider that imports CSV. */
export function domainCsvFile(
  domain: Domain,
  records: DnsRecord[] = domainRecords(domain)
): string {
  const rows = [
    ["Type", "Name", "Content", "TTL", "Priority"],
    ...records.map((record) => [
      record.type,
      record.name,
      record.value,
      record.ttl,
      record.priority ?? "",
    ]),
  ]
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n")
}
