import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { invitationExpired, liveInvitations } from "./invitations"

describe("invitations", () => {
  const rows = [
    { id: "old", expiresAt: 1000 },
    { id: "edge", expiresAt: 2000 },
    { id: "new", expiresAt: 3000 },
  ]

  it("hides invitations at or past their expiry", () => {
    assert.deepEqual(
      liveInvitations(rows, 2000).map((i) => i.id),
      ["new"]
    )
    assert.equal(invitationExpired(rows[1], 2000), true)
    assert.equal(invitationExpired(rows[2], 2000), false)
  })

  it("keeps every invitation before the browser clock is known", () => {
    assert.equal(liveInvitations(rows, null).length, 3)
    assert.equal(invitationExpired(rows[0], null), false)
  })
})
