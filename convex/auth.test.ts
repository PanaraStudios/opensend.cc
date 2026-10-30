/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, test, vi } from "vitest"
import schema from "./betterAuth/schema"
import { api } from "./betterAuth/_generated/api"
const modules = import.meta.glob("./betterAuth/**/*.ts")
function setup() {
  return convexTest(schema, modules)
}
async function user(
  t: ReturnType<typeof setup>,
  email: string,
  verified = true
) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("user", {
      name: email,
      email,
      emailVerified: verified,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const sessionId = await ctx.db.insert("session", {
      userId: id,
      token: `token-${id}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    })
    return { id, sessionId }
  })
}
describe("registration policy", () => {
  test("only one concurrent bootstrap succeeds and deleting it never reopens registration", async () => {
    const t = setup()
    const results = await Promise.allSettled(
      ["a", "b"].map((userId) =>
        t.mutation(api.policy.admitUser, {
          userId,
          email: `${userId}@example.test`,
        })
      )
    )
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    await expect(
      t.mutation(api.policy.admitUser, { userId: "c", email: "c@example.test" })
    ).rejects.toThrow("invitation")
  })
  test("a stale unverified first account releases setup", async () => {
    const t = setup()
    const first = await user(t, "typo@example.test", false)
    await t.mutation(api.policy.admitUser, {
      userId: first.id,
      email: "typo@example.test",
    })
    await expect(
      t.mutation(api.policy.admitUser, { userId: "b", email: "b@example.test" })
    ).rejects.toThrow("invitation")
    const later = Date.now() + 25 * 60 * 60 * 1000
    expect(
      await t.query(api.policy.checkRegistration, {
        email: "b@example.test",
        now: later,
      })
    ).toBe(true)
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      vi.setSystemTime(later)
      const next = await user(t, "real@example.test", false)
      await t.mutation(api.policy.admitUser, {
        userId: next.id,
        email: "real@example.test",
      })
      const setup = await t.run((ctx) => ctx.db.query("bootstrap").collect())
      expect(setup.map((s) => s.userId)).toEqual([next.id])
      // The new claimant gets a full window of its own.
      await expect(
        t.mutation(api.policy.admitUser, {
          userId: "c",
          email: "c@example.test",
        })
      ).rejects.toThrow("invitation")
    } finally {
      vi.useRealTimers()
    }
  })
  test("a verified first account keeps setup", async () => {
    const t = setup()
    const first = await user(t, "admin@example.test")
    await t.mutation(api.policy.admitUser, {
      userId: first.id,
      email: "admin@example.test",
    })
    expect(
      await t.query(api.policy.checkRegistration, {
        email: "b@example.test",
        now: Date.now() + 48 * 60 * 60 * 1000,
      })
    ).toBe(false)
  })
  test("requires a pending unexpired invitation with matching email", async () => {
    const t = setup()
    await t.mutation(api.policy.admitUser, {
      userId: "owner",
      email: "owner@example.test",
    })
    await t.run((ctx) =>
      ctx.db.insert("invitation", {
        organizationId: "team",
        email: "invited@example.test",
        role: "member",
        status: "pending",
        createdAt: Date.now(),
        expiresAt: Date.now() + 10000,
        inviterId: "owner",
      })
    )
    await t.mutation(api.policy.admitUser, {
      userId: "invited",
      email: "invited@example.test",
    })
    await expect(
      t.mutation(api.policy.admitUser, {
        userId: "wrong",
        email: "wrong@example.test",
      })
    ).rejects.toThrow("invitation")
  })
  test("unverified and revoked sessions cannot use the application", async () => {
    const t = setup()
    const unverified = await user(t, "a@example.test", false)
    await expect(
      t.mutation(api.teams.create, {
        sessionId: unverified.sessionId,
        name: "Team",
      })
    ).rejects.toThrow("Verify")
    await t.run((ctx) => ctx.db.delete(unverified.sessionId))
    await expect(
      t.query(api.teams.snapshot, { sessionId: unverified.sessionId })
    ).rejects.toThrow("Sign in")
  })
})
describe("team authorization", () => {
  test("cross-team access, role escalation, and last-admin removal are refused", async () => {
    const t = setup()
    const a = await user(t, "a@example.test")
    const b = await user(t, "b@example.test")
    const org = await t.mutation(api.teams.create, {
      sessionId: a.sessionId,
      name: "Alpha",
    })
    await expect(
      t.mutation(api.teams.rename, {
        sessionId: b.sessionId,
        organizationId: org,
        name: "Stolen",
      })
    ).rejects.toThrow("permission")
    const invitation = await t.mutation(api.teams.invite, {
      sessionId: a.sessionId,
      organizationId: org,
      email: "b@example.test",
      role: "member",
    })
    await t.mutation(api.teams.respond, {
      sessionId: b.sessionId,
      invitationId: invitation.id,
      accept: true,
    })
    const snapshot = await t.query(api.teams.snapshot, {
      sessionId: a.sessionId,
    })
    const owner = snapshot.members.find((m) => m.you)!
    const member = snapshot.members.find((m) => !m.you)!
    await expect(
      t.mutation(api.teams.changeMember, {
        sessionId: b.sessionId,
        organizationId: org,
        memberId: member.id,
        role: "admin",
      })
    ).rejects.toThrow("permission")
    await expect(
      t.mutation(api.teams.changeMember, {
        sessionId: a.sessionId,
        organizationId: org,
        memberId: owner.id,
        role: "member",
      })
    ).rejects.toThrow("another admin")
    await expect(
      t.mutation(api.teams.remove, {
        sessionId: a.sessionId,
        organizationId: org,
        leave: true,
      })
    ).rejects.toThrow("another admin")
    await expect(
      t.mutation(api.teams.deleteAccount, { sessionId: a.sessionId })
    ).rejects.toThrow("another admin")
    await t.mutation(api.teams.changeMember, {
      sessionId: a.sessionId,
      organizationId: org,
      memberId: member.id,
      role: "admin",
    })
    await t.mutation(api.teams.deleteAccount, { sessionId: a.sessionId })
    expect(
      (await t.query(api.teams.snapshot, { sessionId: b.sessionId })).teams
    ).toHaveLength(1)
  })
  test("invitations cannot be accepted by a different email or twice", async () => {
    const t = setup()
    const a = await user(t, "a@example.test")
    const b = await user(t, "b@example.test")
    const org = await t.mutation(api.teams.create, {
      sessionId: a.sessionId,
      name: "Alpha",
    })
    const invite = await t.mutation(api.teams.invite, {
      sessionId: a.sessionId,
      organizationId: org,
      email: "b@example.test",
      role: "member",
    })
    await expect(
      t.mutation(api.teams.respond, {
        sessionId: a.sessionId,
        invitationId: invite.id,
        accept: true,
      })
    ).rejects.toThrow("not valid")
    await t.mutation(api.teams.respond, {
      sessionId: b.sessionId,
      invitationId: invite.id,
      accept: true,
    })
    await expect(
      t.mutation(api.teams.respond, {
        sessionId: b.sessionId,
        invitationId: invite.id,
        accept: true,
      })
    ).rejects.toThrow("not valid")
  })
  test("slugs are globally unique and sole-member account deletion removes teams", async () => {
    const t = setup()
    const a = await user(t, "a@example.test")
    const b = await user(t, "b@example.test")
    const org = await t.mutation(api.teams.create, {
      sessionId: a.sessionId,
      name: "Alpha",
    })
    await t.mutation(api.teams.create, { sessionId: b.sessionId, name: "Beta" })
    await expect(
      t.mutation(api.teams.rename, {
        sessionId: a.sessionId,
        organizationId: org,
        name: "Beta",
        slug: "beta",
      })
    ).rejects.toThrow("already in use")
    await t.mutation(api.teams.deleteAccount, { sessionId: a.sessionId })
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("organization")
          .withIndex("slug", (q) => q.eq("slug", "alpha"))
          .unique()
      )
    ).toBeNull()
  })
  test("removal takes effect for an existing session without requiring logout", async () => {
    const t = setup()
    const a = await user(t, "a@example.test")
    const b = await user(t, "b@example.test")
    const org = await t.mutation(api.teams.create, {
      sessionId: a.sessionId,
      name: "Alpha",
    })
    const invite = await t.mutation(api.teams.invite, {
      sessionId: a.sessionId,
      organizationId: org,
      email: "b@example.test",
      role: "member",
    })
    await t.mutation(api.teams.respond, {
      sessionId: b.sessionId,
      invitationId: invite.id,
      accept: true,
    })
    const snap = await t.query(api.teams.snapshot, { sessionId: a.sessionId })
    await t.mutation(api.teams.changeMember, {
      sessionId: a.sessionId,
      organizationId: org,
      memberId: snap.members.find((m) => !m.you)!.id,
    })
    expect(
      (await t.query(api.teams.snapshot, { sessionId: b.sessionId })).teams
    ).toHaveLength(0)
    await expect(
      t.mutation(api.teams.switchTeam, {
        sessionId: b.sessionId,
        organizationId: org,
      })
    ).rejects.toThrow("belong")
  })
})
describe("SSO enforcement", () => {
  test("requires a successful test, a session-specific proof, and the current revision", async () => {
    const t = setup()
    const a = await user(t, "a@example.test")
    const organizationId = await t.mutation(api.teams.create, {
      sessionId: a.sessionId,
      name: "Alpha",
    })
    const config = {
      sessionId: a.sessionId,
      organizationId,
      issuer: "https://idp.example.test",
      clientId: "test",
      encryptedSecret: "ciphertext",
      revision: "one",
    }
    await t.mutation(api.sso.save, config)
    await expect(
      t.mutation(api.sso.enforce, {
        sessionId: a.sessionId,
        organizationId,
        enabled: true,
      })
    ).rejects.toThrow("successful")
    await t.mutation(api.sso.complete, {
      sessionId: a.sessionId,
      organizationId,
      revision: "one",
    })
    await t.mutation(api.sso.enforce, {
      sessionId: a.sessionId,
      organizationId,
      enabled: true,
    })
    const other = await t.run((ctx) =>
      ctx.db.insert("session", {
        userId: a.id,
        token: "second-session",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      })
    )
    await expect(
      t.mutation(api.teams.rename, {
        sessionId: other,
        organizationId,
        name: "Bypass",
      })
    ).rejects.toThrow("SSO_REQUIRED")
    const snap = await t.query(api.teams.snapshot, { sessionId: other })
    expect(snap.members).toEqual([])
    expect(snap.teams[0].ssoRequired).toBe(true)
    expect(JSON.stringify(snap)).not.toContain("ciphertext")
    await t.mutation(api.sso.save, { ...config, revision: "two" })
    await expect(
      t.mutation(api.sso.complete, {
        sessionId: a.sessionId,
        organizationId,
        revision: "one",
      })
    ).rejects.toThrow("changed")
    await t.mutation(api.sso.recover, { organizationId })
    await t.mutation(api.teams.rename, {
      sessionId: other,
      organizationId,
      name: "Recovered",
    })
  })
})

test("expired invitations and stale authentication cannot be used", async () => {
  const t = setup()
  const a = await user(t, "a@example.test")
  const b = await user(t, "b@example.test")
  const organizationId = await t.mutation(api.teams.create, {
    sessionId: a.sessionId,
    name: "Expiry",
  })
  const invite = await t.mutation(api.teams.invite, {
    sessionId: a.sessionId,
    organizationId,
    email: "b@example.test",
    role: "member",
  })
  await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("invitation", invite.id)!
    await ctx.db.patch(id, { expiresAt: Date.now() - 1 })
    await ctx.db.patch(a.sessionId, { createdAt: Date.now() - 600000 })
  })
  await expect(
    t.mutation(api.teams.respond, {
      sessionId: b.sessionId,
      invitationId: invite.id,
      accept: true,
    })
  ).rejects.toThrow("not valid")
  await expect(
    t.mutation(api.teams.deleteAccount, { sessionId: a.sessionId })
  ).rejects.toThrow("Sign in again")
  await t.mutation(api.teams.cancelInvitation, {
    sessionId: a.sessionId,
    invitationId: invite.id,
  })
  await expect(
    t.mutation(api.teams.respond, {
      sessionId: b.sessionId,
      invitationId: invite.id,
      accept: true,
    })
  ).rejects.toThrow("not valid")
})

test("concurrent admin demotions cannot remove both owners", async () => {
  const t = setup()
  const a = await user(t, "a@example.test")
  const b = await user(t, "b@example.test")
  const organizationId = await t.mutation(api.teams.create, {
    sessionId: a.sessionId,
    name: "Concurrent",
  })
  const invitation = await t.mutation(api.teams.invite, {
    sessionId: a.sessionId,
    organizationId,
    email: "b@example.test",
    role: "admin",
  })
  await t.mutation(api.teams.respond, {
    sessionId: b.sessionId,
    invitationId: invitation.id,
    accept: true,
  })
  const snap = await t.query(api.teams.snapshot, { sessionId: a.sessionId })
  const results = await Promise.allSettled(
    snap.members.map((m) =>
      t.mutation(api.teams.changeMember, {
        sessionId: m.you ? a.sessionId : b.sessionId,
        organizationId,
        memberId: m.id,
        role: "member",
      })
    )
  )
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
  const kept = await t.run((ctx) =>
    ctx.db
      .query("member")
      .withIndex("organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .take(100)
  )
  expect(kept.filter((m) => m.role === "owner")).toHaveLength(1)
})

test("a team IdP cannot take over an existing account by claiming its email", async () => {
  const t = setup()
  const owner = await user(t, "owner@example.test")
  const victim = await user(t, "victim@example.test")
  const organizationId = await t.mutation(api.teams.create, {
    sessionId: owner.sessionId,
    name: "Untrusted IdP",
  })
  await t.mutation(api.teams.invite, {
    sessionId: owner.sessionId,
    organizationId,
    email: "victim@example.test",
    role: "member",
  })
  await t.mutation(api.sso.save, {
    sessionId: owner.sessionId,
    organizationId,
    issuer: "https://idp.example.test",
    clientId: "id",
    encryptedSecret: "ciphertext",
    revision: "one",
  })
  const identity = {
    organizationId,
    revision: "one",
    accountId: "one:claimed-subject",
    email: "victim@example.test",
    approvedDomains: [],
  }
  await expect(t.query(api.sso.authorizeIdentity, identity)).rejects.toThrow(
    "existing account"
  )
  await expect(
    t.query(api.sso.authorizeIdentity, {
      ...identity,
      initiatorSessionId: owner.sessionId,
    })
  ).rejects.toThrow("matching account")
  await t.query(api.sso.authorizeIdentity, {
    ...identity,
    initiatorSessionId: victim.sessionId,
  })
  await t.run((ctx) =>
    ctx.db.insert("account", {
      accountId: identity.accountId,
      providerId: organizationId,
      userId: victim.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
  await t.query(api.sso.authorizeIdentity, identity)
  await t.mutation(api.sso.save, {
    sessionId: owner.sessionId,
    organizationId,
    issuer: "https://other-idp.example.test",
    clientId: "id",
    encryptedSecret: "ciphertext",
    revision: "two",
  })
  await expect(
    t.query(api.sso.authorizeIdentity, {
      ...identity,
      revision: "two",
      accountId: "two:claimed-subject",
    })
  ).rejects.toThrow("existing account")
})

test("a team IdP creates new accounts only on installation-approved domains", async () => {
  const t = setup()
  const owner = await user(t, "owner@example.test")
  const organizationId = await t.mutation(api.teams.create, {
    sessionId: owner.sessionId,
    name: "IdP",
  })
  for (const email of ["new@example.test", "new@corp.test"])
    await t.mutation(api.teams.invite, {
      sessionId: owner.sessionId,
      organizationId,
      email,
      role: "member",
    })
  await t.mutation(api.sso.save, {
    sessionId: owner.sessionId,
    organizationId,
    issuer: "https://idp.example.test",
    clientId: "id",
    encryptedSecret: "ciphertext",
    revision: "one",
  })
  const identity = {
    organizationId,
    revision: "one",
    accountId: "one:new",
    email: "new@example.test",
  }
  // Invited, but no installation approval: sign up with a password first.
  await expect(
    t.query(api.sso.authorizeIdentity, { ...identity, approvedDomains: [] })
  ).rejects.toThrow("email and password first")
  await expect(
    t.query(api.sso.authorizeIdentity, {
      ...identity,
      approvedDomains: ["corp.test"],
    })
  ).rejects.toThrow("email and password first")
  await t.query(api.sso.authorizeIdentity, {
    ...identity,
    email: "new@corp.test",
    approvedDomains: ["corp.test"],
  })
})

test("unlinkProviders drops SSO links and keeps the password", async () => {
  const t = setup()
  const victim = await user(t, "victim@example.test")
  await t.run(async (ctx) => {
    for (const providerId of ["credential", "team-idp"])
      await ctx.db.insert("account", {
        accountId: `${providerId}:victim`,
        providerId,
        userId: victim.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
  })
  expect(await t.mutation(api.sso.unlinkProviders, { userId: victim.id })).toBe(
    1
  )
  const left = await t.run((ctx) =>
    ctx.db
      .query("account")
      .withIndex("userId", (q) => q.eq("userId", victim.id))
      .collect()
  )
  expect(left.map((a) => a.providerId)).toEqual(["credential"])
})
