import { STSClient } from "@aws-sdk/client-sts"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal, components } from "./_generated/api"
import { requireSetupComplete, requireEmailConfigured } from "./access"
import { authFixture, fixture } from "./testHelpers/ses.fixture"
import { fakeGraph, META_APP } from "./testHelpers/meta.fixture"
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

async function fresh() {
  const f = await authFixture()
  const owner = await f.account("owner", true)
  await owner.client.action(api.installationActions.initialize)
  const installation = (await owner.client.query(api.installation.status))
    .installation!._id
  return { ...f, owner, installation }
}

async function deferred() {
  const f = await fresh()
  await f.owner.client.mutation(api.installation.deferEmail)
  const graph = fakeGraph()
  graph.spy.mockImplementation(async (url) => {
    const challenge = new URL(url).searchParams.get("challenge")!
    return Response.json({ challenge, proof: await setupProof(challenge) })
  })
  await f.owner.client.action(api.installationActions.checkEnvironment, {
    callbackOrigin: "https://api.opensend.test",
  })
  const team = await f.owner.client.mutation(api.teams.create, { name: "CRM" })
  await f.owner.client.mutation(api.installation.complete, {
    organizationId: team,
  })
  return { ...f, team }
}

const emailError = {
  statusCode: 403,
  name: "email_not_configured",
  message: "Email sending is not set up on this instance",
}

