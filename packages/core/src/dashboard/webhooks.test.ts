import assert from "node:assert/strict"
import { describe, it, test } from "node:test"

import { WEBHOOK_EVENTS, type WebhookDelivery } from "./types"
import {
  deliveryResult,
  eventFieldExample,
  webhookEventLabel,
  webhookEventSample,
  isDeliveryFailed,
  sortWebhookEvents,
  WEBHOOK_EVENT_GROUPS,
  webhookEndpointError,
  webhookEventsLabel,
  webhookFormError,
} from "./webhooks"

function delivery(patch: Partial<WebhookDelivery>): WebhookDelivery {
  return {
    id: "whd_1",
    webhookId: "wh_1",
    event: "email.sent",
    status: 200,
    attempts: 1,
    durationMs: 100,
    createdAt: 1,
    payload: { type: "email.sent" },
    response: "OK",
    ...patch,
  }
}

describe("WEBHOOK_EVENT_GROUPS", () => {
  it("includes every catalog event in the dashboard groups", () => {
    const grouped = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events)
    const visible = WEBHOOK_EVENTS
    assert.deepEqual([...grouped].sort(), [...visible].sort())
  })
})

describe("sortWebhookEvents", () => {
  it("returns catalogue order", () => {
    assert.deepEqual(sortWebhookEvents(["domain.updated", "email.sent"]), [
      "email.sent",
      "domain.updated",
    ])
  })
})

describe("webhookEventsLabel", () => {
  it("counts a subset and names the full set", () => {
    assert.equal(webhookEventsLabel(["email.sent"]), "1 event")
    assert.equal(webhookEventsLabel(WEBHOOK_EVENTS), "All events")
  })
})

describe("webhookFormError", () => {
  it("wants an https endpoint, then at least one event", () => {
    assert.ok(webhookFormError("example.com/hook", ["email.sent"])?.endpoint)
    assert.ok(webhookFormError("http://example.com", ["email.sent"])?.endpoint)
    assert.ok(webhookFormError("https://example.com/hook", [])?.events)
    assert.equal(
      webhookFormError(" https://example.com/h ", ["email.sent"]),
      null
    )
  })

  it("refuses endpoints that are not public hosts", () => {
    for (const endpoint of [
      "https://127.0.0.1/hook",
      "https://0x7f.1/hook",
      "https://[::1]/hook",
      "https://localhost/hook",
      "https://api.localhost/hook",
      "https://metadata.google.internal/computeMetadata",
      "https://printer.local/hook",
      "https://intranet/hook",
      "https://user:pass@example.com/hook",
    ])
      assert.ok(webhookEndpointError(endpoint), endpoint)
    assert.equal(webhookEndpointError("https://hooks.example.com:8443/x"), null)
  })
})

describe("deliveryResult", () => {
  it("is pending while a retry is scheduled, failed once none is left", () => {
    assert.equal(deliveryResult({ status: 200 }), "Succeeded")
    assert.equal(
      deliveryResult({ status: 500, nextAttemptAt: Date.now() + 5000 }),
      "Pending"
    )
    assert.equal(deliveryResult({ status: 500 }), "Failed")
    assert.equal(deliveryResult({ status: 0 }), "Failed")
  })
})

describe("deliveries", () => {
  it("treats anything outside 2xx as failed", () => {
    assert.equal(isDeliveryFailed(delivery({ status: 204 })), false)
    assert.equal(isDeliveryFailed(delivery({ status: 500 })), true)
    assert.equal(isDeliveryFailed(delivery({ status: 0 })), true)
  })
})

test("webhook groups cover the whole catalog exactly once, including suppressions", () => {
  const events = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events)
  assert.deepEqual(new Set(events), new Set(WEBHOOK_EVENTS))
  assert.equal(events.length, WEBHOOK_EVENTS.length)
  for (const channel of ["WhatsApp", "Messenger", "Instagram"])
    assert.ok(
      WEBHOOK_EVENT_GROUPS.some((group) => group.label.startsWith(channel))
    )
  assert.match(
    webhookEventLabel("instagram.message.read"),
    /^Instagram message read$/
  )
})
test("every event has a schema-derived sample with nested channel content", () => {
  for (const type of WEBHOOK_EVENTS) {
    const sample = webhookEventSample(type)
    assert.equal(sample.type, type)
    assert.equal(typeof sample.data, "object")
    assert.ok(Object.keys(sample.data as object).length)
  }
  const data = webhookEventSample("whatsapp.message.received").data as Record<
    string,
    unknown
  >
  assert.ok(data.message)
  assert.ok(data.contact)
  assert.deepEqual(
    eventFieldExample({
      type: "array",
      description: "Values",
      example: [],
      items: { type: "string", description: "Value", example: "Ada" },
    }),
    ["Ada"]
  )
})
