import { format } from "date-fns"

import { REGIONS } from "./types"
import type {
  ApiKeyPermission,
  AutomationStatus,
  BroadcastStatus,
  DnsRecord,
  Domain,
  DomainStatus,
  EmailStatus,
  ExportStatus,
  MemberRole,
  Region,
  SuppressionReason,
  TemplateStatus,
} from "./types"

export function formatDate(timestamp: number): string {
  return format(timestamp, "MMM d, yyyy")
}

export function formatDateTime(timestamp: number): string {
  return format(timestamp, "MMM d, yyyy · HH:mm")
}

/** Compact age, e.g. "18d ago". Falls back to the date past a year. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 365 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`
  return formatDate(timestamp)
}

export function dnsHost(name: string, domain: string): string {
  if (name === domain || name === "@") return "@"
  const suffix = `.${domain}`
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
}

export function domainDnsRecords(domain: Domain): DnsRecord[] {
  const records = [...domain.records]
  if (
    domain.clickTracking &&
    !records.some((record) => record.kind === "Tracking")
  ) {
    records.push({
      id: `${domain.id}_tracking`,
      kind: "Tracking",
      type: "CNAME",
      name: `links.${domain.name}`,
      value: "links.opensend.cc",
      ttl: "Auto",
      status: domain.status,
    })
  }
  if (
    domain.receiving &&
    !records.some((record) => record.kind === "Receiving")
  ) {
    records.push({
      id: `${domain.id}_receiving`,
      kind: "Receiving",
      type: "MX",
      name: `inbound.${domain.name}`,
      value: `inbound-smtp.${domain.region}.amazonaws.com`,
      ttl: "Auto",
      priority: 10,
      status: domain.status,
    })
  }
  return records
}

export function regionLabel(region: Region): string {
  return REGIONS.find((item) => item.value === region)?.label ?? region
}

export function statusLabel(status: DomainStatus): string {
  switch (status) {
    case "not_started":
      return "Not started"
    case "pending":
      return "Pending"
    case "verified":
      return "Verified"
    case "failed":
      return "Failed"
    case "temporary_failure":
      return "Temporary failure"
  }
}

export function emailStatusLabel(status: EmailStatus): string {
  switch (status) {
    case "queued":
      return "Queued"
    case "scheduled":
      return "Scheduled"
    case "sent":
      return "Sent"
    case "delivered":
      return "Delivered"
    case "delivery_delayed":
      return "Delayed"
    case "opened":
      return "Opened"
    case "clicked":
      return "Clicked"
    case "bounced":
      return "Bounced"
    case "complained":
      return "Complained"
    case "failed":
      return "Failed"
    case "canceled":
      return "Canceled"
    case "suppressed":
      return "Suppressed"
  }
}

export function defaultFromAddress(domainName: string | undefined): string {
  return domainName
    ? `Opensend <hello@${domainName}>`
    : "Opensend <hello@opensend.cc>"
}

export function broadcastStatusLabel(status: BroadcastStatus): string {
  switch (status) {
    case "draft":
      return "Draft"
    case "scheduled":
      return "Scheduled"
    case "queued":
      return "Sending"
    case "sent":
      return "Sent"
    case "failed":
      return "Failed"
    case "canceled":
      return "Canceled"
  }
}

export function templateStatusLabel(status: TemplateStatus): string {
  return status === "published" ? "Published" : "Draft"
}

export function automationStatusLabel(status: AutomationStatus): string {
  return status === "enabled" ? "Enabled" : "Disabled"
}

export function suppressionReasonLabel(reason: SuppressionReason): string {
  switch (reason) {
    case "bounced":
      return "Hard bounce"
    case "complained":
      return "Complaint"
    case "manual":
      return "Manual"
  }
}

export function exportStatusLabel(status: ExportStatus): string {
  switch (status) {
    case "processing":
      return "Processing"
    case "ready":
      return "Ready"
    case "expired":
      return "Expired"
  }
}

export function permissionLabel(permission: ApiKeyPermission): string {
  return permission === "full_access" ? "Full access" : "Sending access"
}

export function roleLabel(role: MemberRole): string {
  return role === "admin" ? "Admin" : "Member"
}

export function maskToken(prefix: string, last4: string): string {
  return `${prefix}••••${last4}`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase()
}

export function isDomainName(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(
    value.trim()
  )
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function isUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

export function pluralize(
  count: number,
  noun: string,
  plural = `${noun}s`
): string {
  return `${count} ${count === 1 ? noun : plural}`
}

/* Badge tone per status. Kept beside the labels so adding a status touches one
   module; `primitives.tsx` only renders the tone. */
export type BadgeTone =
  "success" | "destructive" | "warning" | "secondary" | "outline"

export const DOMAIN_STATUS_TONE: Record<DomainStatus, BadgeTone> = {
  not_started: "secondary",
  pending: "warning",
  verified: "success",
  failed: "destructive",
  temporary_failure: "warning",
}

export const EMAIL_STATUS_TONE: Record<EmailStatus, BadgeTone> = {
  queued: "warning",
  scheduled: "warning",
  sent: "outline",
  delivered: "success",
  delivery_delayed: "warning",
  opened: "success",
  clicked: "success",
  bounced: "destructive",
  complained: "destructive",
  failed: "destructive",
  canceled: "secondary",
  suppressed: "secondary",
}

export const BROADCAST_STATUS_TONE: Record<BroadcastStatus, BadgeTone> = {
  draft: "outline",
  scheduled: "warning",
  queued: "warning",
  sent: "success",
  failed: "destructive",
  canceled: "secondary",
}

export const TEMPLATE_STATUS_TONE: Record<TemplateStatus, BadgeTone> = {
  draft: "secondary",
  published: "success",
}

export const AUTOMATION_STATUS_TONE: Record<AutomationStatus, BadgeTone> = {
  enabled: "success",
  disabled: "secondary",
}

export const EXPORT_STATUS_TONE: Record<ExportStatus, BadgeTone> = {
  processing: "warning",
  ready: "success",
  expired: "secondary",
}

/** `part` of `total` as a percentage number, rounded to `digits` places. */
export function rate(part: number, total: number, digits = 0): number {
  if (total <= 0) return 0
  const scale = 10 ** digits
  return Math.round((part / total) * 100 * scale) / scale
}

export function percent(part: number, total: number, digits = 0): string {
  return `${rate(part, total, digits)}%`
}
