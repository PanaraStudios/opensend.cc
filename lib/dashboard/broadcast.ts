import { normalizeEmailDocument, type EmailDocument } from "./email-document"
import { defaultFromAddress } from "./format"
import type {
  Broadcast,
  BroadcastStats,
  BroadcastStatus,
  Contact,
  DashboardState,
  Domain,
  Segment,
} from "./types"

export const BROADCAST_STATUS_ORDER: BroadcastStatus[] = [
  "draft",
  "scheduled",
  "queued",
  "sent",
  "failed",
  "canceled",
]

export type BroadcastEventTab =
  "unsubscribed" | "bounced" | "suppressed" | "complained"

export function emptyBroadcastStats(): BroadcastStats {
  return {
    recipients: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    suppressed: 0,
    unsubscribed: 0,
    complained: 0,
  }
}

export function normalizeBroadcastStats(
  stats: Partial<BroadcastStats> | null | undefined
): BroadcastStats {
  return { ...emptyBroadcastStats(), ...stats }
}

/** Drafts (and canceled sends, which behave like drafts) open the block
    editor. Everything else opens the report. */
export function isBroadcastDraftLike(status: BroadcastStatus): boolean {
  return status === "draft" || status === "canceled"
}

export function broadcastEditorHref(item: Pick<Broadcast, "id" | "status">) {
  return isBroadcastDraftLike(item.status)
    ? `/broadcasts/${item.id}/edit`
    : `/broadcasts/${item.id}`
}

/** The block tree behind a broadcast. Records saved before the editor only
    have `html`, so they open as a single hand-written HTML block. */
export function broadcastDocument(item: Broadcast): EmailDocument {
  return normalizeEmailDocument(item.content, item.html)
}

/** Which header actions a broadcast offers in its current status. A canceled
    send behaves like a draft so it can be rescheduled or sent. */
export function broadcastActions(status: BroadcastStatus) {
  const draftLike = status === "draft" || status === "canceled"
  return {
    canSchedule: draftLike,
    canSend: draftLike || status === "scheduled",
    canCancel: status === "scheduled" || status === "queued",
  }
}

/** Only the transitions the UI offers are legal; a schedule needs a time. */
export function canTransitionBroadcast(
  from: BroadcastStatus,
  to: BroadcastStatus,
  scheduledAt: number | null = null
): boolean {
  const actions = broadcastActions(from)
  if (to === "sent") return actions.canSend
  if (to === "scheduled") return actions.canSchedule && scheduledAt !== null
  if (to === "canceled") return actions.canCancel
  return false
}

export type BroadcastTransition = {
  now: number
  /** Recipient count when the transition is to `sent`. */
  recipients?: number
  /** Send time when the transition is to `scheduled`. */
  scheduledAt?: number | null
}

/** Pure status change. Illegal transitions return the record untouched. */
export function transitionBroadcast(
  item: Broadcast,
  status: BroadcastStatus,
  { now, recipients = 0, scheduledAt = null }: BroadcastTransition
): Broadcast {
  if (!canTransitionBroadcast(item.status, status, scheduledAt)) return item
  if (status === "sent") {
    return {
      ...item,
      status,
      scheduledAt: null,
      sentAt: now,
      updatedAt: now,
      stats: { ...emptyBroadcastStats(), recipients, delivered: recipients },
    }
  }
  return {
    ...item,
    status,
    updatedAt: now,
    scheduledAt: status === "scheduled" ? scheduledAt : null,
  }
}

export function audienceLabel(
  segmentId: string | null,
  segments: Segment[]
): string {
  if (!segmentId) return "All contacts"
  return (
    segments.find((segment) => segment.id === segmentId)?.name ?? "All contacts"
  )
}

/** Every address a broadcast can send from: one per verified domain, or the
    shared Opensend one while there is none. */
export function fromAddresses(
  domains: readonly Pick<Domain, "name" | "status">[]
): string[] {
  const verified = domains.filter((domain) => domain.status === "verified")
  if (verified.length === 0) return [defaultFromAddress(undefined)]
  return verified.map((domain) => defaultFromAddress(domain.name))
}

/** The broadcast's own sender while its domain is still verified, else the
    workspace default. */
export function broadcastFrom(
  item: Pick<Broadcast, "from">,
  domains: readonly Pick<Domain, "name" | "status">[]
): string {
  const options = fromAddresses(domains)
  return item.from && options.includes(item.from) ? item.from : options[0]!
}

/** Who a send reaches: the segment (or everyone), minus the unsubscribed. */
export function broadcastRecipients(
  contacts: Contact[],
  item: Pick<Broadcast, "segmentId">
): Contact[] {
  return contacts.filter(
    (contact) =>
      !contact.unsubscribed &&
      (item.segmentId === null || contact.segmentIds.includes(item.segmentId))
  )
}

/** Backfill for records persisted before `updatedAt` existed. */
export function broadcastUpdatedAt(item: Broadcast): number {
  return item.updatedAt || item.sentAt || item.createdAt
}

export function broadcastAsTemplateInput(item: Broadcast) {
  return {
    name: item.name || "Untitled",
    subject: item.subject || item.name || "Untitled",
    html: item.html,
  }
}

export function broadcastEventRows(
  state: DashboardState,
  item: Broadcast,
  tab: BroadcastEventTab
): { email: string }[] {
  if (tab === "unsubscribed") {
    const recipients = new Set(
      state.emails
        .filter((email) => email.broadcastId === item.id)
        .map((email) => email.to)
    )
    return state.contacts
      .filter(
        (contact) => contact.unsubscribed && recipients.has(contact.email)
      )
      .map((contact) => ({ email: contact.email }))
  }

  return state.emails
    .filter((email) => email.broadcastId === item.id && email.status === tab)
    .map((email) => ({ email: email.to }))
}
