import { CHANNELS, CHANNEL_IDS } from "../channels"
import type { SkipReason } from "./types"
import { format } from "date-fns"

import { REGIONS } from "./types"
import type {
  ApiKeyPermission,
  AutomationRunStatus,
  AutomationStatus,
  BroadcastStatus,
  Channel,
  ChannelAccountStatus,
  ChannelMessageStatus,
  ChannelQuality,
  DomainStatus,
  EmailStatus,
  ExportStatus,
  MemberRole,
  MessagingChannel,
  MetaTemplateStatus,
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
  /* A minute ahead is clock skew, not the future. */
  const ahead = Math.floor((timestamp - now) / 1000)
  if (ahead >= 60) {
    if (ahead < 3600) return `in ${Math.floor(ahead / 60)}m`
    if (ahead < 86_400) return `in ${Math.floor(ahead / 3600)}h`
    if (ahead < 365 * 86_400) return `in ${Math.floor(ahead / 86_400)}d`
    return formatDate(timestamp)
  }
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 365 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`
  return formatDate(timestamp)
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
    case "partially_verified":
      return "Partially verified"
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

const EMAIL_STATUS_VALUES: readonly EmailStatus[] = [
  "queued",
  "scheduled",
  "sent",
  "delivered",
  "delivery_delayed",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "failed",
  "canceled",
  "suppressed",
]

/** A message timeline event, in words. Email statuses keep their own labels;
    channel events such as `read_receipt_sent` do not stay snake_case. */
export function timelineEventLabel(type?: string): string {
  if (!type) return "Event"
  if (EMAIL_STATUS_VALUES.includes(type as EmailStatus))
    return emailStatusLabel(type as EmailStatus)
  switch (type) {
    case "read":
      return "Read"
    case "played":
      return "Played"
    case "received":
      return "Received"
    case "payment_updated":
      return "Payment updated"
    case "read_receipt_sent":
      return "Read receipt sent"
    case "read_receipt_failed":
      return "Read receipt failed"
    case "typing_failed":
      return "Typing failed"
    default:
      return sentenceCase(type.replaceAll("_", " "))
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

export function tenantStatusLabel(status?: string): string {
  return snakeSentence(status || "UNKNOWN")
}

/** Meta and SES status words share the same readable spelling. */
function snakeSentence(value: string): string {
  return sentenceCase(value.toLowerCase().replaceAll("_", " "))
}
const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  no_phone: "No phone number",
  no_channel_identity: "No channel identity",
  no_email: "No email address",
  unsubscribed: "Unsubscribed",
  topic_opt_out: "Topic opt-out",
  marketing_opt_out: "Marketing opt-out",
  missing_variables: "Missing variables",
  contact_deleted: "Contact deleted",
  window_closed: "Messaging window closed",
}
export const SKIP_REASON_TONE: Record<SkipReason, BadgeTone> = {
  no_phone: "secondary",
  no_channel_identity: "secondary",
  no_email: "secondary",
  unsubscribed: "secondary",
  topic_opt_out: "secondary",
  marketing_opt_out: "secondary",
  missing_variables: "warning",
  contact_deleted: "secondary",
  window_closed: "warning",
}
export function skipReasonLabel(reason: SkipReason): string {
  return SKIP_REASON_LABELS[reason]
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
      return "Completed"
    case "failed":
      return "Failed"
    case "expired":
      return "Expired"
  }
}

export function permissionLabel(permission: ApiKeyPermission): string {
  return permission === "full_access"
    ? "Full access"
    : permission === "custom"
      ? "Custom"
      : "Sending access"
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

const WEB_PROTOCOLS = ["https:", "http:"]

export function isUrl(
  value: string,
  protocols: readonly string[] = WEB_PROTOCOLS
): boolean {
  try {
    return protocols.includes(new URL(value.trim()).protocol)
  } catch {
    return false
  }
}

export function isHttpsUrl(value: string): boolean {
  return isUrl(value, ["https:"])
}

/** A destination typed into a link field, made safe to store and send. Merge
    tags, in-page anchors, mail and phone links pass as they are; a bare
    domain gets `https://`; anything else that is not a web address (a
    `javascript:` URL, say) is refused with null. Empty stays empty. */
export function normalizeHref(value: string): string | null {
  const href = value.trim()
  if (!href) return ""
  if (href.startsWith("{{{") || href.startsWith("#")) return href
  if (/^(mailto|tel):\S+$/i.test(href)) return href
  if (isUrl(href)) return href
  /* No scheme at all: read it as a domain. */
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && isUrl(`https://${href}`)) {
    return `https://${href}`
  }
  return null
}

