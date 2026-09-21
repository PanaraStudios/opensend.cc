"use node"
import { v, ConvexError } from "convex/values"
import { action } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
  type Change,
} from "@aws-sdk/client-route-53"
import { awsError, connectionConfig } from "./aws"
import {
  canonical,
  parseTxtValue,
  planDnsWrites,
  quoteTxtValue,
  requireCloudflareToken,
  zoneCandidates,
  type DesiredRecord,
  type DnsConflict,
  type DnsPlan,
  type ExistingRecord,
  type PlannedWrite,
} from "./dnsWriters"

type Progress = { created: number }
const pending = (records: DesiredRecord[]) =>
  records.filter((record) => record.status !== "verified")
const targets = (records: DesiredRecord[]) => [
  ...new Set(pending(records).map((record) => canonical(record.name))),
]

const CLOUDFLARE = "https://api.cloudflare.com/client/v4"
type CloudflareBody = {
  success?: boolean
  result?: unknown
  errors?: { code?: number }[]
}
/** The token authenticates every call and must never reach a message or log. */
async function cloudflare(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${CLOUDFLARE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  })
  if (response.status === 401 || response.status === 403)
    throw new ConvexError(
      "Cloudflare rejected this token. It needs Zone → DNS → Edit for this zone."
    )
  const body = (await response
    .json()
    .catch(() => null)) as CloudflareBody | null
  if (!response.ok || !body?.success)
    // Cloudflare echoes request details in its messages. Report codes only.
    throw new ConvexError(
      `Cloudflare rejected the request (HTTP ${response.status}${
        body?.errors?.length
          ? `, code ${body.errors.map((e) => e.code ?? 0).join("/")}`
          : ""
      }).`
    )
  return body.result
}
async function cloudflareZone(token: string, name: string) {
  for (const candidate of zoneCandidates(name)) {
    const zones = (await cloudflare(
      token,
      `/zones?name=${encodeURIComponent(candidate)}`
    )) as { id?: string; name?: string }[] | null
    const zone = zones?.find((z) => canonical(z.name ?? "") === candidate)
    // The id is interpolated into later paths; accept only Cloudflare's format.
    if (zone?.id && /^[0-9a-f]{32}$/.test(zone.id)) return zone.id
  }
  throw new ConvexError(
    "This token can't see a Cloudflare zone for this domain. Check the zone and the token's scope."
  )
}
async function writeCloudflare(
  token: string,
  name: string,
  records: DesiredRecord[],
  progress: Progress
): Promise<DnsPlan> {
  const zoneId = await cloudflareZone(token, name)
  const existing: ExistingRecord[] = []
  for (const name of targets(records)) {
    const rows = (await cloudflare(
      token,
      `/zones/${zoneId}/dns_records?per_page=100&name=${encodeURIComponent(name)}`
    )) as
      | { name?: string; type?: string; content?: string; priority?: number }[]
      | null
    for (const row of rows ?? [])
      existing.push({
        name: row.name ?? name,
        type: row.type ?? "",
        value:
          row.type === "TXT"
            ? parseTxtValue(row.content ?? "")
            : (row.content ?? ""),
        priority: row.priority,
      })
  }
  const plan = planDnsWrites(records, existing)
  // Cloudflare stores one record per value, so preserved values need no rewrite.
  for (const { record } of plan.writes) {
    await cloudflare(token, `/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: record.type,
        name: record.name,
        content: record.value,
        ttl: 300,
        ...(record.type === "CNAME" ? { proxied: false } : {}),
        ...(record.type === "MX" ? { priority: record.priority ?? 10 } : {}),
      }),
    })
    progress.created++
  }
  return plan
}

function resourceRecord(
  type: string,
  name: string,
  value: string
): ExistingRecord {
  if (type === "TXT") return { name, type, value: parseTxtValue(value) }
  if (type === "MX") {
    const [priority, ...rest] = value.trim().split(/\s+/)
    return { name, type, value: rest.join(" "), priority: Number(priority) }
  }
  return { name, type, value }
}
function route53Change({ record, preserve }: PlannedWrite): Change {
  const values =
    record.type === "TXT"
      ? [...preserve, record.value].map(quoteTxtValue)
      : record.type === "MX"
        ? [`${record.priority ?? 10} ${record.value}`]
        : [record.value]
  return {
    // Preserving other values means rewriting the whole set, never replacing it.
    Action: preserve.length ? "UPSERT" : "CREATE",
    ResourceRecordSet: {
      Name: record.name,
      Type: record.type,
      TTL: Number(record.ttl) || 300,
      ResourceRecords: values.map((Value) => ({ Value })),
    },
  }
}
async function route53Zone(client: Route53Client, name: string) {
  for (const candidate of zoneCandidates(name)) {
    const page = await client.send(
      new ListHostedZonesByNameCommand({ DNSName: candidate, MaxItems: 5 })
    )
    const zone = page.HostedZones?.find(
      (z) => !z.Config?.PrivateZone && canonical(z.Name ?? "") === candidate
    )
    if (zone?.Id) return zone.Id
  }
  throw new ConvexError(
    "This AWS account has no public Route 53 hosted zone for this domain. Create the zone, or add the records manually."
  )
}
async function writeRoute53(
  client: Route53Client,
  name: string,
  records: DesiredRecord[],
  progress: Progress
): Promise<DnsPlan> {
  const HostedZoneId = await route53Zone(client, name)
  const existing: ExistingRecord[] = []
  for (const name of targets(records)) {
    const page = await client.send(
      new ListResourceRecordSetsCommand({
        HostedZoneId,
        StartRecordName: name,
        MaxItems: 20,
      })
    )
    for (const set of page.ResourceRecordSets ?? []) {
      if (canonical(set.Name ?? "") !== name || !set.Type) continue
      if (set.AliasTarget?.DNSName)
        existing.push({
          name,
          type: set.Type,
          value: canonical(set.AliasTarget.DNSName),
        })
      for (const record of set.ResourceRecords ?? [])
        existing.push(resourceRecord(set.Type, name, record.Value ?? ""))
    }
  }
  const plan = planDnsWrites(records, existing)
  if (plan.writes.length) {
    await client.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId,
        ChangeBatch: { Changes: plan.writes.map(route53Change) },
      })
    )
    progress.created = plan.writes.length
  }
  return plan
}

export const configure = action({
  args: { id: v.id("domains"), cloudflareToken: v.optional(v.string()) },
  returns: v.object({
    created: v.number(),
    skipped: v.number(),
    conflicts: v.array(
      v.object({ name: v.string(), type: v.string(), reason: v.string() })
    ),
  }),
  // Annotated: the handler reads `internal`, which is derived from this module.
  handler: async (
    ctx,
    args
  ): Promise<{
    created: number
    skipped: number
    conflicts: DnsConflict[]
  }> => {
    const {
      domain,
      installation,
      provider,
    }: {
      domain: Doc<"domains">
      installation: Doc<"installation">
      provider: "cloudflare" | "route53"
    } = await ctx.runMutation(internal.ses.dnsAutoConfigState.claim, {
      id: args.id,
    })
    const progress: Progress = { created: 0 }
    try {
      const plan =
        provider === "cloudflare"
          ? await writeCloudflare(
              requireCloudflareToken(args.cloudflareToken),
              domain.name,
              domain.records,
              progress
            )
          : await writeRoute53(
              // Route 53 is global; requests are always signed for us-east-1.
              new Route53Client(connectionConfig(installation, "us-east-1")),
              domain.name,
              domain.records,
              progress
            )
      return {
        created: progress.created,
        skipped: plan.skipped,
        conflicts: plan.conflicts,
      }
    } catch (e) {
      if (e instanceof ConvexError) throw e
      if (
        provider === "route53" &&
        e instanceof Error &&
        /AccessDenied|Unauthorized|AuthorizationError/.test(e.name)
      )
        throw new ConvexError(
          "These AWS credentials can't manage Route 53. Automatic setup also needs route53:ListHostedZonesByName, route53:ListResourceRecordSets and route53:ChangeResourceRecordSets."
        )
      throw new ConvexError(
        provider === "route53"
          ? awsError(e)
          : "Cloudflare could not be reached. Try again, or add the records manually."
      )
    } finally {
      // Releases the claim, and records partial Cloudflare writes. Bookkeeping
      // must never replace the real result or the real error.
      await ctx
        .runMutation(internal.ses.dnsAutoConfigState.finish, {
          id: args.id,
          provider,
          created: progress.created,
        })
        .catch((e) => console.error("DNS auto configure bookkeeping failed", e))
    }
  },
})
