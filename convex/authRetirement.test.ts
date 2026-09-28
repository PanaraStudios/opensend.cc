/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { afterEach, expect, test, vi } from "vitest"
import schema from "./betterAuth/schema"
import { api } from "./betterAuth/_generated/api"
import { ORGANIZATION_TABLES, organizationRows } from "./betterAuth/teams"

afterEach(() => vi.useRealTimers())

test("component retirement batches memberships, invitations, proofs and grant children", async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, import.meta.glob("./betterAuth/**/*.ts"))
  const storageId = await t.run(async (ctx) => {
    for (let i = 0; i < 20; i++) {
      await ctx.db.insert("member", {
        organizationId: "gone",
        userId: `user-${i}`,
        role: "member",
        createdAt: 0,
      })
      await ctx.db.insert("invitation", {
        organizationId: "gone",
        email: `user${i}@example.com`,
        status: "pending",
        expiresAt: 1,
        createdAt: 0,
        inviterId: "user",
      })
      await ctx.db.insert("ssoProof", {
        organizationId: "gone",
        sessionId: `session-${i}`,
        revision: "revision",
      })
    }
    await ctx.db.insert("member", {
      organizationId: "other",
      userId: "safe",
      role: "owner",
      createdAt: 0,
    })
    await ctx.db.insert("sso", {
      organizationId: "gone",
      issuer: "https://identity.example",
      clientId: "client",
      encryptedSecret: "secret",
      revision: "revision",
      tested: true,
      enforced: true,
    })
    const storageId = await ctx.storage.store(new Blob(["avatar"]))
    await ctx.db.insert("avatar", { organizationId: "gone", storageId })
    const grant = await ctx.db.insert("oauthGrant", {
      organizationId: "gone",
      clientId: "client",
      userId: "user",
      memberId: "member",
      scopes: [],
      epochs: [],
      createdAt: 0,
      revoked: false,
    })
    for (let i = 0; i < 20; i++) {
      await ctx.db.insert("oauthUse", { key: `use-${i}`, grantId: grant })
      const row = {
        clientId: "client",
        userId: "user",
        referenceId: grant,
        scopes: [],
        createdAt: 0,
      }
      await ctx.db.insert("oauthAccessToken", {
        ...row,
        token: `access-${i}`,
        expiresAt: 10,
      })
      await ctx.db.insert("oauthRefreshToken", {
        ...row,
        token: `refresh-${i}`,
        expiresAt: 10,
      })
      await ctx.db.insert("oauthConsent", { ...row, updatedAt: 0 })
    }
    return storageId
  })
  await t.mutation(api.teams.purgeOrganization, { organizationId: "gone" })
  expect(await t.run((ctx) => ctx.db.query("ssoProof").collect())).toHaveLength(
    12
  )
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  await t.run(async (ctx) => {
    for (const table of ORGANIZATION_TABLES)
      expect(await organizationRows(ctx, table, "gone", 100)).toEqual([])
    for (const table of [
      "oauthUse",
      "oauthAccessToken",
      "oauthRefreshToken",
      "oauthConsent",
    ] as const)
      expect(await ctx.db.query(table).collect()).toEqual([])
    expect(await ctx.db.query("member").collect()).toHaveLength(1)
    expect(await ctx.storage.get(storageId)).toBeNull()
  })
})
