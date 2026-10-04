import { SYSTEM_EVENT_CATALOG, type EventField } from "../event-catalog"
import { isPublicHostname } from "../net/public-host"
import { SYSTEM_EVENT_CATALOG } from "../event-catalog"
import { isHttpsUrl, pluralize } from "./format"
import {
  WEBHOOK_EVENTS,
  type WebhookDelivery,
  type WebhookEvent,
} from "./types"

/** Catalog groups retain provider-specific events without a second event list. */
export const WEBHOOK_EVENT_GROUPS = [
  ...new Set(
    SYSTEM_EVENT_CATALOG.map((event) =>
      event.group === "Suppressions" ? "Email" : event.group
    )
  ),
].map((label) => ({
  id: label.toLowerCase().replaceAll(" ", "-"),
  label,
  events: SYSTEM_EVENT_CATALOG.filter(
    (event) =>
      (event.group === "Suppressions" ? "Email" : event.group) === label
  ).map((event) => event.name as WebhookEvent),
}))

export function webhookEventLabel(name: WebhookEvent): string {
  return (
    SYSTEM_EVENT_CATALOG.find((event) => event.name === name)?.label ?? name
  )
}

/** Generate a complete example including nested message/contact schemas. */
export function eventFieldExample(schema: EventField): unknown {
  if (schema.fields)
    return Object.fromEntries(
      Object.entries(schema.fields).map(([key, value]) => [
        key,
        eventFieldExample(value),
      ])
    )
  if (schema.items) return [eventFieldExample(schema.items)]
  return schema.example
}
export function webhookEventSample(name: WebhookEvent) {
  const event = SYSTEM_EVENT_CATALOG.find((event) => event.name === name)!
  return {
    type: name,
    created_at: "2026-10-04T12:00:00.000Z",
    data: eventFieldExample(event.schema),
  }
}

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

/** Labels share the same catalogue as automation triggers; stored event names stay intact. */
export function webhookEventLabel(event: string): string {
  return (
    SYSTEM_EVENT_CATALOG.find((item) => item.name === event)?.label ??
    event.replace(/[_.]/g, " ").replace(/^./, (char) => char.toUpperCase())
  )
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

/** As Svix (and so Resend) shows a message: failed only once no retry is
    left; until then a failed attempt is still pending. */
export function deliveryResult(
  delivery: Pick<WebhookDelivery, "status" | "nextAttemptAt">
): "Succeeded" | "Pending" | "Failed" {
  if (!isDeliveryFailed(delivery)) return "Succeeded"
  return delivery.nextAttemptAt === undefined ? "Failed" : "Pending"
}
