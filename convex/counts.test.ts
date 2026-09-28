/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest"
import { runToCompletion } from "@convex-dev/migrations"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import type { ActionCtx } from "./_generated/server"
import { COUNTED_TABLES, counters, patchRow } from "./counts"
import { writeLog } from "./logs"
import { fixture } from "./testHelpers/ses.fixture"

const page = { cursor: null, numItems: 50 }
const DAY = 86_400_000

afterEach(() => {
  vi.useRealTimers()
})

test("counted tables are written only through the counts module", () => {
  const sources = import.meta.glob<string>("./**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  })
  const write = new RegExp(
    `\\.(insert|patch|replace|delete)\\(\\s*"(${COUNTED_TABLES.join("|")})"`
  )
  expect(Object.keys(sources)).toContain("./contacts.ts")
  const offenders = Object.entries(sources)
    .filter(
      ([path]) =>
        path !== "./counts.ts" &&
        !path.endsWith(".test.ts") &&
        !path.includes("/_generated/")
    )
    .filter(([, source]) => write.test(source))
    .map(([path]) => path)
  expect(offenders).toEqual([])
})

async function setup() {
  const f = await fixture()
  const org = f.owner.team
  const owner = f.owner.client
  const upsert = (contacts: { email: string; [key: string]: unknown }[]) =>
    owner.mutation(api.contacts.upsert, {
      organizationId: org,
      contacts,
      segmentIds: [],
    })
  const contactCount = async (
    filters: {
      search?: string
      unsubscribed?: boolean
      segmentId?: Id<"segments">
      from?: number
      to?: number
    } = {}
  ) =>
    (await owner.query(api.contacts.count, { organizationId: org, ...filters }))
      .total
  return { f, org, owner, upsert, contactCount }
}

describe("contact counts", () => {
  test("stay exact through creates, edits and deletes, per team", async () => {
    const { f, org, owner, upsert, contactCount } = await setup()
    const { createdIds } = await upsert([
      { email: "a@example.com" },
      { email: "b@example.com" },
      { email: "c@example.com", unsubscribed: true },
    ])
    expect(await contactCount()).toBe(3)
    expect(await contactCount({ unsubscribed: true })).toBe(1)
    expect(await contactCount({ unsubscribed: false })).toBe(2)

    // A merge by email is an edit, not another contact.
    await upsert([{ email: "A@example.com", firstName: "Ann" }])
    expect(await contactCount()).toBe(3)
    await owner.mutation(api.contacts.update, {
      id: createdIds[0],
      unsubscribed: true,
    })
    expect(await contactCount({ unsubscribed: true })).toBe(2)
    await owner.mutation(api.contacts.remove, {
      organizationId: org,
      ids: [createdIds[1]],
    })
    expect(await contactCount()).toBe(2)
    expect(await contactCount({ unsubscribed: false })).toBe(0)

    // Another team counts its own, and cannot read ours.
    expect(
      (
        await f.outsider.client.query(api.contacts.count, {
          organizationId: f.outsider.team,
        })
      ).total
    ).toBe(0)
    await expect(
      f.outsider.client.query(api.contacts.count, { organizationId: org })
    ).rejects.toThrow("permission")
  })

  test("count whole days exactly and leave the rest unknown", async () => {
    // Either side of midnight UTC, within the session's hour.
    const day = Date.UTC(2026, 8, 12)
    vi.useFakeTimers()
    vi.setSystemTime(day - 15 * 60_000)
    const { upsert, contactCount } = await setup()
    await upsert([{ email: "old@example.com" }])
    vi.setSystemTime(day + 15 * 60_000)
    await upsert([{ email: "new@example.com", unsubscribed: true }])

    expect(await contactCount({ from: day, to: day + DAY - 1 })).toBe(1)
    expect(await contactCount({ from: day - DAY, to: day - 1 })).toBe(1)
    expect(await contactCount({ from: day - 3 * DAY, to: day + DAY - 1 })).toBe(
      2
    )
    // Days that start on the half hour, as in India, count as well.
    const ist = day - 5.5 * 3_600_000
    expect(await contactCount({ from: ist, to: ist + DAY - 1 })).toBe(2)
    expect(await contactCount({ from: ist + DAY, to: ist + 2 * DAY - 1 })).toBe(
      0
    )
    expect(
      await contactCount({ from: day, to: day + DAY - 1, unsubscribed: false })
    ).toBe(0)
    // A range off the 15-minute grid, or a search, is not counted.
    expect(await contactCount({ from: day + 1, to: day + DAY - 1 })).toBeNull()
    expect(await contactCount({ search: "new" })).toBeNull()
  })

  test("segment sizes follow memberships and deletes", async () => {
    const { f, org, owner, upsert, contactCount } = await setup()
    const segment = await owner.mutation(api.segments.create, {
      organizationId: org,
      name: "Customers",
    })
    const { createdIds } = await upsert([
      { email: "a@example.com" },
      { email: "b@example.com" },
      { email: "c@example.com" },
    ])
    await owner.mutation(api.contacts.addToSegments, {
      organizationId: org,
      ids: createdIds,
      segmentIds: [segment],
    })
    const size = async () =>
      (await owner.query(api.segments.get, { id: segment }))!.memberCount
    expect(await size()).toBe(3)
    expect(await contactCount({ segmentId: segment })).toBe(3)
    // With another filter the segment is not counted.
    expect(
      await contactCount({ segmentId: segment, unsubscribed: false })
    ).toBeNull()

    await owner.mutation(api.contacts.setSegment, {
      id: createdIds[0],
      segmentId: segment,
      member: false,
    })
    expect(await size()).toBe(2)
    await owner.mutation(api.contacts.remove, {
      organizationId: org,
      ids: [createdIds[1]],
    })
    expect(await size()).toBe(1)
    const listed = await owner.query(api.segments.list, {
      organizationId: org,
      paginationOpts: page,
    })
    expect(listed.page.map((row) => row.memberCount)).toEqual([1])

    await owner.mutation(api.segments.remove, { id: segment })
    vi.useFakeTimers()
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
    expect(
      (await owner.query(api.segments.count, { organizationId: org })).total
    ).toBe(0)
    expect(
      await f.t.run((ctx) => counters.segmentMembers.total(ctx, segment))
    ).toBe(0)
    expect(await contactCount()).toBe(2)
  })
})

describe("list counts", () => {
  test("keys by permission; logs by status, source, day and key", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 8, 12, 10))
    const { f, org, owner } = await setup()
    const create = (
      name: string,
      permission: "full_access" | "sending_access"
    ) =>
      owner.action(api.apiKeys.create, {
        organizationId: org,
        input: { name, permission },
      })
    const { id: full } = await create("Full", "full_access")
    await create("Sending", "sending_access")
    await create("Sending 2", "sending_access")
    const keyCount = async (permission?: "full_access" | "sending_access") =>
      (
        await owner.query(api.apiKeys.count, {
          organizationId: org,
          permission,
        })
      ).total
    expect(await keyCount()).toBe(3)
    expect(await keyCount("sending_access")).toBe(2)
    await owner.mutation(api.apiKeys.update, {
      id: full,
      patch: { permission: "sending_access" },
    })
    expect(await keyCount("full_access")).toBe(0)
    expect(await keyCount("sending_access")).toBe(3)

    const log = (
      status: number,
      source: "api" | "smtp",
      apiKeyId?: Id<"apiKeys">
    ) =>
      f.t.run((ctx) =>
        writeLog(ctx, org, {
          method: "POST",
          path: "/emails",
          status,
          durationMs: 5,
          userAgent: "test",
          source,
          apiKeyId,
          requestHeaders: [],
        })
      )
    await log(200, "api", full)
    await log(422, "api", full)
    await log(200, "smtp")
    const logCount = async (filters: Record<string, unknown>) =>
      (await owner.query(api.logs.count, { organizationId: org, ...filters }))
        .total
    const today = { from: Date.UTC(2026, 8, 12), to: Date.UTC(2026, 8, 13) - 1 }
    expect(await logCount({})).toBe(3)
    expect(await logCount({ statusClass: "2xx" })).toBe(2)
    expect(await logCount({ source: "api", ...today })).toBe(2)
    expect(await logCount({ statusClass: "2xx", source: "smtp" })).toBe(1)
    expect(await logCount({ apiKeyId: full })).toBe(2)
    expect(await logCount({ apiKeyId: full, statusClass: "4xx" })).toBe(1)
    expect(await logCount({ userAgent: "test" })).toBeNull()
    expect((await owner.query(api.apiKeys.get, { id: full }))!.requests).toBe(2)

    // Retention takes logs out of the counts with them.
    vi.setSystemTime(Date.UTC(2026, 9, 20))
    await f.t.mutation(internal.logs.prune, {})
    expect(await f.t.run((ctx) => counters.apiLogs.total(ctx, org))).toBe(0)
    expect(await f.t.run((ctx) => counters.apiKeyLogs.total(ctx, full))).toBe(0)
  })

  test("templates by status; a deleted domain leaves the count", async () => {
    const { f, org, owner } = await setup()
    const create = (name: string) =>
      owner.mutation(api.templates.create, {
        organizationId: org,
        name,
        html: "<p>Hi</p>",
      })
    const first = await create("Welcome")
    await create("Receipt")
    await owner.mutation(api.templates.publish, { id: first })
    const templateCount = async (status?: "draft" | "published") =>
      (await owner.query(api.templates.count, { organizationId: org, status }))
        .total
    expect(await templateCount()).toBe(2)
    expect(await templateCount("published")).toBe(1)
    await owner.mutation(api.templates.remove, { id: first })
    expect(await templateCount("published")).toBe(0)
    expect(await templateCount()).toBe(1)

    const domainCount = async (status?: "pending" | "verified") =>
      (await owner.query(api.domains.count, { organizationId: org, status }))
        .total
    expect(await domainCount()).toBe(1)
    expect(await domainCount("pending")).toBe(1)
    expect(await domainCount("verified")).toBe(0)
    await f.t.run((ctx) =>
      patchRow(ctx, "domains", f.domain, { status: "verified" })
    )
    expect(await domainCount("verified")).toBe(1)
    await f.t.run((ctx) =>
      patchRow(ctx, "domains", f.domain, { deleted: true })
    )
    expect(await domainCount()).toBe(0)
  })
})

