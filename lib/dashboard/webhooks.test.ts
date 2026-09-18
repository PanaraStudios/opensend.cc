import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { WEBHOOK_EVENTS, type Webhook, type WebhookDelivery } from "./types"
import {
  isDeliveryFailed,
  normalizeWebhook,
  replayedDelivery,
  sortWebhookEvents,
  WEBHOOK_EVENT_GROUPS,
  webhookDeliveries,
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
  it("puts every event in exactly one group", () => {
    const grouped = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events)
    assert.deepEqual([...grouped].sort(), [...WEBHOOK_EVENTS].sort())
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
})

describe("deliveries", () => {
  it("treats anything outside 2xx as failed", () => {
    assert.equal(isDeliveryFailed(delivery({ status: 204 })), false)
    assert.equal(isDeliveryFailed(delivery({ status: 500 })), true)
    assert.equal(isDeliveryFailed(delivery({ status: 0 })), true)
  })

  it("lists one webhook's deliveries newest first", () => {
    const rows = webhookDeliveries(
      [
        delivery({ id: "a", createdAt: 1 }),
        delivery({ id: "b", createdAt: 3 }),
        delivery({ id: "c", webhookId: "wh_2", createdAt: 2 }),
      ],
      "wh_1"
    )
    assert.deepEqual(
      rows.map((row) => row.id),
      ["b", "a"]
    )
  })

  it("replays as a new, successful attempt at the same payload", () => {
    const failed = delivery({ status: 500, response: "Internal Server Error" })
    const next = replayedDelivery(failed, "whd_2", 9)
    assert.deepEqual(
      [next.id, next.status, next.attempts, next.createdAt],
      ["whd_2", 200, 2, 9]
    )
    assert.equal(next.payload, failed.payload)
  })
})

describe("normalizeWebhook", () => {
  it("derives a stable secret for a record that only kept the tail", () => {
    const old = {
      id: "wh_prod",
      endpoint: "https://example.com",
      events: [],
      enabled: true,
      signingSecretLast4: "a91c",
      createdAt: 1,
    } as unknown as Webhook
    const first = normalizeWebhook(old)
    assert.match(first.signingSecret, /^whsec_.{32}a91c$/)
    assert.deepEqual(normalizeWebhook(old), first)
    assert.equal("signingSecretLast4" in first, false)
    assert.equal(normalizeWebhook(first), first)
  })
})
