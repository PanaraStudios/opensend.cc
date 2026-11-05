/* Validators the schema and the apps share. The schema (convex/tables)
   uses them for its fields; lib/ derives its types from them. */
import { v, type Infer } from "convex/values"

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
export type DnsRecord = Infer<typeof recordValue>
