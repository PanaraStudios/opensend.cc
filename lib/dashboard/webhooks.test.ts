import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { WEBHOOK_EVENTS, type WebhookDelivery } from "./types"
import {
  deliveryResult,
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
  it("keeps the existing dashboard groups while REST also supports suppression events", () => {
    const grouped = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events)
    // Wave 8 adds backend subscriptions without changing the dashboard UI.
    const visible = WEBHOOK_EVENTS.filter(
      (event) => !event.startsWith("suppression.")
    )
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
