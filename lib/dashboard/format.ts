import { format } from "date-fns"

import { REGIONS } from "./types"
import type {
  ApiKeyPermission,
  AutomationStatus,
  BroadcastStatus,
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

export function formatTime(timestamp: number): string {
  return format(timestamp, "HH:mm:ss")
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

export function percent(part: number, total: number): string {
  if (total <= 0) return "0%"
  return `${Math.round((part / total) * 100)}%`
}
