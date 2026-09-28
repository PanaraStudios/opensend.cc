import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { convexTest } from "convex-test"
import { api, components, internal } from "./_generated/api"
import { api as authApi } from "./betterAuth/_generated/api"
import authSchema from "./betterAuth/schema"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow, patchRow } from "./counts"
import type { Id } from "./_generated/dataModel"

const DAY = 86_400_000
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function continuations(
  f: Awaited<ReturnType<typeof fixture>>,
  name: string
) {
  return f.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (row) => row.name.includes(name)
    )
  )
}

test("raw SES events retain fresh rows and continue full batches", async () => {
  const f = await fixture()
  const now = Date.now()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 101; i++)
      await ctx.db.insert("sesEvents", {
        topicArn: "topic",
        messageId: String(i),
        message: "{}",
      })
  })
  vi.setSystemTime(now + 31 * DAY)
  await f.t.run(async (ctx) => {
    await ctx.db.insert("sesEvents", {
      topicArn: "topic",
      messageId: "fresh",
      message: "{}",
    })
  })
  await f.t.mutation(internal.retention.ses, {})
  expect(
    await f.t.run((ctx) => ctx.db.query("sesEvents").collect())
  ).toHaveLength(2)
  expect(await continuations(f, "retention:ses")).toHaveLength(1)
  await f.t.mutation(internal.retention.ses, {})
  expect(
    await f.t.run((ctx) => ctx.db.query("sesEvents").collect())
  ).toMatchObject([{ messageId: "fresh" }])
})

test("inbound pruning drops processed notifications, preserves pending mail and continues scans", async () => {
  const f = await fixture()
  const ids = await f.t.run(async (ctx) => {
    const ids: Id<"inboundMessages">[] = []
    for (let i = 0; i < 102; i++)
      ids.push(
        await ctx.db.insert("inboundMessages", {
          organizationId: f.owner.team,
          domainId: f.domain,
          region: "us-east-1",
          topicArn: "t",
          messageId: String(i),
          sesMessageId: String(i),
          bucket: "b",
          objectKey: String(i),
          notification: "secret",
          ...(i < 100
            ? { parsedAt: Date.now() - 8 * DAY }
            : i === 100
              ? { parsedAt: Date.now() }
              : {}),
        })
      )
    return ids
  })
  await f.t.mutation(internal.retention.inbound, {})
  const jobs = await continuations(f, "retention:inbound")
  expect(jobs).toHaveLength(1)
  await f.t.mutation(
    internal.retention.inbound,
    jobs[0].args[0] as { cursor: string }
  )
  expect(
    await f.t.run((ctx) => ctx.db.get("inboundMessages", ids[0]))
  ).toBeNull()
  expect(
    await f.t.run((ctx) => ctx.db.get("inboundMessages", ids[100]))
  ).toMatchObject({ notification: "" })
  expect(
    await f.t.run((ctx) => ctx.db.get("inboundMessages", ids[101]))
  ).toMatchObject({ notification: "secret" })
})

