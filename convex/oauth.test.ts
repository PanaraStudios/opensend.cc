/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import schema from "./betterAuth/schema"
import { api } from "./betterAuth/_generated/api"
import {
  parseScopes,
  validateCallback,
  authContinuation,
} from "../lib/oauth/policy"
const modules = import.meta.glob("./betterAuth/**/*.ts")
async function fixture() {
  const t = convexTest(schema, modules)
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("user", {
      name: "Owner",
      email: "owner@test.dev",
      emailVerified: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const sessionId = await ctx.db.insert("session", {
      userId,
      token: "browser",
      expiresAt: Date.now() + 3600000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    return { userId, sessionId }
  })
  const organizationId = await t.mutation(api.teams.create, {
    sessionId,
    name: "Team",
  })
  const otherTeam = await t.mutation(api.teams.create, {
    sessionId,
    name: "Other",
  })
  await t.mutation(api.oauthClients.register, {
    clientId: "client",
    name: "Example",
    redirects: ["https://client.test/callback"],
    scope: "full_access emails:send",
    method: "none",
  })
  let sequence = 0
  async function start(scope = "full_access") {
    const token = `flow-${++sequence}`
    await t.mutation(api.oauth.start, {
      token,
      browserHash: "browser-hash",
      query: new URLSearchParams({
        client_id: "client",
        redirect_uri: "https://client.test/callback",
        scope,
        response_type: "code",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      }).toString(),
    })
    return token
  }
  async function approve(team = organizationId, scope = "full_access") {
    const token = await start(scope)
    const result = await t.mutation(api.oauth.decide, {
      token,
      browserHash: "browser-hash",
      sessionId,
      organizationId: team,
      accept: true,
    })
    return result.grantId!
  }
  return { t, userId, sessionId, organizationId, otherTeam, start, approve }
}
describe("OAuth boundary validation", () => {
  test("requires explicit registered scopes and safe exact callbacks", () => {
    for (const value of [
      undefined,
      "",
      "openid",
      "full_access offline_access",
      "constructor",
    ])
      expect(() => parseScopes(value)).toThrow()
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://user:pass@site.test/cb",
      "https://site.test/#x",
      "https://*.test/cb",
      "http://remote.test/cb",
      "file:///tmp/cb",
      "com.example://host/cb",
    ])
      expect(() => validateCallback(value)).toThrow()
    for (const value of [
      "https://site.test/cb",
      "http://127.0.0.1:8765/cb",
      "http://[::1]:8765/cb",
      "com.example.app:/oauth/callback",
    ])
      expect(validateCallback(value)).toBe(value)
    expect(authContinuation("//evil.test")).toBe("/emails")
    expect(authContinuation("/oauth/consent?flow=" + "a".repeat(64))).toContain(
      "/oauth/consent"
    )
    expect(
      authContinuation("/oauth/consent?flow=a&next=https://evil.test")
    ).toBe("/emails")
  })
  test("forged, expired, and already used continuations fail", async () => {
    const f = await fixture(),
      token = await f.start()
    await expect(
      f.t.query(api.oauth.pending, { token, browserHash: "forged" })
    ).rejects.toThrow("unavailable")
    await f.t.mutation(api.oauth.decide, {
      token,
      browserHash: "browser-hash",
      sessionId: f.sessionId,
      organizationId: f.organizationId,
      accept: false,
    })
    await expect(
      f.t.query(api.oauth.pending, { token, browserHash: "browser-hash" })
    ).rejects.toThrow("unavailable")
    const expired = await f.start()
    await f.t.run(async (ctx) => {
      const row = await ctx.db
        .query("oauthFlow")
        .withIndex("by_token", (q) => q.eq("token", expired))
        .unique()
      await ctx.db.patch(row!._id, { expiresAt: 0 })
    })
    await expect(
      f.t.query(api.oauth.pending, {
        token: expired,
        browserHash: "browser-hash",
      })
    ).rejects.toThrow("expired")
  })
  test("consent requires verified current admin membership", async () => {
    const f = await fixture(),
      token = await f.start()
    await f.t.run(async (ctx) => {
      const m = await ctx.db
        .query("member")
        .withIndex("by_organizationId_and_userId", (q) =>
          q.eq("organizationId", f.organizationId).eq("userId", f.userId)
        )
        .unique()
      await ctx.db.patch(m!._id, { role: "member" })
    })
    await expect(
      f.t.mutation(api.oauth.decide, {
        token,
        browserHash: "browser-hash",
        sessionId: f.sessionId,
        organizationId: f.organizationId,
        accept: true,
      })
    ).rejects.toThrow("permission")
    await f.t.run((ctx) => ctx.db.patch(f.userId, { emailVerified: false }))
    await expect(f.approve(f.otherTeam)).rejects.toThrow("Verify")
  })
})
describe("OAuth live authorization and replay", () => {
  test("team settings list all team authorizations; profile lists only the authorizer's", async () => {
    const f = await fixture()
    const own = await f.approve()
    const otherTeam = await f.approve(f.otherTeam)
    const otherSession = await f.t.run(async (ctx) => {
      const userId = await ctx.db.insert("user", {
        name: "Second admin",
        email: "admin@test.dev",
        emailVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      await ctx.db.insert("member", {
        userId,
        organizationId: f.organizationId,
        role: "owner",
        createdAt: Date.now(),
      })
      return ctx.db.insert("session", {
        userId,
        token: "second-admin",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      })
    })
    const other = await f.t.mutation(api.oauth.decide, {
      token: await f.start(),
      browserHash: "browser-hash",
      sessionId: otherSession,
      organizationId: f.organizationId,
      accept: true,
    })
    const teamRows = await f.t.query(api.oauth.list, {
      sessionId: f.sessionId,
      organizationId: f.organizationId,
    })
    expect(teamRows.map((row) => row.id).sort()).toEqual(
      [own, other.grantId!].sort()
    )
    expect(
      (await f.t.query(api.oauth.list, { sessionId: f.sessionId }))
        .map((row) => row.id)
        .sort()
    ).toEqual([own, otherTeam].sort())
    const ownId = await f.t.run(async (ctx) =>
      ctx.db.normalizeId("oauthGrant", own)
    )
    const otherTeamId = await f.t.run(async (ctx) =>
      ctx.db.normalizeId("oauthGrant", otherTeam)
    )
    await expect(
      f.t.mutation(api.oauth.disconnect, {
        sessionId: otherSession,
        id: ownId!,
      })
    ).rejects.toThrow("not found")
    await expect(
      f.t.mutation(api.oauth.disconnect, {
        sessionId: otherSession,
        organizationId: f.organizationId,
        id: otherTeamId!,
      })
    ).rejects.toThrow("not found")
    await f.t.mutation(api.oauth.disconnect, {
      sessionId: otherSession,
      organizationId: f.organizationId,
      id: ownId!,
    })
    expect(await f.t.query(api.oauth.checkGrant, { id: own })).toBeNull()
    expect(
      (await f.t.query(api.oauth.list, { sessionId: f.sessionId })).map(
        (row) => row.id
      )
    ).toEqual([otherTeam])
  })
  test("team app management requires current admin membership and SSO", async () => {
    const f = await fixture(),
      grantId = await f.approve()
    const member = await f.t.run((ctx) =>
      ctx.db
        .query("member")
        .withIndex("by_organizationId_and_userId", (q) =>
          q.eq("organizationId", f.organizationId).eq("userId", f.userId)
        )
        .unique()
    )
    const id = await f.t.run(async (ctx) =>
      ctx.db.normalizeId("oauthGrant", grantId)
    )
    await f.t.run((ctx) => ctx.db.patch(member!._id, { role: "member" }))
    await expect(
      f.t.query(api.oauth.list, {
        sessionId: f.sessionId,
        organizationId: f.organizationId,
      })
    ).rejects.toThrow("permission")
    await expect(
      f.t.mutation(api.oauth.disconnect, {
        sessionId: f.sessionId,
        organizationId: f.organizationId,
        id: id!,
      })
    ).rejects.toThrow("permission")
    await f.t.run(async (ctx) => {
      await ctx.db.patch(member!._id, { role: "owner" })
      await ctx.db.insert("sso", {
        organizationId: f.organizationId,
        issuer: "https://idp.test",
        clientId: "idp",
        encryptedSecret: "secret",
        revision: "required",
        enforced: true,
        tested: true,
      })
    })
    await expect(
      f.t.query(api.oauth.list, {
        sessionId: f.sessionId,
        organizationId: f.organizationId,
      })
    ).rejects.toThrow("SSO_REQUIRED")
    await expect(
      f.t.mutation(api.oauth.disconnect, {
        sessionId: f.sessionId,
        organizationId: f.organizationId,
        id: id!,
      })
    ).rejects.toThrow("SSO_REQUIRED")
  })
  test("expired codes and refresh tokens cannot be consumed", async () => {
    const f = await fixture(),
      id = await f.approve()
    await f.t.run(async (ctx) => {
      await ctx.db.insert("verification", {
        identifier: "expired-code",
        value: JSON.stringify({
          referenceId: id,
          query: { client_id: "client" },
        }),
        expiresAt: 0,
        createdAt: 0,
        updatedAt: 0,
      })
      await ctx.db.insert("oauthRefreshToken", {
        token: "expired-refresh",
        clientId: "client",
        userId: f.userId,
        referenceId: id,
        expiresAt: 0,
        createdAt: 0,
        scopes: ["full_access"],
      })
    })
    for (const kind of ["code", "refresh"] as const)
      expect(
        await f.t.mutation(api.oauth.claim, {
          hash: `expired-${kind}`,
          kind,
          clientId: "client",
        })
      ).toBeNull()
  })
  test("demoting then restoring an admin does not revive an authorization", async () => {
    const f = await fixture(),
      id = await f.approve()
    const other = await f.t.run(async (ctx) => {
      const userId = await ctx.db.insert("user", {
        name: "Other",
        email: "other@test.dev",
        emailVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      await ctx.db.insert("member", {
        organizationId: f.organizationId,
        userId,
        role: "owner",
        createdAt: Date.now(),
      })
      return ctx.db.insert("session", {
        userId,
        token: "other-session",
        expiresAt: Date.now() + 60000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })
    const memberId = (
      await f.t.query(api.teams.snapshot, { sessionId: f.sessionId })
    ).teams.find((t) => t.id === f.organizationId)!.id
    const member = await f.t.run((ctx) =>
      ctx.db
        .query("member")
        .withIndex("by_organizationId_and_userId", (q) =>
          q.eq("organizationId", memberId).eq("userId", f.userId)
        )
        .unique()
    )
    await f.t.mutation(api.teams.changeMember, {
      sessionId: other,
      organizationId: f.organizationId,
      memberId: member!._id,
      role: "member",
    })
    await f.t.mutation(api.teams.changeMember, {
      sessionId: other,
      organizationId: f.organizationId,
      memberId: member!._id,
      role: "admin",
    })
    expect(await f.t.query(api.oauth.checkGrant, { id })).toBeNull()
  })
  test("selected team is independent of dashboard switching; sending scope cannot manage grants", async () => {
    const f = await fixture(),
      id = await f.approve()
    await f.t.mutation(api.teams.switchTeam, {
      sessionId: f.sessionId,
      organizationId: f.otherTeam,
    })
    expect(
      (await f.t.query(api.oauth.checkGrant, { id }))?.organizationId
    ).toBe(f.organizationId)
    const otherId = await f.approve(f.otherTeam)
    await expect(
      f.t.mutation(api.oauth.resource, {
        grantId: id,
        scopes: ["full_access"],
        revokeId: otherId,
      })
    ).rejects.toThrow("not found")
    const sending = await f.approve(f.organizationId, "emails:send")
    await expect(
      f.t.mutation(api.oauth.resource, {
        grantId: sending,
        scopes: ["emails:send"],
      })
    ).rejects.toThrow("permission")
    await expect(
      f.t.mutation(api.oauth.resource, {
        grantId: sending,
        scopes: ["full_access"],
      })
    ).rejects.toThrow("permission")
  })
  for (const kind of ["code", "refresh"] as const)
    test(`concurrent ${kind} consumption succeeds once and replay revokes the grant`, async () => {
      const f = await fixture(),
        id = await f.approve()
      await f.t.run(async (ctx) => {
        if (kind === "code")
          await ctx.db.insert("verification", {
            identifier: "hash",
            value: JSON.stringify({
              referenceId: id,
              query: { client_id: "client" },
            }),
            expiresAt: Date.now() + 60000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        else
          await ctx.db.insert("oauthRefreshToken", {
            token: "hash",
            clientId: "client",
            userId: f.userId,
            referenceId: id,
            expiresAt: Date.now() + 60000,
            createdAt: Date.now(),
            scopes: ["full_access", "offline_access"],
          })
      })
      const results = await Promise.all(
        [1, 2].map(() =>
          f.t.mutation(api.oauth.claim, {
            hash: "hash",
            kind,
            clientId: "client",
          })
        )
      )
      expect(results.filter(Boolean)).toHaveLength(1)
      expect(await f.t.query(api.oauth.checkGrant, { id })).toBeNull()
    })
  test("disconnect is immediate; reconnect never revives old tokens", async () => {
    const f = await fixture(),
      id = await f.approve()
    await f.t.mutation(api.oauth.revokeGrant, { id, clientId: "client" })
    const next = await f.approve()
    expect(await f.t.query(api.oauth.checkGrant, { id })).toBeNull()
    expect(await f.t.query(api.oauth.checkGrant, { id: next })).not.toBeNull()
  })
  test("ordinary logout preserves access; password reset invalidates it", async () => {
    const f = await fixture(),
      id = await f.approve()
    await f.t.run((ctx) => ctx.db.delete(f.sessionId))
    expect(await f.t.query(api.oauth.checkGrant, { id })).not.toBeNull()
    await f.t.mutation(api.oauth.invalidateUser, { userId: f.userId })
    expect(await f.t.query(api.oauth.checkGrant, { id })).toBeNull()
  })
  test("SSO connection and policy changes invalidate prior grants", async () => {
    const f = await fixture(),
      id = await f.approve()
    await f.t.mutation(api.sso.save, {
      sessionId: f.sessionId,
      organizationId: f.organizationId,
      issuer: "https://idp.test",
      clientId: "idp",
      encryptedSecret: "encrypted",
      revision: "one",
    })
    expect(await f.t.query(api.oauth.checkGrant, { id })).toBeNull()
    const next = await f.approve()
    await f.t.mutation(api.sso.complete, {
      sessionId: f.sessionId,
      organizationId: f.organizationId,
      revision: "one",
    })
    await f.t.mutation(api.sso.enforce, {
      sessionId: f.sessionId,
      organizationId: f.organizationId,
      enabled: true,
    })
    expect(await f.t.query(api.oauth.checkGrant, { id: next })).toBeNull()
  })
  test("disabled/deleted apps, removed users and deleted teams lose access", async () => {
    for (const operation of ["disable", "delete", "user", "team"] as const) {
      const f = await fixture(),
        id = await f.approve()
      if (operation === "disable" || operation === "delete")
        await f.t.mutation(api.oauthClients.maintain, {
          clientId: "client",
          operation,
        })
      else if (operation === "user")
        await f.t.run((ctx) => ctx.db.delete(f.userId))
      else
        await f.t.mutation(api.teams.remove, {
          sessionId: f.sessionId,
          organizationId: f.organizationId,
          leave: false,
        })
      expect(await f.t.query(api.oauth.checkGrant, { id })).toBeNull()
    }
  })
  test("persistent rate limits fail closed and reset after their window", async () => {
    const f = await fixture()
    expect(
      await f.t.mutation(api.oauth.rate, {
        key: "register",
        max: 1,
        window: 60000,
      })
    ).toBe(true)
    expect(
      await f.t.mutation(api.oauth.rate, {
        key: "register",
        max: 1,
        window: 60000,
      })
    ).toBe(false)
    await f.t.run(async (ctx) => {
      const row = await ctx.db
        .query("oauthRate")
        .withIndex("by_key", (q) => q.eq("key", "register"))
        .unique()
      await ctx.db.patch(row!._id, { start: 0 })
    })
    expect(
      await f.t.mutation(api.oauth.rate, {
        key: "register",
        max: 1,
        window: 60000,
      })
    ).toBe(true)
  })
})
