import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { SEED_STATE } from "./data"
import { teamSafePath } from "./nav"
import {
  createTeamInRoot,
  deleteTeamInRoot,
  emailTaken,
  renameTeamInRoot,
  updateEmailInRoot,
  emptyWorkspace,
  listTeams,
  parseRoot,
  SEED_TEAM_ID,
  seedRoot,
  serializeRoot,
  switchTeamInRoot,
} from "./teams"

describe("parseRoot", () => {
  it("wraps a legacy single-workspace snapshot", () => {
    const root = parseRoot(JSON.stringify(SEED_STATE))
    assert.equal(root.version, 3)
    assert.equal(root.activeTeamId, SEED_TEAM_ID)
    assert.equal(root.workspaces[SEED_TEAM_ID]?.settings.teamName, "Opensend")
  })

  it("round-trips a multi-team root", () => {
    const created = createTeamInRoot(seedRoot(), "Acme")
    const again = parseRoot(serializeRoot(created.root))
    assert.equal(again.activeTeamId, created.teamId)
    assert.equal(listTeams(again).length, 2)
    assert.equal(again.workspaces[created.teamId]?.settings.teamSlug, "acme")
  })

  it("falls back to the seed root on junk", () => {
    const root = parseRoot("not-json")
    assert.deepEqual(root, seedRoot())
  })

  it("backfills missing broadcast stats and updatedAt", () => {
    const workspace = seedRoot().workspaces[SEED_TEAM_ID]!
    const broadcast = workspace.broadcasts[0]!
    const raw = JSON.stringify({
      version: 3,
      activeTeamId: SEED_TEAM_ID,
      workspaces: {
        [SEED_TEAM_ID]: {
          ...workspace,
          broadcasts: [
            {
              ...broadcast,
              updatedAt: 0,
              stats: {
                recipients: 10,
                delivered: 8,
                opened: 1,
                clicked: 0,
                bounced: 0,
              },
            },
          ],
        },
      },
    })
    const parsed = parseRoot(raw)
    const migrated = parsed.workspaces[SEED_TEAM_ID]!.broadcasts[0]!
    assert.equal(migrated.stats.recipients, 10)
    assert.equal(migrated.stats.delivered, 8)
    assert.equal(migrated.stats.suppressed, 0)
    assert.equal(migrated.stats.unsubscribed, 0)
    assert.equal(migrated.stats.complained, 0)
    assert.equal(migrated.updatedAt, broadcast.sentAt || broadcast.createdAt)
  })
})

describe("createTeamInRoot / switchTeamInRoot", () => {
  it("creates an empty workspace and makes it active", () => {
    const { root, teamId } = createTeamInRoot(seedRoot(), "Northwind")
    assert.equal(root.activeTeamId, teamId)
    const workspace = root.workspaces[teamId]
    assert.ok(workspace)
    assert.equal(workspace.settings.teamName, "Northwind")
    assert.equal(workspace.emails.length, 0)
    assert.equal(workspace.domains.length, 0)
    assert.equal(workspace.members.filter((member) => member.you).length, 1)
    assert.equal(
      root.workspaces[SEED_TEAM_ID]?.emails.length,
      SEED_STATE.emails.length
    )
  })

  it("rejects a blank name", () => {
    assert.throws(() => createTeamInRoot(seedRoot(), "  "), /team name/)
  })

  it("switches back without dropping the other workspace", () => {
    const created = createTeamInRoot(seedRoot(), "Acme")
    const switched = switchTeamInRoot(created.root, SEED_TEAM_ID)
    assert.equal(switched.activeTeamId, SEED_TEAM_ID)
    assert.ok(switched.workspaces[created.teamId])
  })

  it("is a no-op for an unknown id", () => {
    const root = seedRoot()
    assert.equal(switchTeamInRoot(root, "team_missing"), root)
  })
})

describe("emptyWorkspace", () => {
  it("copies the signed-in member and disconnects delivery", () => {
    const workspace = emptyWorkspace("Studio", "studio", {
      name: "Ada",
      email: "ada@example.com",
    })
    assert.equal(workspace.settings.teamSlug, "studio")
    assert.equal(workspace.settings.ses.connected, false)
    assert.equal(workspace.settings.smtp.enabled, false)
    assert.equal(
      workspace.members.every((member) => member.you),
      true
    )
  })
})