describe("search", () => {
  test("keeps only rows containing the whole search", async () => {
    const { f, org, owner, upsert } = await setup()
    for (const n of ["05", "06", "07", "08"])
      await owner.action(api.apiKeys.create, {
        organizationId: org,
        input: { name: `QA key ${n}`, permission: "full_access" },
      })
    const keys = await owner.query(api.apiKeys.list, {
      organizationId: org,
      paginationOpts: page,
      search: "QA key 07",
    })
    expect(keys.page.map((key) => key.name)).toEqual(["QA key 07"])

    await upsert([
      { email: "jane@example.com", firstName: "Jane", lastName: "Smith" },
      { email: "jane@example.org", firstName: "Jane", lastName: "Jones" },
      { email: "bob@example.com", firstName: "Bob", lastName: "Smith" },
    ])
    const contacts = async (search: string) =>
      (
        await owner.query(api.contacts.list, {
          organizationId: org,
          paginationOpts: page,
          search,
        })
      ).page.map((contact) => contact.email)
    expect(await contacts("jane@example.com")).toEqual(["jane@example.com"])
    expect(await contacts("Jane Smith")).toEqual(["jane@example.com"])
    expect(await contacts("SMITH")).toHaveLength(2)

    for (const name of ["Welcome email", "Welcome back"])
      await owner.mutation(api.templates.create, { organizationId: org, name })
    const templates = await owner.query(api.templates.list, {
      organizationId: org,
      paginationOpts: page,
      search: "welcome back",
    })
    expect(templates.page.map((row) => row.name)).toEqual(["Welcome back"])

    // Small lists search the same way, a page at a time.
    for (const name of ["Customers", "Trial users", "Customers EU"])
      await owner.mutation(api.segments.create, { organizationId: org, name })
    const segments = await owner.query(api.segments.list, {
      organizationId: org,
      paginationOpts: page,
      search: "customers",
    })
    expect(segments.page.map((row) => row.name).sort()).toEqual([
      "Customers",
      "Customers EU",
    ])
    await expect(
      f.outsider.client.query(api.segments.list, {
        organizationId: org,
        paginationOpts: page,
      })
    ).rejects.toThrow("permission")
  })
})

