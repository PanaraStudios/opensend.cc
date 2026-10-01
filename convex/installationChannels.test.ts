import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal, components } from "./_generated/api"
import { authFixture, fixture } from "./testHelpers/ses.fixture"
import { fakeGraph, META_APP } from "./testHelpers/meta.fixture"
import { requireSetupComplete, instanceChannels } from "./access"
import { setupProof } from "./ses/web"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubEnv("BETTER_AUTH_SECRET", "test-callback-secret-".repeat(3))
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
async function fresh(channels: { email: boolean; meta: boolean }) {
  const f = await authFixture()
  const owner = await f.account("owner", true)
  await owner.client.action(api.installationActions.initialize)
  expect(
    (await owner.client.query(api.installation.status)).installation?.setupStep
  ).toBe("channels")
  await owner.client.mutation(api.installation.chooseChannels, channels)
  const graph = fakeGraph()
  graph.spy.mockImplementation(async (url) => {
    const challenge = new URL(url).searchParams.get("challenge")!
    return Response.json({ challenge, proof: await setupProof(challenge) })
  })
  await owner.client.action(api.installationActions.checkEnvironment, {
    callbackOrigin: "https://api.opensend.test",
  })
  const installation = (await owner.client.query(api.installation.status))
    .installation!._id
  return { ...f, owner, installation }
}
async function readyMeta(owner: Awaited<ReturnType<typeof fresh>>["owner"]) {
  await owner.client.action(api.meta.app.save, META_APP)
  const graph = fakeGraph([
    {
      path: `/${META_APP.appId}`,
      respond: () => ({ id: META_APP.appId, name: "CRM" }),
    },
    {
      path: `/${META_APP.appId}/subscriptions`,
      method: "POST",
      respond: () => ({ success: true }),
    },
  ])
  await owner.client.action(api.meta.appActions.verify)
  await owner.client.action(api.meta.appActions.subscribeWebhooks)
  expect(graph.to(`/${META_APP.appId}/subscriptions`, "POST")).toHaveLength(3)
}
async function finish(f: Awaited<ReturnType<typeof fresh>>) {
  await f.owner.client.mutation(api.installation.navigate, { step: "team" })
  const team = await f.owner.client.mutation(api.teams.create, { name: "CRM" })
  await f.owner.client.mutation(api.installation.complete, {
    organizationId: team,
  })
  await f.owner.client.run((ctx) => requireSetupComplete(ctx))
  return team
}