describe("teamSafePath", () => {
  it("keeps list and settings routes", () => {
    assert.equal(teamSafePath("/emails"), "/emails")
    assert.equal(teamSafePath("/emails/receiving"), "/emails/receiving")
    assert.equal(teamSafePath("/settings/team"), "/settings/team")
    assert.equal(teamSafePath("/contacts"), "/contacts")
  })

  it("drops record ids to the parent list", () => {
    assert.equal(teamSafePath("/emails/em_welcome_ada"), "/emails")
    assert.equal(teamSafePath("/domains/dom_1"), "/domains")
    assert.equal(teamSafePath("/emails/receiving/rcv_1"), "/emails/receiving")
  })

  it("falls back to emails for unknown routes", () => {
    assert.equal(teamSafePath("/not-a-page"), "/emails")
  })
})

describe("team and account changes", () => {
  it("makes whoever creates a team its admin, under their current email", () => {
    const moved = updateEmailInRoot(seedRoot(), " New@Example.com ")
    const { root, teamId } = createTeamInRoot(moved, "Acme")
    const team = listTeams(root).find((item) => item.id === teamId)!
    assert.equal(team.role, "admin")
    assert.equal(team.members, 1)
    assert.equal(root.workspaces[teamId]!.members[0]!.email, "new@example.com")
    assert.equal(
      root.workspaces[SEED_TEAM_ID]!.members.find((member) => member.you)!
        .email,
      "new@example.com"
    )
    /* Nobody else's address moves. */
    assert.equal(
      root.workspaces[SEED_TEAM_ID]!.members.find((member) => !member.you)!
        .email,
      "ada@opensend.cc"
    )
  })

  it("gives a new team a member of its own, and refuses a teammate's email", () => {
    const { root, teamId } = createTeamInRoot(seedRoot(), "Acme")
    const seeded = root.workspaces[SEED_TEAM_ID]!.members.find((m) => m.you)!
    const created = root.workspaces[teamId]!.members[0]!
    assert.notEqual(created.id, seeded.id)
    assert.equal(created.mfa, undefined)
    assert.equal(emailTaken(root, " ADA@opensend.cc"), true)
    assert.equal(emailTaken(root, seeded.email), false)
    assert.equal(updateEmailInRoot(root, "ada@opensend.cc"), root)
  })

  it("keeps a way in when none of the saved providers is known", () => {
    const root = parseRoot(
      JSON.stringify({ ...seedRoot(), account: { providers: [], mfa: null } })
    )
    assert.deepEqual(root.account.providers, seedRoot().account.providers)
  })

  it("renames a team by id, and ignores a blank name", () => {
    const root = renameTeamInRoot(seedRoot(), SEED_TEAM_ID, "  Renamed ")
    assert.equal(listTeams(root)[0]!.name, "Renamed")
    assert.equal(renameTeamInRoot(root, SEED_TEAM_ID, " "), root)
  })

  it("deletes a team, moves off it, and keeps the last one", () => {
    const { root, teamId } = createTeamInRoot(seedRoot(), "Acme")
    assert.ok(listTeams(root).every((team) => team.removable))
    const left = deleteTeamInRoot(root, teamId)
    assert.equal(left.activeTeamId, SEED_TEAM_ID)
    assert.deepEqual(Object.keys(left.workspaces), [SEED_TEAM_ID])
    assert.equal(listTeams(left)[0]!.removable, false)
    assert.equal(deleteTeamInRoot(left, SEED_TEAM_ID), left)
  })

  it("migrates old demo accounts without restoring MFA secrets", () => {
    const legacy: Partial<ReturnType<typeof seedRoot>> = seedRoot()
    delete legacy.account
    const root = parseRoot(JSON.stringify(legacy))
    assert.deepEqual(root.account, seedRoot().account)
    const kept = parseRoot(
      JSON.stringify({
        ...legacy,
        account: {
          providers: [
            { provider: "github", connectedAt: 5 },
            { provider: "nope", connectedAt: 5 },
          ],
          mfa: { secret: "ABC", enabledAt: 9 },
        },
      })
    )
    assert.deepEqual(kept.account, {
      providers: [{ provider: "github", connectedAt: 5 }],
      mfa: null,
    })
  })
})
