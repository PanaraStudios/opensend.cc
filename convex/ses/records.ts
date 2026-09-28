import type { GetEmailIdentityResponse } from "@aws-sdk/client-sesv2"
import type { Infer } from "convex/values"
import type { Doc } from "../_generated/dataModel"
import { recordValue } from "./contracts"
export type DnsRecord = Infer<typeof recordValue>
/** The domain fields its DNS records are derived from. */
export type RecordDomain = Pick<
  Doc<"domains">,
  | "name"
  | "region"
  | "customReturnPath"
  | "receiving"
  | "trackingSubdomain"
  | "openTracking"
  | "clickTracking"
  | "trackingTarget"
>
// Recommended, never required: any existing policy stays authoritative.
export const dmarcRecord = (name: string): DnsRecord => ({
  id: "dmarc",
  kind: "DMARC",
  type: "TXT",
  name: `_dmarc.${name}`,
  value: "v=DMARC1; p=none;",
  ttl: "300",
  status: "pending",
})
export const receivingRecord = (name: string, region: string): DnsRecord => ({
  id: "receiving-mx",
  kind: "Receiving",
  type: "MX",
  name,
  value: `inbound-smtp.${region}.amazonaws.com`,
  priority: 10,
  ttl: "300",
  status: "pending",
})
/** The tracking host while a subdomain is set and some tracking is on, as
    the dashboard's `trackingEnabled` reads it. */
export const trackingHost = (domain: RecordDomain) =>
  domain.trackingSubdomain && (domain.openTracking || domain.clickTracking)
    ? `${domain.trackingSubdomain}.${domain.name}`
    : null
export const trackingRecord = (name: string, target: string): DnsRecord => ({
  id: "tracking",
  kind: "Tracking",
  type: "CNAME",
  name,
  value: target,
  ttl: "300",
  status: "pending",
})
/** The records that never depend on AWS, so a domain shows them the moment it
    is added, before SES has issued its DKIM keys. */
export function mailRecords(domain: RecordDomain): DnsRecord[] {
  const mailFrom = `${domain.customReturnPath}.${domain.name}`
  return [
    {
      id: "mail-from-mx",
      kind: "MX",
      type: "MX",
      name: mailFrom,
      value: `feedback-smtp.${domain.region}.amazonses.com`,
      priority: 10,
      ttl: "300",
      status: "pending",
    },
    {
      id: "mail-from-spf",
      kind: "SPF",
      type: "TXT",
      name: mailFrom,
      value: "v=spf1 include:amazonses.com ~all",
      ttl: "300",
      status: "pending",
    },
    dmarcRecord(domain.name),
    ...(domain.receiving ? [receivingRecord(domain.name, domain.region)] : []),
    ...(trackingHost(domain) && domain.trackingTarget
      ? [trackingRecord(trackingHost(domain)!, domain.trackingTarget!)]
      : []),
  ]
}
/** Every record the domain needs: SES's Easy DKIM CNAMEs, then the rest. */
export function identityRecords(
  domain: RecordDomain,
  identity: Pick<GetEmailIdentityResponse, "DkimAttributes">
): DnsRecord[] {
  const dkim = identity.DkimAttributes
  if (!dkim?.SigningHostedZone || !dkim.Tokens?.length)
    throw new Error(
      "AWS did not return Easy DKIM tokens and a signing hosted zone"
    )
  const zone = dkim.SigningHostedZone.replace(/\.$/, "")
  return [
    ...dkim.Tokens.map((token): DnsRecord => ({
      id: token,
      kind: "DKIM",
      type: "CNAME",
      name: `${token}._domainkey.${domain.name}`,
      value: `${token}.${zone}`,
      ttl: "300",
      status: "pending",
    })),
    ...mailRecords(domain),
  ]
}