export function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A stored code with underscores, keeping the rest of each word. */
export function codeLabel(value: string): string {
  return sentenceCase(value.replaceAll("_", " "))
}

export const FIELD_TYPE_LABELS = {
  string: "String",
  number: "Number",
  boolean: "Boolean",
  date: "Date",
  enum: "Choice",
  object: "Object",
  array: "List",
} as const

/** Readable field type. Unknown codes still get a sentence, never the raw token. */
export function fieldTypeLabel(type: string): string {
  return (
    FIELD_TYPE_LABELS[type as keyof typeof FIELD_TYPE_LABELS] ?? codeLabel(type)
  )
}

/** How an address is kept and compared. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
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
  partially_verified: "warning",
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

export const CHANNEL_ACCOUNT_STATUS_TONE: Record<
  ChannelAccountStatus,
  BadgeTone
> = {
  pending: "warning",
  active: "success",
  restricted: "warning",
  error: "destructive",
  disconnected: "secondary",
}

/** A WhatsApp (Messenger, Instagram) message's delivery, toned like email's. */
export const CHANNEL_MESSAGE_STATUS_TONE: Record<
  ChannelMessageStatus,
  BadgeTone
> = {
  queued: "warning",
  sent: "outline",
  delivered: "success",
  read: "success",
  played: "success",
  failed: "destructive",
  received: "secondary",
}

/** WhatsApp's phone number quality rating. */
export const CHANNEL_QUALITY_TONE: Record<ChannelQuality, BadgeTone> = {
  green: "success",
  yellow: "warning",
  red: "destructive",
  unknown: "secondary",
}

export const CHANNEL_LABELS = Object.fromEntries(
  CHANNEL_IDS.filter(
    (channel): channel is MessagingChannel => channel !== "email"
  ).map((channel) => [channel, CHANNELS[channel].label])
) as Record<MessagingChannel, string>

/** Email, or a messaging channel's name. */
export function channelLabel(channel: Channel): string {
  return CHANNELS[channel].label
}

/** Meta's messaging limit tier, `TIER_1K`, as people read it. */
export function messagingLimitLabel(tier: string | undefined): string {
  if (!tier) return "Unknown"
  const limit = tier.replace(/^TIER_/, "")
  return limit === "UNLIMITED" ? "Unlimited" : `${limit} per 24 hours`
}

export const TEMPLATE_STATUS_TONE: Record<TemplateStatus, BadgeTone> = {
  draft: "secondary",
  published: "success",
}

/** Meta's review of a WhatsApp template. */
export const META_TEMPLATE_STATUS_TONE: Record<MetaTemplateStatus, BadgeTone> =
  {
    PENDING: "warning",
    APPROVED: "success",
    REJECTED: "destructive",
    PAUSED: "warning",
    DISABLED: "destructive",
    IN_APPEAL: "warning",
    LIMIT_EXCEEDED: "destructive",
    ARCHIVED: "secondary",
    PENDING_DELETION: "secondary",
    DELETED: "secondary",
  }

/** `IN_APPEAL` as "In appeal". */
export function metaTemplateStatusLabel(status: MetaTemplateStatus): string {
  return snakeSentence(status)
}

export const AUTOMATION_STATUS_TONE: Record<AutomationStatus, BadgeTone> = {
  enabled: "success",
  disabled: "secondary",
}

export const TENANT_STATUS_TONE: Record<string, BadgeTone> = {
  ENABLED: "success",
  REINSTATED: "success",
  DISABLED: "warning",
  UNKNOWN: "warning",
}

export const AUTOMATION_RUN_STATUS_TONE: Record<
  AutomationRunStatus | "skipped",
  BadgeTone
> = {
  running: "warning",
  completed: "success",
  failed: "destructive",
  cancelled: "secondary",
  skipped: "outline",
}

export const EXPORT_STATUS_TONE: Record<ExportStatus, BadgeTone> = {
  processing: "warning",
  ready: "success",
  failed: "destructive",
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

/** 2xx reads as fine, 3xx as a nudge, anything else as a failure. */
export function httpStatusTone(status: number): BadgeTone {
  if (status >= 200 && status < 300) return "success"
  if (status >= 300 && status < 400) return "warning"
  return "destructive"
}

/** 0 means the request never got an HTTP response (DNS, refused, timeout). */
export function httpStatusLabel(status: number): string {
  return status === 0 ? "No response" : String(status)
}

export const formatNumber = (value: number) => value.toLocaleString("en-US")
