import type { EmailStatus } from "./types"

export type EmailCounter =
  "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained"

export type EmailCounts = Record<EmailCounter, number> & {
  /** Emails whose current status is exactly this one, as the Emails filter counts them. */
  status: Partial<Record<EmailStatus, number>>
}

export type MetricsDay = EmailCounts & {
  label: string
  /** The series picked by the event filter. */
  events: number
  bounceRate: number
  complainRate: number
}

/* Above these rates mailbox providers start throttling a sender. */
export const BOUNCE_RISK = 4
export const COMPLAIN_RISK = 0.08

export function emptyEmailCounts(): EmailCounts {
  return {
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    status: {},
  }
}

export function senderDomain(from: string): string {
  return from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? "unknown"
}

/** How many emails reached `status` (`null` = sent). Lifecycle events count
    every email that got there, even after it moved on (a delivered email was
    also sent); end states count emails still in them. */
export function eventCount(
  counts: EmailCounts,
  status: EmailStatus | null
): number {
  if (status === null) return counts.sent
  if (isEmailCounter(status)) return counts[status]
  return counts.status[status] ?? 0
}
const EMAIL_COUNTERS: readonly string[] = [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
] satisfies EmailCounter[]
const isEmailCounter = (status: string): status is EmailCounter =>
  EMAIL_COUNTERS.includes(status)