describe("backfill", () => {
  test("counts rows written before the counts existed, once", async () => {
    const { f, org, owner } = await setup()
    // Rows as an earlier version wrote them: straight to the tables.
    const segment = await f.t.run(async (ctx) => {
      const segment = await ctx.db.insert("segments", {
        organizationId: org,
        name: "Legacy",
        memberCount: 2,
      })
      for (const email of ["a@example.com", "b@example.com"]) {
        const contactId = await ctx.db.insert("contacts", {
          organizationId: org,
          email,
          firstName: "",
          lastName: "",
          unsubscribed: false,
          properties: {},
          search: email,
          updatedAt: Date.now(),
        })
        await ctx.db.insert("segmentMembers", {
          organizationId: org,
          segmentId: segment,
          contactId,
        })
      }
      const webhookId = await ctx.db.insert("webhooks", {
        organizationId: org,
        endpoint: "https://example.com/hook",
        events: ["contact.created"],
        enabled: true,
        secret: "x",
      })
      await ctx.db.insert("webhookStats", {
        webhookId,
        deliveries: 0,
        failed: 0,
      })
      return segment
    })
    const totals = async () => ({
      contacts: (await owner.query(api.contacts.count, { organizationId: org }))
        .total,
      segments: (await owner.query(api.segments.count, { organizationId: org }))
        .total,
      members: (await owner.query(api.segments.get, { id: segment }))!
        .memberCount,
      webhooks: (await owner.query(api.webhooks.count, { organizationId: org }))
        .total,
    })
    expect(await totals()).toEqual({
      contacts: 0,
      segments: 0,
      members: 0,
      webhooks: 0,
    })

    const migrations = [
      internal.migrations.countContacts,
      internal.migrations.countSegments,
      internal.migrations.countSegmentMembers,
      internal.migrations.countWebhooks,
      internal.migrations.dropWebhookStats,
    ]
    // From the start each time, so a rerun walks every row again.
    const backfill = async (ctx: ActionCtx) => {
      for (const migration of migrations)
        await runToCompletion(ctx, components.migrations, migration, {
          cursor: null,
        })
    }
    await f.t.action(backfill)
    const expected = { contacts: 2, segments: 1, members: 2, webhooks: 1 }
    expect(await totals()).toEqual(expected)
    const legacy = await f.t.run(async (ctx) => ({
      segment: await ctx.db.get("segments", segment),
      stats: await ctx.db.query("webhookStats").take(1),
    }))
    expect(legacy.segment).not.toHaveProperty("memberCount")
    expect(legacy.stats).toEqual([])

    // Rows written live are already counted: a rerun adds nothing.
    await owner.mutation(api.contacts.upsert, {
      organizationId: org,
      contacts: [{ email: "c@example.com" }],
      segmentIds: [],
    })
    await f.t.action(backfill)
    expect(await totals()).toEqual({ ...expected, contacts: 3 })
  })
})
