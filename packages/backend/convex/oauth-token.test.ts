import { afterEach, describe, expect, test, vi } from "vitest"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import type { ActionCtx } from "./_generated/server"
import { authorizeOAuth } from "./oauthHttp"
const state = vi.hoisted(() => ({
  keys: { keys: [] as Record<string, unknown>[] },
}))
vi.mock("./oauthProvider", () => ({
  oauthServer: () => ({ api: { getJwks: async () => state.keys } }),
}))
afterEach(() => vi.unstubAllEnvs())
async function fixture() {
  vi.stubEnv("SITE_URL", "https://opensend.test")
  const { publicKey, privateKey } = await generateKeyPair("ES256")
  state.keys = {
    keys: [{ ...(await exportJWK(publicKey)), kid: "oauth-key", alg: "ES256" }],
  }
  const grant = {
    _id: "grant",
    userId: "user",
    organizationId: "team",
    clientId: "client",
    scopes: ["full_access"],
  }
  const runQuery = vi.fn(async () => grant as typeof grant | null)
  const ctx = { runQuery } as unknown as ActionCtx
  const sign = (overrides: Record<string, unknown> = {}) =>
    new SignJWT({
      grant_id: "grant",
      sub: "user",
      team_id: "team",
      azp: "client",
      scope: "full_access offline_access",
      iss: "https://opensend.test/oauth",
      aud: "https://opensend.test/oauth/api",
      exp: Math.floor(Date.now() / 1000) + 900,
      ...overrides,
    })
      .setProtectedHeader({ alg: "ES256", kid: "oauth-key" })
      .sign(privateKey)
  return { ctx, sign, runQuery }
}
describe("OAuth signed token boundary", () => {
  test("returns validated grant context and public scopes", async () => {
    const f = await fixture()
    expect(await authorizeOAuth(f.ctx, await f.sign())).toMatchObject({
      user: "user",
      team: "team",
      application: "client",
      grant: "grant",
      scopes: ["full_access"],
    })
  })
  test("rejects expired access tokens before reading authorization data", async () => {
    const f = await fixture()
    await expect(
      authorizeOAuth(f.ctx, await f.sign({ exp: 1 }))
    ).rejects.toThrow()
    expect(f.runQuery).not.toHaveBeenCalled()
  })
  test("rejects dashboard issuer and audience", async () => {
    const f = await fixture()
    for (const overrides of [
      { iss: "https://opensend.test" },
      { aud: "convex" },
    ])
      await expect(
        authorizeOAuth(f.ctx, await f.sign(overrides))
      ).rejects.toThrow()
    expect(f.runQuery).not.toHaveBeenCalled()
  })
  test("a valid signature cannot bypass revocation", async () => {
    const f = await fixture()
    f.runQuery.mockResolvedValue(null)
    await expect(authorizeOAuth(f.ctx, await f.sign())).rejects.toThrow(
      "revoked"
    )
  })
  test("claims cannot select another application, user, team or permission", async () => {
    const f = await fixture()
    for (const overrides of [
      { azp: "other-client" },
      { sub: "other-user" },
      { team_id: "other-team" },
      { scope: "unknown" },
    ])
      await expect(
        authorizeOAuth(f.ctx, await f.sign(overrides))
      ).rejects.toThrow("revoked")
  })
})
