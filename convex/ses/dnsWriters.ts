import { ConvexError } from "convex/values"

/** Structural shape of a stored `domains.records` entry, widened so provider
 * writers stay independent of the record kinds SES currently emits. */
export type DesiredRecord = {
  id: string
  kind: string
  type: "CNAME" | "MX" | "TXT"
  name: string
  value: string
  ttl: string
  priority?: number
  status: string
}
/** One value already published at a name. MX values exclude the priority and
 * TXT values are unquoted, so both providers compare the same way. */
export type ExistingRecord = {
  name: string
  type: string
  value: string
  priority?: number
}
export type PlannedWrite = {
  record: DesiredRecord
  /** Values already in this name/type set that the write must preserve. */
  preserve: string[]
}
export type DnsConflict = { name: string; type: string; reason: string }
export type DnsPlan = {
  writes: PlannedWrite[]
  skipped: number
  conflicts: DnsConflict[]
}

export const canonical = (value: string) =>
  value.trim().toLowerCase().replace(/\.$/, "")
const isSpf = (value: string) => /^v=spf1(\s|$)/i.test(value)
const isDmarc = (value: string) => /^v=dmarc1(\s|;|$)/i.test(value)

/** Decide create/skip/conflict without touching any provider. Existing records
 * are never edited or replaced: anything already published that disagrees with
 * the desired record is reported instead of overwritten. */
export function planDnsWrites(
  desired: DesiredRecord[],
  existing: ExistingRecord[]
): DnsPlan {
  const plan: DnsPlan = { writes: [], skipped: 0, conflicts: [] }
  for (const record of desired) {
    if (record.status === "verified") {
      plan.skipped++
      continue
    }
    const here = existing.filter(
      (e) => canonical(e.name) === canonical(record.name)
    )
    const at = here.filter((e) => e.type === record.type)
    const conflict = (reason: string) => {
      plan.conflicts.push({ name: record.name, type: record.type, reason })
      return true
    }
    /* A CNAME owns its name: DNS lets no other type answer beside it, in either
       direction. Route 53 rejects the whole batch for this and Cloudflare fails
       part-way through, so the planner has to catch it before any write. */
    const exclusive = () =>
      here.some((e) =>
        record.type === "CNAME" ? e.type !== "CNAME" : e.type === "CNAME"
      ) &&
      conflict(
        record.type === "CNAME"
          ? `Other records already answer this name (${[...new Set(here.map((e) => e.type))].sort().join(", ")}). A CNAME cannot coexist with them. Remove them before running automatic setup.`
          : "A CNAME already answers this name, and no other record can coexist with it. Remove it before running automatic setup."
      )
    if (record.type === "CNAME") {
      if (at.some((e) => canonical(e.value) === canonical(record.value)))
        plan.skipped++
      else if (exclusive()) continue
      else if (at.length)
        conflict(
          "A different record already answers this name. Remove it before running automatic setup."
        )
      else plan.writes.push({ record, preserve: [] })
      continue
    }
    if (record.type === "MX") {
      if (
        at.some(
          (e) =>
            canonical(e.value) === canonical(record.value) &&
            e.priority === record.priority
        )
      )
        plan.skipped++
      else if (exclusive()) continue
      else if (at.length)
        conflict(
          record.kind === "Receiving"
            ? "Existing MX records handle mail for this domain. Replace them manually to receive with Opensend."
            : "Different MX records already exist at this name. Remove them before running automatic setup."
        )
      else plan.writes.push({ record, preserve: [] })
      continue
    }
    // TXT sets hold unrelated values (verification tokens, other policies).
    // Every write carries them forward so nothing published here is lost.
    const values = at.map((e) => e.value)
    if (record.kind === "DMARC") {
      if (values.some(isDmarc)) plan.skipped++
      else if (!exclusive()) plan.writes.push({ record, preserve: values })
      continue
    }
    const policies = values.filter(isSpf)
    if (
      policies.some((value) =>
        value.split(/\s+/).includes("include:amazonses.com")
      )
    )
      plan.skipped++
    else if (exclusive()) continue
    else if (policies.length)
      conflict(
        "An SPF record already exists at this name. Add include:amazonses.com to it manually."
      )
    else plan.writes.push({ record, preserve: values })
  }
  return plan
}

/** Unquote a presentation-format TXT value into the string it publishes. */
export function parseTxtValue(raw: string) {
  const parts = raw.match(/"(?:[^"\\]|\\.)*"/g)
  return parts
    ? parts.map((p) => p.slice(1, -1).replace(/\\(.)/g, "$1")).join("")
    : raw
}
/** Quote a TXT value, split into the 255-character chunks DNS allows. */
export function quoteTxtValue(value: string) {
  const chunks = value.match(/[\s\S]{1,255}/g) ?? [""]
  return chunks.map((chunk) => `"${chunk.replace(/["\\]/g, "\\$&")}"`).join(" ")
}

/** Parent zones to try, longest first. Bounded, and never a bare TLD. */
export function zoneCandidates(name: string) {
  const labels = canonical(name).split(".")
  const candidates: string[] = []
  for (let offset = 0; offset <= Math.min(labels.length - 2, 5); offset++)
    candidates.push(labels.slice(offset).join("."))
  return candidates
}

/** Never store, log, or echo this value. */
export function requireCloudflareToken(value: string | undefined) {
  const token = (value ?? "").trim()
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token))
    throw new ConvexError(
      "Paste a Cloudflare API token with Zone → DNS → Edit permission for this zone."
    )
  return token
}
