import type { GetEmailIdentityResponse } from "@aws-sdk/client-sesv2"
import type { Doc } from "../_generated/dataModel"
import type { DnsRecord } from "@opensend/core/validators/ses"
import {
  dmarcRecord,
  receivingRecord,
  trackingRecord,
} from "@opensend/core/dns-records"

export type { DnsRecord }
export { dmarcRecord, receivingRecord, trackingRecord }
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
/** Whether a domain's own status waits on this record. DMARC is advisory,
    and, as on Resend, tracking and receiving records carry their own status
    without holding a verified domain back from sending. */
export const verifiesDomain = (record: Pick<DnsRecord, "kind">) =>
  record.kind !== "DMARC" &&
  record.kind !== "Tracking" &&
  record.kind !== "Receiving"
/** The tracking host while a subdomain is set and some tracking is on, as
    the dashboard's `trackingEnabled` reads it. */
export const trackingHost = (domain: RecordDomain) =>
  domain.trackingSubdomain && (domain.openTracking || domain.clickTracking)
    ? `${domain.trackingSubdomain}.${domain.name}`
    : null
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
