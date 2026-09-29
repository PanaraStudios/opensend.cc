import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { counters, countRow, deleteRow, insertRow } from "./counts"
import { recordMetric } from "./metricRows"
import { fixture } from "./testHelpers/ses.fixture"
import { readUsage } from "./usage"
import { TEAM_TABLES } from "./teamCleanup"

const NOW = Date.parse("2026-03-31T12:00:00Z")
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.stubEnv("BETTER_AUTH_SECRET", "usage-test-secret")
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected network request"))
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type Fixture = Awaited<ReturnType<typeof fixture>>
async function sent(
  f: Fixture,
  at: number,
  source: Doc<"emails">["source"] = "api",
  organizationId = f.owner.team
) {
  return f.t.run(async (ctx) => {
    const id = await insertRow(ctx, "emails", {
      organizationId,
      domainId: f.domain,
      source,
      from: "hello@example.test",
      to: ["recipient@example.test"],
      subject: "Usage",
      status: "delivered",
      generation: 1,
      attempts: 1,
      search: "usage",
    })
    const email = (await ctx.db.get("emails", id))!
    await recordMetric(ctx, email, "sent", at)
    await recordMetric(ctx, email, "sent", at + 1000)
    await recordMetric(ctx, email, "delivered", at + 2000)
    return id
  })
}
async function received(f: Fixture, at: number, organizationId = f.owner.team) {
  return f.t.run(async (ctx) => {
    const rawId = await ctx.storage.store(new Blob(["usage fixture"]))
    const inboundId = await ctx.db.insert("inboundMessages", {
      organizationId,
      domainId: f.domain,
      region: "us-east-1",
      topicArn: "test",
      messageId: String(at),
      sesMessageId: String(at),
      bucket: "test",
      objectKey: "test",
      notification: "{}",
    })
    return insertRow(ctx, "receivedEmails", {
      organizationId,
      domainId: f.domain,
      inboundId,
      rawId,
      receivedAt: at,
      expiresAt: at + 30 * 86400000,
      from: "sender@example.test",
      sender: "sender@example.test",
      to: ["to@example.test"],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "Usage",
      messageId: String(at),
      receivedFor: ["to@example.test"],
      authentication: {},
    })
  })
}
const get = (f: Fixture) =>
  f.owner.client.query(api.usage.get, { organizationId: f.owner.team })

test("counts sent/received on UTC day and month boundaries, excluding system mail and other teams", async () => {
  const f = await fixture()
  for (const at of [
    "2026-02-28T23:59:59.999Z",
    "2026-03-01T00:00:00Z",
    "2026-03-30T23:59:59.999Z",
    "2026-03-31T00:00:00Z",
  ])
    await sent(f, Date.parse(at))
  await sent(f, NOW, "system")
  await sent(f, NOW, "api", f.outsider.team)
  await received(f, Date.parse("2026-02-28T23:59:59.999Z"))
  await received(f, Date.parse("2026-03-01T00:00:00Z"))
  await received(f, Date.parse("2026-03-31T00:00:00Z"))
  await received(f, NOW, f.outsider.team)
  const { usage } = await get(f)
  expect(usage.emails).toEqual({
    daily: {
      sent: 1,
      received: 1,
      used: 2,
      limit: 200,
      resets_at: "2026-04-01T00:00:00.000Z",
    },
    monthly: {
      sent: 3,
      received: 2,
      used: 5,
      limit: null,
      resets_at: "2026-04-01T00:00:00.000Z",
    },
  })
  // Advance through midnight without using an expired auth session.
  vi.setSystemTime(Date.parse("2026-04-01T00:00:00Z"))
  const next = await f.t.run((ctx) => readUsage(ctx, f.owner.team))
  expect(next.usage.emails.daily.used).toBe(0)
  expect(next.usage.emails.monthly.used).toBe(0)
  expect(next.usage.emails.monthly.resets_at).toBe("2026-05-01T00:00:00.000Z")
})