test("broadcast pruning snapshots totals before deleting children and preserves fresh histories", async () => {
  const now = Date.now()
  vi.setSystemTime(now - 32 * DAY)
  const f = await fixture()
  const id = await f.owner.client.mutation(api.broadcasts.create, {
    organizationId: f.owner.team,
    name: "History",
    subject: "S",
    html: "<p>H</p>",
  })
  vi.setSystemTime(now)
  const session = await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "session",
      data: {
        userId: f.owner.user._id,
        token: "fresh",
        createdAt: now,
        updatedAt: now,
        expiresAt: now + DAY,
      },
    },
  })
  f.owner.client = f.t.withIdentity({
    subject: f.owner.user._id,
    sessionId: session._id,
  })
  const contact = await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: f.owner.team,
    contacts: [{ email: "c@example.com" }],
    segmentIds: [],
  })
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "broadcasts", id, {
      status: "sent",
      settledAt: Date.now() - 31 * DAY,
    })
    const emailId = await insertRow(ctx, "emails", {
      organizationId: f.owner.team,
      domainId: f.domain,
      from: "hi@mail.example.test",
      to: ["c@example.com"],
      subject: "S",
      status: "sent",
      source: "api",
      generation: 0,
      attempts: 1,
      search: "s",
    })
    for (let i = 0; i < 101; i++) {
      await insertRow(ctx, "broadcastRecipients", {
        organizationId: f.owner.team,
        broadcastId: id,
        contactId: contact.createdIds[0],
        email: `${i}@example.com`,
        emailId,
        settled: true,
        failed: false,
      })
      await insertRow(ctx, "broadcastEvents", {
        organizationId: f.owner.team,
        broadcastId: id,
        emailId,
        email: `${i}@example.com`,
        type: "delivered",
      })
    }
  })
  const args = { organizationId: f.owner.team, id }
  const before = await f.owner.client.query(api.broadcastMetrics.stats, args)
  await f.t.mutation(internal.retention.broadcasts, {})
  expect(await continuations(f, "retention:broadcasts")).toHaveLength(1)
  expect(await f.owner.client.query(api.broadcastMetrics.stats, args)).toEqual(
    before
  )
  await f.t.mutation(internal.retention.broadcasts, {})
  expect(
    await f.t.run((ctx) => ctx.db.query("broadcastRecipients").collect())
  ).toHaveLength(0)
  expect(
    await f.t.run((ctx) => ctx.db.query("broadcastEvents").collect())
  ).toHaveLength(0)
  expect(await f.owner.client.query(api.broadcastMetrics.stats, args)).toEqual(
    before
  )
  await f.t.run((ctx) =>
    patchRow(ctx, "broadcasts", id, {
      retainedStats: undefined,
      settledAt: Date.now(),
    })
  )
  await f.t.mutation(internal.retention.broadcasts, {})
  expect(
    (await f.t.run((ctx) => ctx.db.get("broadcasts", id)))?.retainedStats
  ).toBeUndefined()
})

test("automation retention removes finished steps/runs in batches but retains active and fresh runs", async () => {
  const now = Date.now()
  vi.setSystemTime(now - 32 * DAY)
  const f = await fixture()
  const ids = await f.t.run(async (ctx) => {
    const automationId = await insertRow(ctx, "automations", {
      organizationId: f.owner.team,
      name: "A",
      status: "disabled",
      trigger: "test",
      graph: "{}",
      deleted: false,
      updatedAt: Date.now(),
    })
    const contactId = await insertRow(ctx, "contacts", {
      organizationId: f.owner.team,
      email: "c@example.com",
      firstName: "",
      lastName: "",
      unsubscribed: false,
      properties: {},
      search: "c",
      updatedAt: Date.now(),
    })
    const ids = []
    for (const status of ["completed", "running", "failed"] as const)
      ids.push(
        await insertRow(ctx, "automationRuns", {
          organizationId: f.owner.team,
          automationId,
          contactId,
          contactEmail: "c@example.com",
          payload: {},
          graph: "{}",
          trigger: "test",
          status,
          sent: 0,
          completedAt: status === "failed" ? now : now - 31 * DAY,
        })
      )
    for (let i = 0; i < 101; i++)
      await insertRow(ctx, "automationRunSteps", {
        organizationId: f.owner.team,
        automationId,
        runId: ids[0],
        key: String(i),
        type: "trigger",
        status: "completed",
        startedAt: Date.now() - 31 * DAY,
        runStartedAt: Date.now() - 32 * DAY,
      })
    return ids
  })
  vi.setSystemTime(now)
  await f.t.mutation(internal.retention.automations, {})
  expect(await continuations(f, "retention:automations")).toHaveLength(1)
  await f.t.mutation(internal.retention.automations, {})
  expect(
    await f.t.run((ctx) => ctx.db.get("automationRuns", ids[0]))
  ).toBeNull()
  expect(
    await f.t.run((ctx) => ctx.db.query("automationRunSteps").collect())
  ).toHaveLength(0)
  const jobs = await continuations(f, "retention:automations")
  await f.t.mutation(
    internal.retention.automations,
    jobs[jobs.length - 1].args[0] as { cursor: string }
  )
  expect(
    await f.t.run((ctx) => ctx.db.get("automationRuns", ids[1]))
  ).not.toBeNull()
  expect(
    await f.t.run((ctx) => ctx.db.get("automationRuns", ids[2]))
  ).not.toBeNull()
})

