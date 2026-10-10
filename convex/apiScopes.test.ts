import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { api, components, internal } from "./_generated/api"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import {
  inboundFixture,
  incoming,
  signedWebhook,
  APP_SECRET,
  PHONE_ID,
  SENDER,
  fakeGraph,
} from "./testHelpers/meta.fixture"
import { patchRow } from "./counts"
import { requireCaller } from "./api/caller"
import { API_RESOURCES } from "../lib/api-scopes"
import { tokenHash } from "../lib/oauth/policy"

const jwks = vi.hoisted(() => ({ keys: [] as Record<string, unknown>[] }))
vi.mock("./oauthProvider", () => ({
  oauthServer: () => ({ api: { getJwks: async () => jwks } }),
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("SSO_ENCRYPTION_KEY", "scope-test-secret-".repeat(5))
  vi.stubEnv("SITE_URL", "https://opensend.test")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
type Fixture = Awaited<ReturnType<typeof fixture>>
const key = (
  f: Fixture,
  permission: "custom" | "full_access" | "sending_access",
  scopes?: string[],
  domainId?: string
) =>
  f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "CRM", permission, scopes, domainId },
  })
const call = (
  f: Fixture,
  token: string,
  path: string,
  method = "GET",
  body?: unknown
) => {
  vi.setSystemTime(Date.now() + 1100)
  return f.t.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const email = {
  from: "hi@mail.example.test",
  to: "ada@example.com",
  subject: "Scopes",
  html: "<p>Hello</p>",
}
async function emailFixture() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await storeTestCredentials(f)
  await f.t.run(async (ctx) => {
    await ctx.db.patch("domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-team-cfg",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 10 },
    })
  })
  return f
}

test("contacts read cannot write; write includes read; custom cannot manage keys or another team", async () => {
  const f = await fixture()
  const reader = await key(f, "custom", ["contacts:read"])
  expect((await call(f, reader.token, "/contacts")).status).toBe(200)
  const refused = await call(f, reader.token, "/contacts", "POST", {
    email: "new@example.com",
  })
  expect(refused.status).toBe(403)
  expect(await refused.json()).toMatchObject({
    name: "restricted_api_key",
    message: "This API key needs the `contacts:write` scope.",
  })
  expect((await call(f, reader.token, "/api-keys")).status).toBe(403)
  const writer = await key(f, "custom", [
    "contacts:write",
    "contacts:read",
    "contacts:write",
  ])
  expect(
    (await f.owner.client.query(api.apiKeys.get, { id: writer.id }))?.key.scopes
  ).toEqual(["contacts:write"])
  const created = await call(f, writer.token, "/contacts", "POST", {
    email: "crm@example.com",
  })
  expect(created.status).toBe(201)
  const { id } = await created.json()
  expect((await call(f, writer.token, `/contacts/${id}`)).status).toBe(200)
  const outsider = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: {
      name: "Other CRM",
      permission: "custom",
      scopes: ["contacts:read"],
    },
  })
  expect((await call(f, outsider.token, `/contacts/${id}`)).status).toBe(404)
  expect((await call(f, writer.token, "/contact-properties")).status).toBe(200)
})

test("WhatsApp write sends through fake Graph, reads messages, and refuses contacts", async () => {
  const f = await inboundFixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  expect(
    (
      await f.t.fetch(
        "/meta/webhook",
        await signedWebhook(APP_SECRET, incoming())
      )
    ).status
  ).toBe(200)
  const event = await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  )
  await f.t.mutation(internal.meta.projection.project, { id: event!._id })
  const graph = fakeGraph([
    {
      method: "POST",
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: "wamid.scopes" }] }),
    },
  ])
  const writer = await key(f, "custom", ["whatsapp:write"])
  const sent = await call(f, writer.token, "/whatsapp/messages", "POST", {
    from: PHONE_ID,
    to: SENDER,
    text: { body: "Scoped CRM" },
  })
  expect(sent.status, JSON.stringify(await sent.clone().json())).toBe(200)
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100))
  expect(graph.to(`/${PHONE_ID}/messages`, "POST")).toHaveLength(1)
  expect((await call(f, writer.token, "/whatsapp/messages")).status).toBe(200)
  expect((await call(f, writer.token, "/whatsapp/phone-numbers")).status).toBe(
    200
  )
  expect((await call(f, writer.token, "/whatsapp/conversations")).status).toBe(
    200
  )
  expect((await call(f, writer.token, "/contacts")).status).toBe(403)
})