test("uses send time instead of creation time and moves corrected milestones exactly once", async () => {
  const f = await fixture()
  const id = await sent(f, Date.parse("2026-03-30T23:59:59Z"))
  expect((await get(f)).usage.emails.daily.sent).toBe(0)
  await f.t.run(async (ctx) => {
    const email = (await ctx.db.get("emails", id))!
    await recordMetric(ctx, email, "sent", Date.parse("2026-02-28T23:59:59Z"))
  })
  expect((await get(f)).usage.emails.monthly.sent).toBe(0)
})

test("reads the default region's stored shared quota and reports a readable missing-quota reason", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    await ctx.db.insert("sesRegions", {
      region: "eu-west-1",
      quota: { ...f.region.quota, daily: 50000 },
      checkedAt: NOW,
      phase: "ready",
      callbackConfirmed: true,
    })
    await ctx.db.patch("installation", f.installation, {
      defaultRegion: "eu-west-1",
    })
  })
  expect((await get(f)).usage.emails.daily.limit).toBe(50000)
  await f.t.run((ctx) =>
    ctx.db.patch("installation", f.installation, { defaultRegion: "sa-east-1" })
  )
  expect(await get(f)).toMatchObject({
    usage: { emails: { daily: { limit: null } } },
    quota: {
      reason: expect.stringContaining("No Amazon SES quota"),
      region: "sa-east-1",
    },
  })
  await f.t.run((ctx) =>
    ctx.db.patch("installation", f.installation, { defaultRegion: undefined })
  )
  expect((await get(f)).quota.reason).toContain("No default Amazon SES region")
})

test("preserves zero quotas instead of presenting them as unlimited", async () => {
  const f = await fixture()
  await f.t.run((ctx) =>
    ctx.db.patch("sesRegions", f.region._id, {
      quota: { ...f.region.quota, daily: 0 },
    })
  )
  expect(await get(f)).toMatchObject({
    usage: { emails: { daily: { limit: 0 } } },
    quota: { reason: null },
  })
})

test("counts current contacts, segments and sent broadcasts with honest plan limits", async () => {
  const f = await fixture()
  await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: f.owner.team,
    segmentIds: [],
    contacts: [
      { email: "a@example.test" },
      { email: "b@example.test", unsubscribed: true },
    ],
  })
  await f.owner.client.mutation(api.segments.create, {
    organizationId: f.owner.team,
    name: "One",
  })
  await f.t.run(async (ctx) => {
    for (const status of ["sent", "draft", "scheduled", "failed"] as const)
      await insertRow(ctx, "broadcasts", {
        organizationId: f.owner.team,
        name: status,
        subject: "Usage",
        preview: "",
        segmentId: null,
        topicId: null,
        status,
        updatedAt: NOW,
        generation: 1,
        audienceDone: true,
      })
  })
  expect((await get(f)).usage).toMatchObject({
    contacts: { used: 2, limit: null },
    segments: { used: 1, limit: 500 },
    broadcasts: { used: 1, limit: null },
    ai_credits: { used: 0, limit: 0, next_increase_at: null },
    rate_limit: { limit: 10, duration: "1000ms" },
    domains: { used: 1, limit: null },
  })
})

test("usage survives content retention and idempotent backfill, and team cleanup clears retained counts", async () => {
  const f = await fixture()
  const emailId = await sent(f, Date.parse("2026-03-01T00:00:00Z"))
  const receivedId = await received(f, Date.parse("2026-03-01T00:00:00Z"))
  await f.t.run(async (ctx) => {
    const metric = await ctx.db
      .query("emailMetrics")
      .withIndex("by_emailId_and_type", (q) =>
        q.eq("emailId", emailId).eq("type", "sent")
      )
      .unique()
    const inbound = (await ctx.db.get("receivedEmails", receivedId))!
    await countRow(ctx, "emailMetrics", metric!)
    await countRow(ctx, "receivedEmails", inbound)
    await deleteRow(ctx, "emailMetrics", metric!._id)
    await deleteRow(ctx, "receivedEmails", receivedId)
  })
  expect((await get(f)).usage.emails.monthly.used).toBe(2)
  await f.t.run((ctx) =>
    ctx.db.insert("teamRetirements", { teamId: f.owner.team })
  )
  await f.t.mutation(internal.teamCleanup.purge, {
    organizationId: f.owner.team,
    table: TEAM_TABLES.length,
  })
  expect(
    await f.t.run((ctx) => counters.usageSent.total(ctx, f.owner.team))
  ).toBe(0)
  expect(
    await f.t.run((ctx) => counters.usageReceived.total(ctx, f.owner.team))
  ).toBe(0)
})

