import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  broadcastReachabilityLabel,
  audienceLabel,
  BROADCAST_STATUS_ORDER,
  broadcastActions,
  emailEditorMode,
  emailFrom,
  fromAddresses,
} from "./broadcast"
import { CONTACTS, EMAILS, SEGMENTS } from "./audience.fixture"
import { BROADCAST_FIXTURE } from "./broadcast.fixture"
import { broadcastStatusLabel } from "./format"
const FIXTURE = {
  contacts: CONTACTS,
  emails: EMAILS,
  segments: SEGMENTS,
  broadcasts: [BROADCAST_FIXTURE],
}

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

describe("audienceLabel", () => {
  it("uses the segment name when present", () => {
    assert.equal(
      audienceLabel("seg_newsletter", FIXTURE.segments),
      "Newsletter"
    )
  })

  it("falls back for a missing segment", () => {
    assert.equal(audienceLabel(null, FIXTURE.segments), "All contacts")
    assert.equal(audienceLabel("seg_missing", FIXTURE.segments), "All contacts")
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

describe("emailEditorMode", () => {
  it("opens an editor document visually", () => {
    assert.equal(
      emailEditorMode({ content: { type: "doc" }, html: "<p>x</p>" }),
      "visual"
    )
  })

  it("treats markup with no document behind it as hand-written", () => {
    assert.equal(emailEditorMode({ html: "<p>Hello</p>" }), "html")
  })

  it("opens a blank broadcast visually", () => {
    assert.equal(emailEditorMode({ html: "  " }), "visual")
  })
})

describe("fromAddresses", () => {
  const domains = [
    { name: "a.dev", status: "verified" as const },
    { name: "b.dev", status: "pending" as const },
    { name: "c.dev", status: "verified" as const },
  ]

  it("offers one address per verified domain", () => {
    assert.deepEqual(fromAddresses(domains), [
      "Opensend <hello@a.dev>",
      "Opensend <hello@c.dev>",
    ])
  })

  it("falls back to the shared address with no verified domain", () => {
    assert.deepEqual(fromAddresses([]), ["Opensend <hello@opensend.cc>"])
  })

  it("keeps a chosen sender only while its domain is verified", () => {
    assert.equal(
      emailFrom({ from: "Opensend <hello@c.dev>" }, domains),
      "Opensend <hello@c.dev>"
    )
    assert.equal(
      emailFrom({ from: "Opensend <hello@b.dev>" }, domains),
      "Opensend <hello@a.dev>"
    )
    assert.equal(emailFrom({}, domains), "Opensend <hello@a.dev>")
  })
})

it("broadcast review states current reachability including skipped recipients", () => {
  assert.equal(broadcastReachabilityLabel(1, 2), "1 of 3 can be reached now")
  assert.equal(broadcastReachabilityLabel(0, 2), "0 of 2 can be reached now")
})
