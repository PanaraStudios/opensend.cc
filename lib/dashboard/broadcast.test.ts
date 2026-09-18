import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  audienceLabel,
  BROADCAST_STATUS_ORDER,
  broadcastActions,
  broadcastEventRows,
  broadcastUpdatedAt,
  emptyBroadcastStats,
  normalizeBroadcastStats,
  canTransitionBroadcast,
  transitionBroadcast,
} from "./broadcast"
import { SEED_STATE } from "./data"
import { broadcastStatusLabel } from "./format"

describe("BROADCAST_STATUS_ORDER", () => {
  it("includes canceled after failed", () => {
    assert.deepEqual(BROADCAST_STATUS_ORDER, [
      "draft",
      "scheduled",
      "queued",
      "sent",
      "failed",
      "canceled",
    ])
  })
})

describe("broadcastStatusLabel", () => {
  it("labels in-flight broadcasts as Sending", () => {
    assert.equal(broadcastStatusLabel("queued"), "Sending")
  })
})

describe("broadcastUpdatedAt", () => {
  it("falls back to sentAt then createdAt", () => {
    const item = SEED_STATE.broadcasts[0]!
    assert.equal(
      broadcastUpdatedAt({ ...item, updatedAt: 0, sentAt: 42, createdAt: 1 }),
      42
    )
    assert.equal(
      broadcastUpdatedAt({
        ...item,
        updatedAt: 0,
        sentAt: null,
        createdAt: 7,
      }),
      7
    )
  })
})

describe("audienceLabel", () => {
  it("uses the segment name when present", () => {
    assert.equal(
      audienceLabel("seg_newsletter", SEED_STATE.segments),
      "Newsletter"
    )
  })

  it("falls back for a missing segment", () => {
    assert.equal(audienceLabel(null, SEED_STATE.segments), "All contacts")
    assert.equal(
      audienceLabel("seg_missing", SEED_STATE.segments),
      "All contacts"
    )
  })
})

describe("broadcastEventRows", () => {
  it("scopes unsubscribed rows to recipients of this send", () => {
    const launch = SEED_STATE.broadcasts.find(
      (item) => item.id === "brd_launch"
    )!
    const rows = broadcastEventRows(SEED_STATE, launch, "unsubscribed")
    assert.deepEqual(rows, [])
  })

  it("does not list a globally unsubscribed contact who was not a recipient", () => {
    const launch = SEED_STATE.broadcasts.find(
      (item) => item.id === "brd_launch"
    )!
    const state = {
      ...SEED_STATE,
      contacts: SEED_STATE.contacts.map((contact) =>
        contact.email === "alan@bletchley.uk"
          ? { ...contact, unsubscribed: true }
          : contact
      ),
    }
    const rows = broadcastEventRows(state, launch, "unsubscribed")
    assert.equal(
      rows.some((row) => row.email === "alan@bletchley.uk"),
      false
    )
  })

  it("includes an unsubscribed recipient of this broadcast", () => {
    const launch = SEED_STATE.broadcasts.find(
      (item) => item.id === "brd_launch"
    )!
    const state = {
      ...SEED_STATE,
      contacts: SEED_STATE.contacts.map((contact) =>
        contact.email === "margaret@hamilton.space"
          ? { ...contact, unsubscribed: true }
          : contact
      ),
    }
    const rows = broadcastEventRows(state, launch, "unsubscribed")
    assert.deepEqual(rows, [{ email: "margaret@hamilton.space" }])
  })

  it("lists bounced recipients for this broadcast", () => {
    const launch = SEED_STATE.broadcasts.find(
      (item) => item.id === "brd_launch"
    )!
    const rows = broadcastEventRows(SEED_STATE, launch, "bounced")
    assert.deepEqual(rows, [{ email: "gone@example.invalid" }])
  })
})

describe("broadcastActions", () => {
  it("offers schedule and send on drafts, cancel on in-flight sends", () => {
    assert.deepEqual(broadcastActions("draft"), {
      canSchedule: true,
      canSend: true,
      canCancel: false,
    })
    assert.deepEqual(broadcastActions("scheduled"), {
      canSchedule: false,
      canSend: true,
      canCancel: true,
    })
    assert.deepEqual(broadcastActions("queued"), {
      canSchedule: false,
      canSend: false,
      canCancel: true,
    })
    assert.deepEqual(broadcastActions("sent"), {
      canSchedule: false,
      canSend: false,
      canCancel: false,
    })
    assert.deepEqual(broadcastActions("canceled"), broadcastActions("draft"))
  })
})

describe("transitionBroadcast", () => {
  const item = { ...SEED_STATE.broadcasts[0]!, status: "draft" as const }

  it("stamps sentAt and seeds delivery stats on send", () => {
    const next = transitionBroadcast(
      { ...item, status: "scheduled", scheduledAt: 5 },
      "sent",
      { now: 100, recipients: 7 }
    )
    assert.equal(next.status, "sent")
    assert.equal(next.sentAt, 100)
    assert.equal(next.updatedAt, 100)
    assert.equal(next.scheduledAt, null)
    assert.deepEqual(next.stats, {
      ...emptyBroadcastStats(),
      recipients: 7,
      delivered: 7,
    })
  })

  it("keeps the requested time on schedule and clears it on cancel", () => {
    const scheduled = transitionBroadcast(item, "scheduled", {
      now: 100,
      scheduledAt: 900,
    })
    assert.equal(scheduled.scheduledAt, 900)
    const canceled = transitionBroadcast(scheduled, "canceled", { now: 101 })
    assert.equal(canceled.scheduledAt, null)
    assert.equal(canceled.updatedAt, 101)
  })
})

describe("canTransitionBroadcast", () => {
  it("refuses illegal transitions and schedules without a time", () => {
    const sent = { ...SEED_STATE.broadcasts[0]!, status: "sent" as const }
    assert.equal(canTransitionBroadcast("sent", "sent"), false)
    assert.equal(canTransitionBroadcast("draft", "scheduled"), false)
    assert.equal(canTransitionBroadcast("draft", "scheduled", 1), true)
    assert.equal(canTransitionBroadcast("queued", "canceled"), true)
    assert.equal(
      transitionBroadcast(sent, "sent", { now: 5, recipients: 1 }),
      sent
    )
  })
})

describe("normalizeBroadcastStats", () => {
  it("fills missing counters with zero", () => {
    assert.deepEqual(normalizeBroadcastStats({ recipients: 3 }), {
      ...emptyBroadcastStats(),
      recipients: 3,
    })
  })
})
