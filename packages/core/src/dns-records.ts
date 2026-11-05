/* DNS records a domain shows before SES issues anything. The backend writes
   them; the dashboard previews them for a domain still being set up. */
import type { DnsRecord } from "./validators/ses"

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
export const trackingRecord = (name: string, target: string): DnsRecord => ({
  id: "tracking",
  kind: "Tracking",
  type: "CNAME",
  name,
  value: target,
  ttl: "300",
  status: "pending",
})
