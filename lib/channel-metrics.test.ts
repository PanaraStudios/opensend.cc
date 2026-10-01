import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  channelRates,
  emptyChannelCounts,
  rollupChannelCounts,
  sumChannelCounts,
} from "./channel-metrics"

describe("channel metrics", () => {
  it("counts every outbound attempt once and includes read in delivered", () => {
    const counts = rollupChannelCounts({
      queued: 2,
      sent: 3,
      delivered: 4,
      read: 5,
      failed: 6,
      received: 7,
    })
    assert.deepEqual(counts, {
      sent: 20,
      delivered: 9,
      read: 5,
      failed: 6,
      received: 7,
    })
    assert.deepEqual(channelRates(counts), { deliveryRate: 45, readRate: 25 })
  })
  it("uses the outbound total for both rates and guards empty/inbound-only ranges", () => {
    assert.deepEqual(
      channelRates({
        sent: 7,
        delivered: 3,
        read: 1,
        failed: 1,
        received: 100,
      }),
      {
        deliveryRate: 43,
        readRate: 14,
      }
    )
    assert.deepEqual(channelRates({ ...emptyChannelCounts(), received: 100 }), {
      deliveryRate: 0,
      readRate: 0,
    })
    assert.deepEqual(channelRates(emptyChannelCounts()), {
      deliveryRate: 0,
      readRate: 0,
    })
  })
  it("adds spans before computing rates, rather than averaging daily rates", () => {
    const counts = sumChannelCounts([
      { sent: 1, delivered: 1, read: 1, failed: 0, received: 2 },
      { sent: 9, delivered: 0, read: 0, failed: 9, received: 3 },
    ])
    assert.deepEqual(counts, {
      sent: 10,
      delivered: 1,
      read: 1,
      failed: 9,
      received: 5,
    })
    assert.deepEqual(channelRates(counts), { deliveryRate: 10, readRate: 10 })
    assert.deepEqual(sumChannelCounts([]), emptyChannelCounts())
  })
  it("preserves sent and delivered totals after advancing a delivery to read", () => {
    const before = rollupChannelCounts({
      queued: 0,
      sent: 0,
      delivered: 1,
      read: 0,
      failed: 0,
      received: 0,
    })
    const after = rollupChannelCounts({
      queued: 0,
      sent: 0,
      delivered: 0,
      read: 1,
      failed: 0,
      received: 0,
    })
    assert.equal(after.sent, before.sent)
    assert.equal(after.delivered, before.delivered)
    assert.equal(after.read, 1)
  })
})