describe("installation channel choices", () => {
  test.each([false, true])(
    "completes email-only or both with today's SES tenant, region and domain (Meta: %s)",
    async (meta) => {
      const f = await fixture()
      await f.t.run((ctx) =>
        ctx.db.patch("installation", f.installation, { completedAt: undefined })
      )
      await f.owner.client.mutation(api.installation.chooseChannels, {
        email: true,
        meta,
      })
      if (meta) {
        await expect(
          f.owner.client.mutation(api.installation.complete, {
            organizationId: f.owner.team,
          })
        ).rejects.toThrow("verify the Meta app")
        await readyMeta(f.owner)
      }
      await f.owner.client.mutation(api.installation.complete, {
        organizationId: f.owner.team,
      })
      expect(
        (await f.owner.client.query(api.installation.status)).channels
      ).toEqual({ email: true, meta })
      await f.owner.client.run((ctx) => requireSetupComplete(ctx))
    }
  )
  test("Meta-only setup verifies and subscribes the app without AWS", async () => {
    const f = await fresh({ email: false, meta: true })
    for (const step of ["aws", "resources", "domain"] as const)
      await expect(
        f.owner.client.mutation(api.installation.navigate, { step })
      ).rejects.toThrow("not needed")
    await expect(
      f.owner.client.mutation(api.installation.navigate, { step: "team" })
    ).rejects.toThrow("verify the Meta app")
    await f.owner.client.action(api.meta.app.save, META_APP)
    expect(
      (await f.owner.client.query(api.installation.status)).channels.meta
    ).toBe(false)
    fakeGraph([
      { path: `/${META_APP.appId}`, respond: () => ({ id: META_APP.appId }) },
    ])
    await f.owner.client.action(api.meta.appActions.verify)
    await expect(
      f.owner.client.mutation(api.installation.navigate, { step: "team" })
    ).rejects.toThrow("subscribe webhooks")
    await readyMeta(f.owner)
    await finish(f)
    const status = await f.owner.client.query(api.installation.status)
    expect(status.channels).toEqual({ email: false, meta: true })
    expect(status.installation?.accountId).toBeUndefined()
  })
  test.each(["email", "meta", "both"] as const)(
    "deferring %s finishes with only the other provider required",
    async (deferred) => {
      const f = await fresh({ email: deferred !== "meta", meta: true })
      if (deferred !== "meta")
        await f.owner.client.mutation(api.installation.deferEmail)
      if (deferred === "email") await readyMeta(f.owner)
      else await f.owner.client.mutation(api.installation.deferMeta)
      await finish(f)
      expect(
        (await f.owner.client.query(api.installation.status)).channels
      ).toEqual({ email: false, meta: deferred === "email" })
    }
  )
  test("choosing none, skipping the callback, and changing choices as a member are refused", async () => {
    const f = await fresh({ email: false, meta: true })
    const outsider = await f.account("outsider")
    await expect(
      outsider.client.mutation(api.installation.chooseChannels, {
        email: true,
        meta: false,
      })
    ).rejects.toThrow("administrator")
    await expect(
      f.owner.client.mutation(api.installation.chooseChannels, {
        email: false,
        meta: false,
      })
    ).rejects.toThrow("at least one")
    await f.t.run((ctx) =>
      ctx.db.patch("installation", f.installation, { environmentCheckedAt: 0 })
    )
    await expect(
      f.owner.client.mutation(api.installation.navigate, { step: "meta" })
    ).rejects.toThrow("public callback")
    const team = await f.owner.client.mutation(
      components.betterAuth.teams.create,
      { sessionId: f.owner.session._id, name: "Bypass" }
    )
    await expect(
      f.owner.client.mutation(api.installation.complete, {
        organizationId: team,
      })
    ).rejects.toThrow("public callback")
  })
  test("Meta can be added later to an email-only installation", async () => {
    const f = await fixture()
    await f.t.run((ctx) =>
      ctx.db.patch("installation", f.installation, {
        channels: { email: true, meta: false },
        metaDeferredAt: Date.now(),
      })
    )
    await readyMeta(f.owner)
    expect(
      (await f.owner.client.query(api.installation.status)).channels
    ).toEqual({ email: true, meta: true })
    expect(
      (await f.owner.client.query(api.installation.status)).installation
        ?.metaDeferredAt
    ).toBeUndefined()
  })
  test("AWS can be added later to a Meta-only installation without losing its app", async () => {
    const f = await fresh({ email: false, meta: true })
    await readyMeta(f.owner)
    await finish(f)
    await f.owner.client.mutation(internal.installation.activateConnection, {
      revision: 0,
      accountId: "123456789012",
      credentialKind: "role",
      defaultRegion: "us-east-1",
      regions: [],
    })
    const status = await f.owner.client.query(api.installation.status)
    expect(status.channels).toEqual({ email: true, meta: true })
    expect(status.installation?.channels).toEqual({ email: true, meta: true })
    expect(status.installation?.completedAt).toBeTruthy()
  })
  test("all channel send endpoints return the same 403 when Meta is unchosen or deferred", async () => {
    const f = await fresh({ email: false, meta: true })
    await f.owner.client.mutation(api.installation.deferMeta)
    const team = await finish(f)
    const key = await f.owner.client.action(api.apiKeys.create, {
      organizationId: team,
      input: { name: "CRM", permission: "full_access" },
    })
    for (const channel of ["whatsapp", "messenger", "instagram"]) {
      const response = await f.t.fetch(`/${channel}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ to: "123456", text: "Hello" }),
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        name: "channel_not_configured",
        message: "Meta messaging is not set up on this instance",
      })
    }
    expect(await f.owner.client.run((ctx) => instanceChannels(ctx))).toEqual({
      email: false,
      meta: false,
    })
    await readyMeta(f.owner)
    await f.t.run((ctx) =>
      ctx.db.patch("installation", f.installation, {
        channels: { email: false, meta: false },
      })
    )
    expect(
      (
        await f.owner.client.query(api.meta.app.publicConfig, {
          organizationId: team,
        })
      ).configured
    ).toBe(false)
    const response = await f.t.fetch("/messenger/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ to: "123456", text: "Hello" }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      name: "channel_not_configured",
    })
  })
})

test("email-only can be deferred without Meta, and both can finish with only Meta deferred", async () => {
  const freshEmail = await fresh({ email: true, meta: false })
  await freshEmail.owner.client.mutation(api.installation.deferEmail)
  await finish(freshEmail)
  expect(
    (await freshEmail.owner.client.query(api.installation.status)).channels
  ).toEqual({ email: false, meta: false })
  const both = await fixture()
  await both.t.run((ctx) =>
    ctx.db.patch("installation", both.installation, { completedAt: undefined })
  )
  await both.owner.client.mutation(api.installation.chooseChannels, {
    email: true,
    meta: true,
  })
  await both.owner.client.mutation(api.installation.navigate, { step: "meta" })
  await both.owner.client.mutation(api.installation.deferMeta)
  await both.owner.client.mutation(api.installation.complete, {
    organizationId: both.owner.team,
  })
  expect(
    (await both.owner.client.query(api.installation.status)).channels
  ).toEqual({ email: true, meta: false })
})

test("changing a Meta-only callback requires subscribing again before it counts as configured", async () => {
  const f = await fresh({ email: false, meta: true })
  await readyMeta(f.owner)
  await f.owner.client.mutation(internal.installation.saveEnvironment, {
    siteUrl: "https://opensend.test",
    callbackOrigin: "https://new-api.opensend.test",
  })
  expect(
    (await f.owner.client.query(api.installation.status)).channels.meta
  ).toBe(false)
  await expect(
    f.owner.client.mutation(api.installation.navigate, { step: "team" })
  ).rejects.toThrow("subscribe webhooks")
  await readyMeta(f.owner)
  await finish(f)
  await f.owner.client.mutation(internal.installation.moveCallbackOrigin, {
    callbackOrigin: "https://moved-api.opensend.test",
  })
  expect(
    (await f.owner.client.query(api.installation.status)).channels.meta
  ).toBe(false)
})
