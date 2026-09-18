import { isDomainName } from "./format"
import type {
  DnsProvider,
  DnsRecord,
  Domain,
  DomainEvent,
  DomainEventType,
  DomainStatus,
  Region,
} from "./types"

export const DEFAULT_RETURN_PATH = "send"
export const DEFAULT_TRACKING_SUBDOMAIN = "links"
/* "Auto" is what providers show for an inherited TTL; a zone file needs a
   number, and 300s is the usual default. */
const ZONE_TTL = 300

/* ------------------------------------------------------------- providers */

const PROVIDERS: Record<
  DnsProvider,
  { label: string; url: string; auto: boolean }
> = {
  cloudflare: {
    label: "Cloudflare",
    url: "https://dash.cloudflare.com",
    auto: true,
  },
  route53: {
    label: "Route 53",
    url: "https://console.aws.amazon.com/route53",
    auto: false,
  },
  godaddy: {
    label: "GoDaddy",
    url: "https://dcc.godaddy.com/control/dnsmanagement",
    auto: false,
  },
  namecheap: {
    label: "Namecheap",
    url: "https://ap.www.namecheap.com/domains/list",
    auto: false,
  },
  other: { label: "Other provider", url: "", auto: false },
}

export function providerLabel(provider: DnsProvider | undefined): string {
  return provider ? PROVIDERS[provider].label : "Not detected"
}

export function providerUrl(provider: DnsProvider | undefined): string | null {
  const url = provider ? PROVIDERS[provider].url : ""
  return url === "" ? null : url
}

/** Only providers we hold an API token for can be written to for you. */
export function canAutoConfigure(provider: DnsProvider | undefined): boolean {
  return provider ? PROVIDERS[provider].auto : false
}

const REGION_FLAGS: Record<Region, string> = {
  "us-east-1": "🇺🇸",
  "eu-west-1": "🇮🇪",
  "sa-east-1": "🇧🇷",
  "ap-northeast-1": "🇯🇵",
}

