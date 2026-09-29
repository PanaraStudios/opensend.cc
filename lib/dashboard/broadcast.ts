import { defaultFromAddress } from "./format"
import type { TemplateInput } from "./template"
import type {
  Broadcast,
  BroadcastStats,
  BroadcastStatus,
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

export type EmailEditorMode = "visual" | "html"

/** An email is hand-written when it has markup but no editor document
    behind it. Anything else, including a blank one, opens in the editor. */
export function emailEditorMode(
  item: Pick<Broadcast, "content" | "html">
): EmailEditorMode {
  if (item.content?.type === "doc") return "visual"
  return item.html.trim() ? "html" : "visual"
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

/** The email's own sender while its domain is still verified, else the
    workspace default. */
export function emailFrom(
  item: Pick<Broadcast, "from">,
  domains: readonly Pick<Domain, "name" | "status">[]
): string {
  const options = fromAddresses(domains)
  return item.from && options.includes(item.from) ? item.from : options[0]!
}

/** A broadcast's email as a new template, editor document and all. */
export function broadcastAsTemplateInput(item: Broadcast): TemplateInput {
  return {
    name: item.name,
    subject: item.subject,
    preview: item.preview,
    html: item.html,
    content: item.content,
    from: item.from,
    replyTo: item.replyTo,
  }
}
