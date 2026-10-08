import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { teamSafePath } from "./nav"

describe("teamSafePath", () => {
  it("keeps list and settings routes", () => {
    assert.equal(teamSafePath("/emails"), "/emails")
    for (const tab of ["", "/inbox", "/calls", "/ivr", "/voice-bot"])
      assert.equal(teamSafePath(`/playground${tab}`), `/playground${tab}`)
    assert.equal(teamSafePath("/emails/receiving"), "/emails/receiving")
    assert.equal(teamSafePath("/settings/team"), "/settings/team")
    assert.equal(teamSafePath("/instance/ses"), "/instance/ses")
    assert.equal(teamSafePath("/instance/meta"), "/instance/meta")
    assert.equal(teamSafePath("/instance/general"), "/instance/general")
    assert.equal(teamSafePath("/contacts"), "/contacts")
    assert.equal(teamSafePath("/channels"), "/channels")
  })

  it("drops record ids to the parent list", () => {
    assert.equal(teamSafePath("/emails/em_welcome_ada"), "/emails")
    assert.equal(teamSafePath("/channels/acc_1"), "/channels")
    // The old Domains list redirects to Channels on email.
    assert.equal(teamSafePath("/domains/dom_1"), "/domains")
    assert.equal(teamSafePath("/emails/receiving/rcv_1"), "/emails/receiving")
    assert.equal(teamSafePath("/emails/messages/msg_1"), "/emails")
    assert.equal(teamSafePath("/emails/inbox"), "/emails")
    assert.equal(teamSafePath("/emails/calls"), "/emails")
  })

  it("falls back to emails for unknown routes", () => {
    assert.equal(teamSafePath("/not-a-page"), "/emails")
  })
})
