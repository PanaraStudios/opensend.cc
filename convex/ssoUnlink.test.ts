import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { components, internal } from "./_generated/api"
import { createAuth } from "./auth"
import { fixture } from "./testHelpers/ses.fixture"

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.opensend.test")
  vi.stubEnv("BETTER_AUTH_SECRET", "sso-unlink-test-secret-at-least-thirty-two")
  vi.spyOn(console, "log").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

type Fixture = Awaited<ReturnType<typeof fixture>>
/** Links a team IdP identity to the outsider, as a completed SSO sign-in does. */
const linkSso = (f: Fixture) =>
  f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "account",
      data: {
        accountId: "revision:subject",
        providerId: "team-idp",
        userId: f.outsider.user._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  })
const providers = async (f: Fixture) =>
  (
    await f.t.query(components.betterAuth.adapter.findMany, {
      model: "account",
      where: [{ field: "userId", value: f.outsider.user._id }],
      paginationOpts: { cursor: null, numItems: 10 },
    })
  ).page
    .map((a: { providerId: string }) => a.providerId)
    .sort()

/** Resets the outsider's password through Better Auth's reset endpoint. */
async function reset(f: Fixture, newPassword: string) {
  const link = await f.t.action(internal.accountRecovery.resetPassword, {
    email: f.outsider.user.email,
  })
  const token = new URL(link).pathname.split("/").pop()!
  await f.t.action((ctx) =>
    createAuth(ctx).api.resetPassword({ body: { token, newPassword } })
  )
}

test("a password reset removes SSO links and keeps the password", async () => {
  const f = await fixture()
  await reset(f, "first-new-password-123")
  await linkSso(f)
  expect(await providers(f)).toEqual(["credential", "team-idp"])
  await reset(f, "second-new-password-123")
  expect(await providers(f)).toEqual(["credential"])
})

test("a password change removes SSO links", async () => {
  const f = await fixture()
  const password = "known-password-123"
  await reset(f, password)
  await linkSso(f)
  await f.t.action(async (ctx) => {
    const auth = createAuth(ctx)
    const { headers } = await auth.api.signInEmail({
      body: { email: f.outsider.user.email, password },
      returnHeaders: true,
    })
    const cookie = headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ")
    await auth.api.changePassword({
      body: { currentPassword: password, newPassword: "changed-password-123" },
      headers: new Headers({ cookie }),
    })
  })
  expect(await providers(f)).toEqual(["credential"])
})