test("sending access remains email-only and domain restrictions apply to custom email writes", async () => {
  const f = await emailFixture()
  for (const permission of ["sending_access", "custom"] as const) {
    const sender = await key(
      f,
      permission,
      permission === "custom" ? ["emails:write"] : undefined,
      f.domain
    )
    expect((await call(f, sender.token, "/emails", "POST", email)).status).toBe(
      200
    )
    expect(
      (
        await call(f, sender.token, "/emails", "POST", {
          ...email,
          from: "hi@other.example.test",
        })
      ).status
    ).toBe(403)
    expect(
      (await call(f, sender.token, "/whatsapp/messages", "POST", {})).status
    ).toBe(403)
    expect((await call(f, sender.token, "/contacts")).status).toBe(403)
    expect((await call(f, sender.token, "/emails")).status).toBe(
      permission === "custom" ? 200 : 403
    )
  }
  const legacy = await key(f, "sending_access")
  for (const [path, method] of [
    ["/emails/unknown", "PATCH"],
    ["/emails/unknown/cancel", "POST"],
    ["/emails/unknown/share", "POST"],
  ])
    expect((await call(f, legacy.token, path, method, {})).status).toBe(403)
  const reader = await key(f, "custom", ["emails:read"], f.domain)
  expect(
    (await f.owner.client.query(api.apiKeys.get, { id: reader.id }))?.key
      .domainId
  ).toBeUndefined()
})

test("custom domain restrictions affect email writes and clear when email write is removed", async () => {
  const f = await fixture()
  const crm = await key(
    f,
    "custom",
    ["emails:write", "contacts:write", "whatsapp:write"],
    f.domain
  )
  await f.t.run((ctx) => patchRow(ctx, "domains", f.domain, { deleted: true }))
  expect(
    (
      await call(f, crm.token, "/contacts", "POST", {
        email: "domain-scope@example.com",
      })
    ).status
  ).toBe(201)
  const credential = {
    kind: "key" as const,
    tokenHash: await tokenHash(crm.token),
  }
  expect(
    (
      await f.t.mutation(internal.api.state.begin, {
        credential,
        scope: { resource: "whatsapp", access: "write" },
      })
    ).kind
  ).toBe("ok")
  expect((await call(f, crm.token, "/emails", "POST", email)).status).toBe(403)
  await f.owner.client.mutation(api.apiKeys.update, {
    id: crm.id,
    patch: { scopes: ["contacts:read"] },
  })
  expect(
    (await f.owner.client.query(api.apiKeys.get, { id: crm.id }))?.key.domainId
  ).toBeUndefined()
})

test("full access passes every catalog scope and full-only routes", async () => {
  const f = await fixture()
  const full = await key(f, "full_access")
  const credential = {
    kind: "key" as const,
    tokenHash: await tokenHash(full.token),
  }
  for (const resource of API_RESOURCES)
    for (const access of ["read", "write"] as const) {
      vi.setSystemTime(Date.now() + 1100)
      expect(
        (
          await f.t.mutation(internal.api.state.begin, {
            credential,
            scope: { resource: resource.id, access },
          })
        ).kind
      ).toBe("ok")
    }
  expect((await call(f, full.token, "/api-keys")).status).toBe(200)
  expect((await call(f, full.token, "/oauth/grants")).status).toBe(200)
})

