import { format } from "date-fns"

import { REGIONS, type DomainStatus, type Region } from "./types"

export function formatDate(timestamp: number): string {
  return format(timestamp, "MMM d, yyyy")
}

export function formatDateTime(timestamp: number): string {
  return format(timestamp, "MMM d, yyyy · HH:mm")
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

export function permissionLabel(
  permission: "full_access" | "sending_access"
): string {
  return permission === "full_access" ? "Full access" : "Sending access"
}

export function roleLabel(role: "admin" | "developer" | "viewer"): string {
  switch (role) {
    case "admin":
      return "Admin"
    case "developer":
      return "Developer"
    case "viewer":
      return "Viewer"
  }
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
