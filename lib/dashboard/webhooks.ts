import { isHttpsUrl, pluralize } from "./format"
import {
  WEBHOOK_EVENTS,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from "./types"

const GROUP_LABELS = { email: "Email", contact: "Contact", domain: "Domain" }

type WebhookEventGroupId = keyof typeof GROUP_LABELS

/** The event types by the resource they are about, in catalogue order. */
export const WEBHOOK_EVENT_GROUPS = (
  Object.keys(GROUP_LABELS) as WebhookEventGroupId[]
).map((id) => ({
  id,
  label: GROUP_LABELS[id],
  events: WEBHOOK_EVENTS.filter((event) => event.startsWith(`${id}.`)),
}))

/** Catalogue order, whatever order they were ticked in. */
export function sortWebhookEvents(
  events: readonly WebhookEvent[]
): WebhookEvent[] {
  return WEBHOOK_EVENTS.filter((event) => events.includes(event))
}

export function webhookEventsLabel(events: readonly WebhookEvent[]): string {
  if (WEBHOOK_EVENTS.every((event) => events.includes(event))) {
    return "All events"
  }
  return pluralize(events.length, "event")
}

export function webhookFormError(
  endpoint: string,
  events: readonly WebhookEvent[]
): { endpoint?: string; events?: string } | null {
  if (!isHttpsUrl(endpoint)) {
    return { endpoint: "Enter an https:// endpoint URL" }
  }
  if (events.length === 0) return { events: "Select at least one event" }
  return null
}

/** Endpoints answer 2xx to take an event. Anything else is retried. */
export function isDeliveryFailed(
  delivery: Pick<WebhookDelivery, "status">
): boolean {
  return delivery.status < 200 || delivery.status >= 300
}

/** Newest first. */
export function webhookDeliveries(
  deliveries: readonly WebhookDelivery[],
  webhookId: string
): WebhookDelivery[] {
  return deliveries
    .filter((delivery) => delivery.webhookId === webhookId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Sending it again: a new attempt at the same payload, which this demo
    workspace always lands. */
export function replayedDelivery(
  delivery: WebhookDelivery,
  id: string,
  now: number
): WebhookDelivery {
  return {
    ...delivery,
    id,
    status: 200,
    attempts: delivery.attempts + 1,
    durationMs: 184,
    createdAt: now,
    response: "OK",
  }
}

/** Backfill for records persisted when only the secret's tail was kept. The
    original is gone, so a stand-in ending in the same four characters is
    derived from the id: stable across parses, and rotatable like any other. */
export function normalizeWebhook(
  item: Webhook & { signingSecretLast4?: string }
): Webhook {
  if (item.signingSecret) return item
  const { signingSecretLast4 = "", ...rest } = item
  const body = item.id.replace(/[^a-z0-9]/gi, "").padEnd(32, "0")
  return { ...rest, signingSecret: `whsec_${body}${signingSecretLast4}` }
}
