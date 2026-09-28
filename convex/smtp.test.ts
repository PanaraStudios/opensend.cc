import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fixture } from "./testHelpers/ses.fixture"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SMTP_HOST", "smtp.example.test")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
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
  const member = await f.actor("member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: f.owner.team,
        userId: member.user._id,
        role: "member",
        createdAt: Date.now(),
      },
    },
  })
  const key = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "SMTP", permission: "sending_access", domainId: f.domain },
  })
  const team = { organizationId: f.owner.team }
  const enable = (enabled = true) =>
    member.client.mutation(api.smtp.update, { ...team, enabled })
  const request = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) =>
    f.t.fetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${key.token}`, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { ...f, member, team, key, enable, request }
}
const EMAIL = {
  from: "hi@mail.example.test",
  to: "ada@example.com",
  subject: "Hello",
  text: "Hello",
}

test("settings default disabled, use installation host, and allow member writes", async () => {
  const f = await setup()
  expect(await f.member.client.query(api.smtp.settings, f.team)).toEqual({
    enabled: false,
    port: 465,
    host: "smtp.example.test",
  })
  await f.member.client.mutation(api.smtp.update, {
    ...f.team,
    enabled: true,
    port: 587,
  })
  expect(await f.owner.client.query(api.smtp.settings, f.team)).toEqual({
    enabled: true,
    port: 587,
    host: "smtp.example.test",
  })
  await f.member.client.mutation(api.smtp.update, { ...f.team, port: 465 })
  expect((await f.owner.client.query(api.smtp.settings, f.team)).enabled).toBe(
    true
  )
})

test("settings isolate teams and reject unsupported ports", async () => {
  const f = await setup()
  await expect(
    f.outsider.client.query(api.smtp.settings, f.team)
  ).rejects.toThrow(/permission/i)
  await expect(
    f.outsider.client.mutation(api.smtp.update, { ...f.team, enabled: true })
  ).rejects.toThrow(/permission/i)
  await expect(
    f.member.client.mutation(api.smtp.update, { ...f.team, port: 25 as 465 })
  ).rejects.toThrow()
  expect((await f.owner.client.query(api.smtp.settings, f.team)).enabled).toBe(
    false
  )
})

test("SMTP auth refuses disabled teams and invalid keys while REST remains usable", async () => {
  const f = await setup()
  expect((await f.request("/smtp/auth")).status).toBe(403)
  expect((await f.request("/smtp/emails", EMAIL)).status).toBe(403)
  expect((await f.request("/emails", EMAIL)).status).toBe(200)
  await f.enable()
  expect((await f.request("/smtp/auth")).status).toBe(200)
  expect(
    (
      await f.request("/smtp/auth", undefined, {
        authorization: "Bearer os_bad",
      })
    ).status
  ).toBe(403)
  expect((await f.t.fetch("/smtp/auth", { method: "POST" })).status).toBe(401)
})

test("SMTP queues through the shared sender and links redacted SMTP logs", async () => {
  const f = await setup()
  await f.enable()
  const response = await f.request("/smtp/emails", {
    ...EMAIL,
    attachments: [{ filename: "hello.txt", content: btoa("hello") }],
  })
  expect(response.status).toBe(200)
  const { id } = (await response.json()) as { id: Id<"emails"> }
  const row = await f.t.run((ctx) => ctx.db.get("emails", id))
  expect(row).toMatchObject({
    organizationId: f.owner.team,
    source: "smtp",
    domainId: f.domain,
    status: "queued",
    apiKeyId: f.key.id,
  })
  expect(row?.apiLogId).toBeTruthy()
  const log = await f.t.run(async (ctx) => ({
    row: await ctx.db.get("apiLogs", row!.apiLogId!),
    body: await ctx.db
      .query("apiLogBodies")
      .withIndex("by_logId", (q) => q.eq("logId", row!.apiLogId!))
      .unique(),
  }))
  expect(log.row).toMatchObject({
    source: "smtp",
    path: "/smtp/emails",
    status: 200,
  })
  expect(
    log.body?.requestHeaders.find((h) => h.name === "authorization")?.value
  ).toBe("[redacted]")
  expect(JSON.stringify(log)).not.toContain(f.key.token)
  await expect(f.outsider.client.query(api.emails.get, { id })).rejects.toThrow(
    /permission/i
  )
})

test("SMTP preserves idempotency and refuses replay after disablement", async () => {
  const f = await setup()
  await f.enable()
  const headers = { "idempotency-key": "welcome/1" }
  const first = await (await f.request("/smtp/emails", EMAIL, headers)).json()
  expect(
    await (await f.request("/smtp/emails", EMAIL, headers)).json()
  ).toEqual(first)
  expect(
    (await f.request("/smtp/emails", { ...EMAIL, subject: "Changed" }, headers))
      .status
  ).toBe(409)
  await f.enable(false)
  expect((await f.request("/smtp/emails", EMAIL, headers)).status).toBe(403)
  expect(await f.owner.client.query(api.emails.count, f.team)).toEqual({
    total: 1,
  })
})

test("SMTP shares REST rate limits across keys", async () => {
  const f = await setup()
  await f.enable()
  for (let i = 0; i < 10; i++)
    expect((await f.request("/smtp/auth")).status).toBe(200)
  const limited = await f.request("/emails", EMAIL)
  expect(limited.status).toBe(429)
  expect(limited.headers.get("retry-after")).toBeTruthy()
})

test("SMTP validates sender domains and messages just like REST", async () => {
  const f = await setup()
  await f.enable()
  for (const body of [
    { ...EMAIL, from: "hi@other.test" },
    { ...EMAIL, subject: "" },
    { ...EMAIL, to: "bad" },
    { ...EMAIL, headers: { From: "spoof@other.test" } },
  ]) {
    const smtp = await f.request("/smtp/emails", body)
    const rest = await f.request("/emails", body)
    expect(smtp.status).toBe(rest.status)
    expect(smtp.status).toBeGreaterThanOrEqual(400)
  }
  expect(await f.owner.client.query(api.emails.count, f.team)).toEqual({
    total: 0,
  })
})

test("SMTP supports Bcc-only envelopes without changing REST validation", async () => {
  const f = await setup()
  await f.enable()
  const body = { ...EMAIL, to: [], bcc: ["secret@example.com"] }
  const response = await f.request("/smtp/emails", body)
  expect(response.status).toBe(200)
  const { id } = (await response.json()) as { id: Id<"emails"> }
  expect(await f.t.run((ctx) => ctx.db.get("emails", id))).toMatchObject({
    to: [],
    bcc: ["secret@example.com"],
  })
  expect((await f.request("/emails", body)).status).toBe(422)
})

test("SMTP uses the same suppression check before dispatch", async () => {
  const f = await setup()
  await f.enable()
  await f.t.mutation(internal.suppressions.record, {
    organizationId: f.owner.team,
    email: "ada@example.com",
    reason: "bounced",
  })
  const response = await f.request("/smtp/emails", EMAIL)
  expect(response.status).toBe(200)
  const { id } = (await response.json()) as { id: Id<"emails"> }
  // Claiming a queued email performs the shared suppression and tenant checks.
  await f.t.mutation(internal.emails.claim, { id, generation: 0 })
  expect(await f.t.run((ctx) => ctx.db.get("emails", id))).toMatchObject({
    status: "suppressed",
  })
})

test("queuing rechecks SMTP enablement inside the transaction", async () => {
  const f = await setup()
  await expect(
    f.t.mutation(internal.api.emails.send, {
      source: "smtp",
      caller: {
        ...f.team,
        apiKeyId: f.key.id,
        permission: "sending_access",
        domainId: f.domain,
        name: "SMTP",
      },
      emails: [],
    })
  ).rejects.toThrow(/disabled/)
})

test("another team's key neither inherits enablement nor sends from this team's domain", async () => {
  const f = await setup()
  await f.enable()
  const other = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Other team", permission: "full_access", domainId: null },
  })
  const headers = { authorization: `Bearer ${other.token}` }
  expect((await f.request("/smtp/auth", undefined, headers)).status).toBe(403)
  await f.outsider.client.mutation(api.smtp.update, {
    organizationId: f.outsider.team,
    enabled: true,
  })
  expect((await f.request("/smtp/auth", undefined, headers)).status).toBe(200)
  expect(
    (
      await f.request(
        "/smtp/emails",
        { ...EMAIL, organizationId: f.owner.team },
        headers
      )
    ).status
  ).toBe(403)
  expect(await f.owner.client.query(api.emails.count, f.team)).toEqual({
    total: 0,
  })
})

test("revoking a key rejects submissions after successful AUTH", async () => {
  const f = await setup()
  await f.enable()
  expect((await f.request("/smtp/auth")).status).toBe(200)
  await f.member.client.mutation(api.apiKeys.remove, { id: f.key.id })
  expect((await f.request("/smtp/emails", EMAIL)).status).toBe(403)
  expect(await f.owner.client.query(api.emails.count, f.team)).toEqual({
    total: 0,
  })
})
