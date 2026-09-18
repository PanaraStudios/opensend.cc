import { eachDayOfInterval, format, startOfDay } from "date-fns"
import type { DateRange } from "react-day-picker"

import { inDateRange } from "./email-range"
import { rate } from "./format"
import type { EmailStatus, SentEmail } from "./types"

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

export type DomainCounts = { name: string; counts: EmailCounts }

/* Above these rates mailbox providers start throttling a sender. */
export const BOUNCE_RISK = 4
export const COMPLAIN_RISK = 0.08

/* A status implies every earlier step: a click was also an open and a delivery. */
const REACHED: Partial<Record<EmailStatus, EmailCounter[]>> = {
  delivered: ["delivered"],
  opened: ["delivered", "opened"],
  clicked: ["delivered", "opened", "clicked"],
  bounced: ["bounced"],
  complained: ["complained"],
}

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

/** `null` is every event. Delivered, opened, and clicked stay cumulative;
    other statuses count exact matches. */
export function eventCount(
  counts: EmailCounts,
  status: EmailStatus | null
): number {
  if (status === null) return counts.sent
  if (status === "delivered" || status === "opened" || status === "clicked") {
    return counts[status]
  }
  return counts.status[status] ?? 0
}

function tally(counts: EmailCounts, email: SentEmail) {
  if (email.status !== "scheduled") counts.sent += 1
  for (const counter of REACHED[email.status] ?? []) counts[counter] += 1
  counts.status[email.status] = (counts.status[email.status] ?? 0) + 1
}

/** One pass over emails: totals, a per-day series, and per-domain counts.
    `domain` and `status` are `null` when their filter is on "all". */
export function summarizeEmails(
  emails: SentEmail[],
  range: DateRange,
  domain: string | null,
  status: EmailStatus | null
) {
  const totals = emptyEmailCounts()
  const byDomain = new Map<string, EmailCounts>()
  const from = range.from ?? new Date()
  const byDay = new Map(
    eachDayOfInterval({ start: from, end: range.to ?? from }).map((day) => [
      startOfDay(day).getTime(),
      emptyEmailCounts(),
    ])
  )

  for (const email of emails) {
    if (!inDateRange(email.createdAt, range)) continue
    const emailDomain = senderDomain(email.from)
    if (domain !== null && emailDomain !== domain) continue
    tally(totals, email)
    const day = byDay.get(startOfDay(email.createdAt).getTime())
    if (day) tally(day, email)
    let domainCounts = byDomain.get(emailDomain)
    if (!domainCounts) {
      domainCounts = emptyEmailCounts()
      byDomain.set(emailDomain, domainCounts)
    }
    tally(domainCounts, email)
  }

  const days: MetricsDay[] = [...byDay].map(([day, counts]) => ({
    ...counts,
    label: format(day, "MMM d"),
    events: eventCount(counts, status),
    bounceRate: rate(counts.bounced, counts.sent, 2),
    complainRate: rate(counts.complained, counts.sent, 2),
  }))
  const domains: DomainCounts[] = [...byDomain]
    .map(([name, counts]) => ({ name, counts }))
    .sort((a, b) => b.counts.sent - a.counts.sent)
  return { totals, days, domains }
}