test("ordinary members can read usage, while outsiders and unauthenticated clients cannot", async () => {
  const f = await fixture()
  const member = await f.actor("usage-member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: f.owner.team,
        userId: member.user._id,
        role: "member",
        createdAt: NOW,
      },
    },
  })
  expect(
    (await member.client.query(api.usage.get, { organizationId: f.owner.team }))
      .usage.object
  ).toBe("usage")
  await expect(
    f.outsider.client.query(api.usage.get, { organizationId: f.owner.team })
  ).rejects.toThrow(/permission/i)
  await expect(
    f.t.query(api.usage.get, { organizationId: f.owner.team })
  ).rejects.toThrow()
})

test("automation usage counts starts across automations, survives retention, and ignores a client-supplied day", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    const contactId = await insertRow(ctx, "contacts", {
      organizationId: f.owner.team,
      email: "run@example.test",
      unsubscribed: false,
      firstName: "",
      lastName: "",
      properties: {},
      search: "run example test",
      updatedAt: NOW,
    })
    for (const organizationId of [
      f.owner.team,
      f.owner.team,
      f.outsider.team,
    ]) {
      const automationId = await insertRow(ctx, "automations", {
        organizationId,
        name: "Usage",
        graph: "{}",
        status: "enabled",
        trigger: "contact.created",
        deleted: false,
        updatedAt: NOW,
      })
      const id = await insertRow(ctx, "automationRuns", {
        organizationId,
        automationId,
        contactId,
        contactEmail: "run@example.test",
        payload: {},
        graph: "{}",
        trigger: "contact.created",
        status: "completed",
        sent: 0,
      })
      await deleteRow(ctx, "automationRuns", id)
    }
  })
  const result = await f.owner.client.query(api.usage.get, {
    organizationId: f.owner.team,
    day: 0,
  })
  expect(result.usage.automation_runs).toEqual({
    used: 2,
    limit: null,
    resets_at: "2026-04-01T00:00:00.000Z",
  })
  await f.t.run((ctx) =>
    ctx.db.insert("teamRetirements", { teamId: f.owner.team })
  )
  await f.t.mutation(internal.teamCleanup.purge, {
    organizationId: f.owner.team,
    table: TEAM_TABLES.length,
  })
  expect(
    await f.t.run((ctx) =>
      counters.usageAutomationRuns.total(ctx, f.owner.team)
    )
  ).toBe(0)
})

test("REST requires full access, scopes usage to the key's team, and matches the dashboard", async () => {
  const f = await fixture()
  await sent(f, NOW)
  const key = async (
    permission: "full_access" | "sending_access",
    outsider = false
  ) => {
    const actor = outsider ? f.outsider : f.owner
    return actor.client.action(api.apiKeys.create, {
      organizationId: actor.team,
      input: { name: "Usage", permission, domainId: null },
    })
  }
  const full = await key("full_access")
  const other = await key("full_access", true)
  const sending = await key("sending_access")
  const call = (token: string) =>
    f.t.fetch("/usage", { headers: { Authorization: `Bearer ${token}` } })
  const result = await call(full.token)
  expect(result.status).toBe(200)
  expect(await result.json()).toEqual((await get(f)).usage)
  expect(
    (
      (await (await call(other.token)).json()) as {
        emails: { daily: { used: number } }
      }
    ).emails.daily.used
  ).toBe(0)
  const refused = await call(sending.token)
  expect(refused.status).toBe(401)
  expect(await refused.json()).toMatchObject({ name: "restricted_api_key" })
  expect((await f.t.fetch("/usage")).status).toBe(401)
  await f.t.run((ctx) => deleteRow(ctx, "apiKeys", full.id as Id<"apiKeys">))
  expect((await call(full.token)).status).toBe(403)
})
