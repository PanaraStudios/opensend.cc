import { afterEach, expect, test, vi } from "vitest"
import { generateKeyPair, exportJWK, SignJWT } from "jose"
import { symmetricEncrypt } from "better-auth/crypto"
import { getOAuthState } from "better-auth/api"
import { loadProvider } from "./oidc"
import { internal } from "./_generated/api"
import type { ActionCtx } from "./_generated/server"
import { fixture } from "./testHelpers/ses.fixture"
import * as transport from "../lib/net/public-fetch"

vi.mock("better-auth/api", async (original) => ({
  ...(await original<typeof import("better-auth/api")>()),
  getOAuthState: vi.fn(),
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

test("OIDC discovery failures consume the team's allowance before authentication middleware", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const f = await fixture()
  const fetcher = vi
    .spyOn(transport, "publicFetch")
    .mockResolvedValue(new Response(null, { status: 503 }))
  const ctx = {
    runQuery: vi.fn().mockResolvedValue({ issuer: "https://identity.example" }),
    runMutation: (
      ref: typeof internal.oidc.reserveDiscovery,
      args: { organizationId: string }
    ) => f.t.mutation(ref, args),
    runAction: (
      _ref: unknown,
      args: {
        url: string
        method: "GET" | "POST"
        headers: Record<string, string>
      }
    ) => f.t.action(internal.publicHttp.request, args),
  } as unknown as ActionCtx
  for (let index = 0; index < 10; index++)
    await expect(loadProvider(ctx, f.owner.team)).rejects.toThrow(
      /Could not load/
    )
  await expect(loadProvider(ctx, f.owner.team)).rejects.toThrow(/Too many/)
  expect(fetcher).toHaveBeenCalledTimes(10)
})

test("OIDC discovery, code exchange and JWKS all cross the pinned Node transport", async () => {
  const f = await fixture()
  const secret = "oidc-transport-secret-".repeat(4)
  vi.stubEnv("SSO_ENCRYPTION_KEY", secret)
  const issuer = "https://identity.example"
  const connection = {
    organizationId: f.owner.team,
    issuer,
    clientId: "client",
    revision: "revision",
    encryptedSecret: await symmetricEncrypt({
      key: secret,
      data: "client-secret",
    }),
  }
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const jwk = { ...(await exportJWK(publicKey)), kid: "key" }
  const idToken = await new SignJWT({
    email: "owner@example.test",
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: "key" })
    .setSubject("subject")
    .setIssuer(issuer)
    .setAudience("client")
    .setExpirationTime("5m")
    .sign(privateKey)
  const fetcher = vi
    .spyOn(transport, "publicFetch")
    .mockImplementation(async (url) => {
      if (String(url).endsWith("openid-configuration"))
        return Response.json({
          issuer,
          jwks_uri: `${issuer}/keys`,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
        })
      if (String(url).endsWith("/keys")) return Response.json({ keys: [jwk] })
      return Response.json({
        id_token: idToken,
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 300,
        scope: "openid email",
      })
    })
  const runAction = vi.fn(
    (
      _ref: unknown,
      args: {
        url: string
        method: "GET" | "POST"
        headers: Record<string, string>
        body?: string
      }
    ) => f.t.action(internal.publicHttp.request, args)
  )
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(connection),
    runMutation: (
      ref: typeof internal.oidc.reserveDiscovery,
      args: { organizationId: string }
    ) => f.t.mutation(ref, args),
    runAction,
  } as unknown as ActionCtx
  const { provider } = await loadProvider(ctx, f.owner.team)
  expect(provider.discoveryUrl).toBeUndefined()
  expect(provider.tokenUrl).toBe(`${issuer}/token`)
  const tokens = await provider.getToken!({
    code: "code",
    codeVerifier: "verifier",
    redirectURI: "https://app.example/callback",
  })
  // Dropped even when the provider sends one: without it, Better Auth never
  // refreshes through its unpinned fetch.
  expect(tokens).not.toHaveProperty("refreshToken")
  vi.mocked(getOAuthState).mockResolvedValue({
    opensendOrganizationId: f.owner.team,
    opensendRevision: "revision",
  } as never)
  expect(await provider.getUserInfo!(tokens)).toMatchObject({
    id: "revision:subject",
    email: "owner@example.test",
  })
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    `${issuer}/.well-known/openid-configuration`,
    `${issuer}/token`,
    `${issuer}/keys`,
  ])
  expect(runAction).toHaveBeenCalledTimes(3)
  const body = new URLSearchParams(fetcher.mock.calls[1][1]!.body as string)
  expect(body.get("code_verifier")).toBe("verifier")
  expect(body.get("client_secret")).toBe("client-secret")
  expect(body.get("redirect_uri")).toBe("https://app.example/callback")
})

test("OIDC redirects fail closed and cannot silently invoke the library fetch", async () => {
  const f = await fixture()
  vi.spyOn(transport, "publicFetch").mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1" },
    })
  )
  const ctx = {
    runQuery: vi.fn().mockResolvedValue({ issuer: "https://identity.example" }),
    runMutation: (
      ref: typeof internal.oidc.reserveDiscovery,
      args: { organizationId: string }
    ) => f.t.mutation(ref, args),
    runAction: (
      _ref: unknown,
      args: {
        url: string
        method: "GET" | "POST"
        headers: Record<string, string>
      }
    ) => f.t.action(internal.publicHttp.request, args),
  } as unknown as ActionCtx
  await expect(loadProvider(ctx, "team")).rejects.toThrow(
    "Could not load the identity provider"
  )
})