export function regionFlag(region: Region): string {
  return REGION_FLAGS[region] ?? "🌐"
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
export function isDnsLabel(value: string): boolean {
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

/** Long values such as a DKIM key read better with the middle elided. The
    full value is still what a copy button hands over. */
export function truncateMiddle(value: string, head = 16, tail = 14): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
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

function trackingRecord(domain: Domain): DnsRecord {
  return {
    id: `${domain.id}_tracking`,
    kind: "Tracking",
    type: "CNAME",
    name: `${domain.trackingSubdomain}.${domain.name}`,
    value: `r.${domain.region}.awstrack.me`,
    ttl: "Auto",
    status: "not_started",
  }
}

function receivingRecord(domain: Domain): DnsRecord {
  return {
    id: `${domain.id}_receiving`,
    kind: "Receiving",
    type: "MX",
    name: domain.name,
    value: `inbound-smtp.${domain.region}.amazonaws.com`,
    ttl: "Auto",
    priority: 10,
    status: "not_started",
  }
}

/** Stored records, plus the optional ones the current switches ask for and
    minus the ones they turn off. A record that appears starts unverified,
    which is what pulls a verified domain back to partially verified. */
export function domainRecords(domain: Domain): DnsRecord[] {
  const tracking = trackingEnabled(domain)
  const records = domain.records.filter((record) => {
    if (record.kind === "Tracking") return tracking
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

/* ---------------------------------------------------------------- events */

/** The milestone the current status stands at, if it is one of them. A
    domain sits at exactly one of these at a time. */
function statusMilestone(status: DomainStatus): DomainEventType | null {
  if (status === "verified") return "verified"
  if (status === "partially_verified") return "partially_verified"
  return null
}

const STATUS_MILESTONES: DomainEventType[] = ["partially_verified", "verified"]

/** Milestones this domain has reached, newest last. "Domain added" and "DNS
    verified" are one-time facts, but the two status milestones are exclusive:
    turning receiving on drops a verified domain back to partially verified, so
    its verified event is no longer true and goes away. Re-verifying stamps a
    fresh time, which keeps the trail in order. */
export function domainEvents(
  domain: Domain,
  status: DomainStatus,
  records: DnsRecord[],
  now: number
): DomainEvent[] {
  const milestone = statusMilestone(status)
  const events = (domain.events ?? []).filter(
    (event) =>
      !STATUS_MILESTONES.includes(event.type) || event.type === milestone
  )
  if (!events.some((event) => event.type === "added")) {
    events.unshift({ type: "added", at: domain.createdAt })
  }
  const dkimVerified = records.some(
    (item) => item.kind === "DKIM" && item.status === "verified"
  )
  if (dkimVerified && !events.some((event) => event.type === "dns_verified")) {
    events.push({ type: "dns_verified", at: now })
  }
  if (!milestone) return events

  const reached = events.find((event) => event.type === milestone)
  const latestOther = events.reduce(
    (latest, event) =>
      event.type === milestone ? latest : Math.max(latest, event.at),
    0
  )
  /* Kept if it is still the latest thing that happened, re-stamped when an
     earlier milestone has since been overtaken by a later one. */
  if (reached && reached.at >= latestOther) return events
  return [
    ...events.filter((event) => event.type !== milestone),
    { type: milestone, at: now },
  ]
}

export type DomainEventStep = {
  type: DomainEventType
  label: string
  at?: number
}

/** The four-step trail under the meta strip. A step without a time is one
    this domain has not reached, and renders dimmed. */
export function domainEventSteps(domain: Domain): DomainEventStep[] {
  const events = domain.events ?? []
  const at = (type: DomainEventType) =>
    events.find((event) => event.type === type)?.at
  const partial = at("partially_verified")
  return [
    {
      type: "added",
      label: "Domain added",
      at: at("added") ?? domain.createdAt,
    },
    { type: "dns_verified", label: "DNS verified", at: at("dns_verified") },
    ...(partial !== undefined || domain.status === "partially_verified"
      ? [
          {
            type: "partially_verified" as const,
            label: "Partially verified",
            at: partial,
          },
        ]
      : []),
    { type: "verified", label: "Domain verified", at: at("verified") },
  ]
}

/* -------------------------------------------------------------- lifecycle */

/** Records, status, and events brought back in line with the switches.
    Every write to a domain goes through here. */
export function reconcileDomain(domain: Domain, now: number): Domain {
  const records = domainRecords(domain)
  const status = deriveDomainStatus(domain, records)
  return {
    ...domain,
    sending: sendingEnabled(domain),
    customReturnPath: domain.customReturnPath || DEFAULT_RETURN_PATH,
    trackingSubdomain: domain.trackingSubdomain ?? "",
    records,
    status,
    events: domainEvents(domain, status, records, now),
  }
}

/** Backfill for a workspace parsed out of localStorage. Deterministic, so a
    seeded domain reconciles to itself and hydration stays quiet. */
export function normalizeDomain(domain: Domain): Domain {
  return reconcileDomain(domain, domain.createdAt)
}

/** The simulated lookup: every record this domain needs now resolves. */
export function verifyDomainRecords(domain: Domain, now: number): Domain {
  return reconcileDomain(
    {
      ...domain,
      records: domainRecords(domain).map((record) => ({
        ...record,
        status: "verified" as const,
      })),
    },
    now
  )
}

/* -------------------------------------------------------------- sections */

export type DomainRecordSection = {
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
export function domainRecordSections(domain: Domain): DomainRecordSection[] {
  const records = domainRecords(domain)
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
        "Delivers inbound mail for this domain to SES. Messages land under Emails → Receiving.",
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
        "Tells inboxes what to do with mail that fails SPF or DKIM. Optional, but it lifts deliverability.",
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

export function domainBanner(status: DomainStatus): DomainBanner {
  switch (status) {
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
        title: "Looking for your DNS records",
        description:
          "We check again every few minutes. DNS changes can take up to 72 hours to propagate.",
      }
    case "failed":
      return {
        tone: "destructive",
        title: "Verification failed",
        description:
          "We could not find these records at your DNS provider. Check them, then restart verification.",
      }
    case "temporary_failure":
      return {
        tone: "warning",
        title: "Temporary failure",
        description:
          "Your DNS provider did not answer our last lookup. We will try again shortly.",
      }
    case "not_started":
      return {
        tone: "default",
        title: "Verification not started",
        description:
          "Add the records below at your DNS provider, then start verification.",
      }
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
export function domainZoneFile(domain: Domain): string {
  const lines = domainRecords(domain).map((record) =>
    zoneLine(record, domain.name)
  )
  return [`; Opensend DNS records for ${domain.name}`, ...lines].join("\n")
}