describe("email-optional installation", () => {
  test("defers email, proves the callback, creates a team, and opens team management", async () => {
    const f = await deferred()
    const status = await f.owner.client.query(api.installation.status)
    expect(status.emailConfigured).toBe(false)
    expect(status.installation).toMatchObject({
      setupStep: "team",
      emailDeferredAt: expect.any(Number),
      environmentCheckedAt: expect.any(Number),
      completedAt: expect.any(Number),
    })
    expect(status.regions).toEqual([])
    await f.owner.client.run((ctx) => requireSetupComplete(ctx))
    await f.owner.client.mutation(api.teams.create, { name: "Second team" })
    expect(
      await f.owner.client.query(api.tenants.list, { organizationId: f.team })
    ).toEqual([])
  })

  test("deferral is admin-only and the callback cannot be bypassed", async () => {
    const f = await fresh()
    const outsider = await f.account("outsider")
    await expect(
      outsider.client.mutation(api.installation.deferEmail)
    ).rejects.toThrow("administrator")
    await expect(
      f.owner.client.mutation(api.installation.navigate, { step: "callback" })
    ).rejects.toThrow("Connect AWS")
    await f.owner.client.mutation(api.installation.deferEmail)
    await expect(
      f.owner.client.mutation(api.installation.navigate, { step: "team" })
    ).rejects.toThrow("public callback")
    await expect(
      f.owner.client.mutation(api.teams.create, { name: "Bypass" })
    ).rejects.toThrow("team step")
    const team = await f.owner.client.mutation(
      components.betterAuth.teams.create,
      { sessionId: f.owner.session._id, name: "Bypass" }
    )
    await expect(
      f.owner.client.mutation(api.installation.complete, {
        organizationId: team,
      })
    ).rejects.toThrow("public callback")
    for (const step of ["resources", "domain"] as const)
      await expect(
        f.owner.client.mutation(api.installation.navigate, { step })
      ).rejects.toThrow("Connect AWS")
  })

  test("a team connects a manual Meta channel without an AWS account", async () => {
    const f = await deferred()
    await f.owner.client.action(api.meta.app.save, META_APP)
    const graph = fakeGraph([
      {
        path: "/debug_token",
        respond: () => ({
          data: {
            app_id: META_APP.appId,
            is_valid: true,
            scopes: [
              "whatsapp_business_management",
              "whatsapp_business_messaging",
              "business_management",
            ],
          },
        }),
      },
      { path: "/5550001", respond: () => ({ id: "5550001", name: "CRM" }) },
      {
        path: "/5550001/phone_numbers",
        respond: () => ({
          data: [
            {
              id: "1060001",
              display_phone_number: "+15550100001",
              verified_name: "CRM",
              quality_rating: "GREEN",
              status: "CONNECTED",
              platform_type: "CLOUD_API",
            },
          ],
        }),
      },
      { path: "/5550001/subscribed_apps", respond: () => ({ success: true }) },
    ])
    await f.owner.client.action(api.meta.connectActions.connectManual, {
      organizationId: f.team,
      token: "EAASystemUserToken0123456789abcd",
      wabaId: "5550001",
    })
    const accounts = await f.owner.client.query(api.meta.connect.listAccounts, {
      organizationId: f.team,
      paginationOpts: { cursor: null, numItems: 10 },
    })
    expect(accounts.page).toHaveLength(1)
    expect(accounts.page[0]).toMatchObject({
      channel: "whatsapp",
      externalId: "1060001",
      status: "active",
    })
    expect(graph.to("/5550001/subscribed_apps", "POST")).toHaveLength(1)
  })

  test("email guard and REST sends return the clear 403; domain and publish paths use it too", async () => {
    const f = await deferred()
    await expect(
      f.owner.client.run((ctx) => requireEmailConfigured(ctx))
    ).rejects.toMatchObject({ data: emailError })
    const key = await f.owner.client.action(api.apiKeys.create, {
      organizationId: f.team,
      input: { name: "CRM", permission: "full_access" },
    })
    const response = await f.t.fetch("/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: "CRM <hi@example.test>",
        to: "user@example.test",
        subject: "Hello",
        text: "Hello",
      }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      name: emailError.name,
      message: emailError.message,
    })
    await expect(
      f.owner.client.mutation(api.domains.create, {
        organizationId: f.team,
        name: "mail.example.test",
        region: "us-east-1",
        customReturnPath: "send",
      })
    ).rejects.toMatchObject({ data: emailError })
    const template = await f.owner.client.mutation(api.templates.create, {
      organizationId: f.team,
      name: "Welcome",
      subject: "Hello",
      html: "<p>Hello</p>",
    })
    await expect(
      f.owner.client.mutation(api.templates.publish, { id: template })
    ).rejects.toMatchObject({ data: emailError })
    await expect(
      f.owner.client.mutation(api.testEmails.send, {
        organizationId: f.team,
        from: "hi@example.test",
        to: "user@example.test",
        subject: "Hello",
        html: "<p>Hello</p>",
      })
    ).rejects.toMatchObject({ data: emailError })
    const broadcast = await f.owner.client.mutation(api.broadcasts.create, {
      organizationId: f.team,
      name: "News",
      from: "hi@example.test",
      subject: "Hello",
      html: "<p>Hello</p>",
    })
    await expect(
      f.owner.client.mutation(api.broadcasts.send, { id: broadcast })
    ).rejects.toMatchObject({ data: emailError })
    const batch = await f.t.fetch("/emails/batch", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.token}`,
        "content-type": "application/json",
        "x-batch-validation": "permissive",
      },
      body: JSON.stringify([
        {
          from: "hi@example.test",
          to: "user@example.test",
          subject: "Hello",
          text: "Hello",
        },
      ]),
    })
    expect(batch.status).toBe(403)
    expect(await batch.json()).toMatchObject({ name: emailError.name })
    // Local Meta templates continue to publish without SES.
    const messenger = await f.owner.client.mutation(api.templates.create, {
      organizationId: f.team,
      channel: "messenger",
      name: "Message",
      subject: "",
      text: "Hello",
    })
    await f.owner.client.mutation(api.templates.publish, { id: messenger })
  })

  test("connecting AWS after setup clears deferral; existing teams get tenants when adding domains", async () => {
    const f = await deferred()
    vi.spyOn(STSClient.prototype, "send").mockResolvedValue({
      Account: "123456789012",
      Arn: "arn:aws:iam::123456789012:user/opensend",
    } as never)
    vi.spyOn(SESv2Client.prototype, "send").mockImplementation(
      async (command) => {
        if (command.constructor.name === "GetAccountCommand")
          return {
            ProductionAccessEnabled: true,
            SendingEnabled: true,
            SendQuota: {
              Max24HourSend: 200,
              MaxSendRate: 1,
              SentLast24Hours: 0,
            },
          } as never
        throw Object.assign(new Error("Policy not upgraded yet"), {
          name: "AccessDeniedException",
        })
      }
    )
    await f.owner.client.action(api.installationActions.connect, {
      credentials: {
        kind: "keys",
        accessKeyId: "AKIAFIXTURE1234567890",
        secretAccessKey: "test-only-secret",
      },
      expectedAccountId: "123456789012",
      defaultRegion: "us-east-1",
      regions: [],
    })
    const status = await f.owner.client.query(api.installation.status)
    expect(status.emailConfigured).toBe(true)
    expect(status.installation?.emailDeferredAt).toBeUndefined()
    expect(status.installation?.completedAt).toBeTruthy()
    await expect(
      f.owner.client.run((ctx) => requireEmailConfigured(ctx))
    ).resolves.toBeTruthy()
    await expect(
      f.owner.client.mutation(api.installation.deferEmail)
    ).rejects.toThrow("AWS step")
    await f.owner.client.mutation(api.installation.provisionRegion, {
      region: "us-east-1",
    })
    const region = status.regions[0]
    await f.t.mutation(internal.ses.state.patchRegion, {
      id: region._id,
      changes: { phase: "ready" },
    })
    const domain = await f.owner.client.mutation(api.domains.create, {
      organizationId: f.team,
      name: "mail.example.test",
      region: "us-east-1",
      customReturnPath: "send",
    })
    await f.t.mutation(internal.tenants.prepareDomain, { domainId: domain })
    const tenants = await f.owner.client.query(api.tenants.list, {
      organizationId: f.team,
    })
    expect(tenants).toHaveLength(1)
    expect(tenants[0]).toMatchObject({
      organizationId: f.team,
      operation: "provision",
      phase: "running",
    })
    await f.t.mutation(internal.tenants.prepareDomain, { domainId: domain })
    expect(
      await f.owner.client.query(api.tenants.list, { organizationId: f.team })
    ).toHaveLength(1)
  })

  test("a deferred install can move its checked public callback without starting AWS work", async () => {
    const f = await deferred()
    await f.owner.client.action(api.installationActions.changeCallbackOrigin, {
      callbackOrigin: "https://new-api.opensend.test",
    })
    const status = await f.owner.client.query(api.installation.status)
    expect(status.installation?.callbackOrigin).toBe(
      "https://new-api.opensend.test"
    )
    expect(status.emailConfigured).toBe(false)
    expect(status.regions).toEqual([])
  })

  test("AWS-first completion still requires a tenant, region and domain", async () => {
    const f = await fixture()
    await f.t.run((ctx) =>
      ctx.db.patch("installation", f.installation, { completedAt: undefined })
    )
    await f.owner.client.mutation(api.installation.complete, {
      organizationId: f.owner.team,
    })
    await f.t.run(async (ctx) => {
      await ctx.db.patch("installation", f.installation, {
        completedAt: undefined,
      })
      await ctx.db.patch("sesTenants", f.tenant, {
        phase: "pending",
        arn: undefined,
      })
    })
    await expect(
      f.owner.client.mutation(api.installation.complete, {
        organizationId: f.owner.team,
      })
    ).rejects.toThrow("Provision the team tenant")
  })
})
