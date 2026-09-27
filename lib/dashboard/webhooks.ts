import { isPublicHostname } from "../net/public-host"
import { isHttpsUrl, pluralize } from "./format"
import {
  WEBHOOK_EVENTS,
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

/** Endpoints are posted to from the server, so they must be public HTTPS
    hosts; the addresses they resolve to are checked again on every send. */
export function webhookEndpointError(value: string): string | null {
  const endpoint = value.trim()
  if (!isHttpsUrl(endpoint)) return "Enter an https:// endpoint URL"
  if (endpoint.length > 2048) return "Use an endpoint URL under 2048 characters"
  const url = new URL(endpoint)
  if (url.username || url.password) return "Remove the credentials from the URL"
  if (!isPublicHostname(url.hostname))
    return "Use a public hostname, not an IP address or local name"
  return null
}

export function webhookFormError(
  endpoint: string,
  events: readonly WebhookEvent[]
): { endpoint?: string; events?: string } | null {
  const problem = webhookEndpointError(endpoint)
  if (problem) return { endpoint: problem }
  if (events.length === 0) return { events: "Select at least one event" }
  if (events.some((event) => !WEBHOOK_EVENTS.includes(event)))
    return { events: "Select events from the list" }
  return null
}

/** Endpoints answer 2xx to take an event. Anything else is retried. */
export function isDeliveryFailed(
  delivery: Pick<WebhookDelivery, "status">
): boolean {
  return delivery.status < 200 || delivery.status >= 300
}