test("rejects unknown or missing custom scopes on dashboard/REST writes and preserves scopes on rename", async () => {
  const f = await fixture()
  await expect(key(f, "custom", ["whatsapp:send"])).rejects.toThrow("supported")
  await expect(key(f, "custom")).rejects.toThrow("supported")
  const full = await key(f, "full_access")
  expect(
    (
      await call(f, full.token, "/api-keys", "POST", {
        name: "Unknown",
        permission: "custom",
        scopes: ["keys:write"],
      })
    ).status
  ).toBe(422)
  const made = await call(f, full.token, "/api-keys", "POST", {
    name: "REST CRM",
    permission: "custom",
    scopes: ["contacts:write"],
  })
  expect(made.status).toBe(201)
  const created = await made.json()
  expect(
    (
      await call(f, full.token, `/api-keys/${created.id}`, "PATCH", {
        name: "Renamed CRM",
      })
    ).status
  ).toBe(200)
  const listed = await (await call(f, full.token, "/api-keys")).json()
  expect(listed.data).toContainEqual(
    expect.objectContaining({
      id: created.id,
      permission: "custom",
      scopes: ["contacts:write"],
      name: "Renamed CRM",
    })
  )
  await expect(
    f.owner.client.mutation(api.apiKeys.update, {
      id: created.id,
      patch: { scopes: ["unknown:read"] },
    })
  ).rejects.toThrow("supported")
  const begun = await f.t.mutation(internal.api.state.begin, {
    credential: { kind: "key", tokenHash: await tokenHash(created.token) },
    scope: { resource: "contacts", access: "write" },
  })
  expect(begun.kind).toBe("ok")
  await f.owner.client.mutation(api.apiKeys.update, {
    id: created.id,
    patch: { scopes: ["contacts:read"] },
  })
  if (begun.kind === "ok")
    await expect(
      f.t.run((ctx) => requireCaller(ctx, begun.caller))
    ).rejects.toThrow("invalid")
})

async function oauthToken(f: Fixture, scopes: string, tokenScopes = scopes) {
  await f.t.mutation(components.betterAuth.oauthClients.register, {
    clientId: "crm",
    name: "CRM",
    redirects: ["https://client.example.com/callback"],
    scope: scopes,
    method: "none",
  })
  await f.t.mutation(components.betterAuth.oauth.start, {
    token: "scope-flow",
    browserHash: "scope-flow",
    query: new URLSearchParams({
      client_id: "crm",
      redirect_uri: "https://client.example.com/callback",
      scope: scopes,
      response_type: "code",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
    }).toString(),
  })
  const { grantId } = await f.t.mutation(components.betterAuth.oauth.decide, {
    token: "scope-flow",
    browserHash: "scope-flow",
    sessionId: f.owner.session._id,
    organizationId: f.owner.team,
    accept: true,
  })
  const { publicKey, privateKey } = await generateKeyPair("ES256")
  jwks.keys = [{ ...(await exportJWK(publicKey)), kid: "scopes", alg: "ES256" }]
  return new SignJWT({
    grant_id: grantId,
    sub: f.owner.user._id,
    team_id: f.owner.team,
    azp: "crm",
    scope: [tokenScopes, "offline_access"].filter(Boolean).join(" "),
    iss: "https://opensend.test/oauth",
    aud: "https://opensend.test/oauth/api",
    exp: Math.floor(Date.now() / 1000) + 900,
  })
    .setProtectedHeader({ alg: "ES256", kid: "scopes" })
    .sign(privateKey)
}
test("OAuth emails:send still sends email and refuses contacts", async () => {
  const f = await emailFixture()
  const token = await oauthToken(f, "emails:send")
  expect((await call(f, token, "/emails", "POST", email)).status).toBe(200)
  expect((await call(f, token, "/contacts")).status).toBe(403)
  expect((await call(f, token, "/emails")).status).toBe(403)
})
test("OAuth catalog scopes can be consented and enforce read versus write", async () => {
  const f = await fixture()
  const token = await oauthToken(f, "contacts:read")
  expect((await call(f, token, "/contacts")).status).toBe(200)
  expect(
    (await call(f, token, "/contacts", "POST", { email: "crm@example.com" }))
      .status
  ).toBe(403)
})

test("OAuth offline access alone grants no resource access", async () => {
  const f = await fixture()
  const token = await oauthToken(f, "contacts:read", "")
  expect((await call(f, token, "/emails", "POST", email)).status).toBe(403)
  expect((await call(f, token, "/contacts")).status).toBe(403)
})

test("Custom keys need a scope on create and update, including REST writes", async () => {
  const f = await fixture()
  await expect(key(f, "custom", [])).rejects.toThrow(
    "Choose at least one resource scope"
  )
  const full = await key(f, "full_access")
  const response = await call(f, full.token, "/api-keys", "POST", {
    name: "Empty",
    permission: "custom",
    scopes: [],
  })
  expect(response.status).toBe(422)
  expect((await response.json()).message).toContain(
    "Choose at least one resource scope"
  )
  const custom = await key(f, "custom", ["contacts:read"])
  await expect(
    f.owner.client.mutation(api.apiKeys.update, {
      id: custom.id,
      patch: { scopes: [] },
    })
  ).rejects.toThrow("Choose at least one resource scope")
})