const authModules = import.meta.glob("./betterAuth/**/*.ts")
test.each([
  "oauthFlow",
  "oauthRate",
  "oauthUse",
  "verification",
  "ssoProof",
] as const)(
  "%s retention preserves live security state and continues a full batch",
  async (table) => {
    const t = convexTest(authSchema, authModules)
    const now = Date.now()
    vi.setSystemTime(now - DAY)
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("user", {
        name: "U",
        email: "u@example.com",
        emailVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      const sessionId = await ctx.db.insert("session", {
        userId,
        token: "session",
        expiresAt: now + DAY,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      for (let i = 0; i < 102; i++) {
        const old = i < 101
        vi.setSystemTime(now + (old ? -DAY : 0))
        const expiresAt = now + (old ? -DAY : DAY)
        if (table === "oauthFlow")
          await ctx.db.insert(table, {
            token: String(i),
            browserHash: "b",
            clientId: "c",
            query: "",
            scopes: [],
            expiresAt,
            used: false,
          })
        if (table === "oauthRate")
          await ctx.db.insert(table, {
            key: String(i),
            start: expiresAt - 1000,
            count: 1,
            expiresAt,
          })
        if (table === "oauthUse")
          await ctx.db.insert(table, {
            key: `code:${i}`,
            grantId: "g",
            expiresAt,
          })
        if (table === "verification")
          await ctx.db.insert(table, {
            identifier: String(i),
            value: "v",
            expiresAt,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        if (table === "ssoProof")
          await ctx.db.insert(table, {
            sessionId: old ? "gone" : sessionId,
            organizationId: String(i),
            revision: "r",
          })
      }
    })
    vi.setSystemTime(now)
    await t.mutation(authApi.retention.prune, { table })
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    )
    expect(jobs).toHaveLength(1)
    await t.mutation(
      authApi.retention.prune,
      jobs[0].args[0] as { table: typeof table; cursor: string }
    )
    expect(await t.run((ctx) => ctx.db.query(table).collect())).toHaveLength(1)
  }
)

test("legacy replay markers are retained until the guarded token expires", async () => {
  const t = convexTest(authSchema, authModules)
  await t.run(async (ctx) => {
    await ctx.db.insert("verification", {
      identifier: "live",
      value: "{}",
      expiresAt: Date.now() + DAY,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await ctx.db.insert("oauthUse", { key: "code:live", grantId: "g" })
    await ctx.db.insert("oauthUse", { key: "code:gone", grantId: "g" })
  })
  await t.mutation(authApi.retention.prune, { table: "oauthUse" })
  expect(
    await t.run((ctx) => ctx.db.query("oauthUse").collect())
  ).toMatchObject([{ key: "code:live" }])
  vi.setSystemTime(Date.now() + 2 * DAY)
  await t.mutation(authApi.retention.prune, { table: "oauthUse" })
  expect(await t.run((ctx) => ctx.db.query("oauthUse").collect())).toHaveLength(
    0
  )
})

test("large raw event batches continue at the byte budget", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 10; i++)
      await ctx.db.insert("sesEvents", {
        topicArn: "t",
        messageId: String(i),
        message: "x".repeat(500_000),
      })
  })
  vi.setSystemTime(Date.now() + 31 * DAY)
  await f.t.mutation(internal.retention.ses, {})
  const remaining = await f.t.run((ctx) => ctx.db.query("sesEvents").collect())
  expect(remaining.length).toBeGreaterThan(0)
  expect(remaining.length).toBeLessThan(10)
  expect(await continuations(f, "retention:ses")).toHaveLength(1)
})

test("import metadata retention keeps fresh and processing jobs and continues batches", async () => {
  const f = await fixture()
  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    createdIds: [],
    errors: [],
  }
  const row = {
    organizationId: f.owner.team,
    contacts: [],
    segmentIds: [],
    skipExisting: false,
    offset: 0,
    result,
  }
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 101; i++)
      await ctx.db.insert("contactImports", { ...row, status: "completed" })
    await ctx.db.insert("contactImports", { ...row, status: "processing" })
  })
  vi.setSystemTime(Date.now() + 8 * DAY)
  await f.t.run((ctx) =>
    ctx.db.insert("contactImports", { ...row, status: "completed" })
  )
  await f.t.mutation(internal.retention.imports, {})
  const jobs = await continuations(f, "retention:imports")
  expect(jobs).toHaveLength(1)
  await f.t.mutation(
    internal.retention.imports,
    jobs[0].args[0] as { cursor: string }
  )
  expect(
    await f.t.run((ctx) => ctx.db.query("contactImports").collect())
  ).toHaveLength(2)
})
