import { afterEach, expect, test, vi } from "vitest"
import { runToCompletion } from "@convex-dev/migrations"
import { defineEvent } from "./automationEvents"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import {
  catalogOptions,
  catalogPage,
  CATALOG_PAGE_BYTES,
} from "./automationEventCatalog"
import { counters } from "./counts"
import {
  deleteAutomationEvent,
  CUSTOM_EVENT_LIMIT_MESSAGE,
} from "./automationEventRows"
import { SYSTEM_EVENT_CATALOG, schemaField } from "../lib/event-catalog"

afterEach(() => vi.restoreAllMocks())

const paginationOpts = {
  cursor: null,
  numItems: 100,
  maximumRowsRead: 100,
  maximumBytesRead: CATALOG_PAGE_BYTES,
}
test("12k legacy definitions page by name, search by name and retain selected schemas with bounded reads", async () => {
  const f = await fixture()
  const org = f.owner.team
  // Legacy data intentionally bypasses the new cap. Seed in bounded batches.
  for (let offset = 0; offset < 12000; offset += 200) {
    await f.t.run(async (ctx) => {
      for (let i = offset; i < offset + 200; i++) {
        const name = `record${String(i).padStart(5, "0")}`
        await ctx.db.insert("automationEvents", {
          organizationId: org,
          name,
          schema: [{ key: "total", type: "number" }],
          searchText: name,
          updatedAt: 0,
        })
      }
    })
  }
  await f.t.run((ctx) =>
    ctx.db.insert("automationEvents", {
      organizationId: f.outsider.team,
      name: "record11999",
      schema: [],
      searchText: "record11999",
      updatedAt: 0,
    })
  )
  const first = await f.owner.client.query(api.automationEventCatalog.page, {
    organizationId: org,
    paginationOpts,
  })
  expect(
    first.page.slice(0, SYSTEM_EVENT_CATALOG.length).map((e) => e.trigger)
  ).toEqual(SYSTEM_EVENT_CATALOG.map((e) => e.trigger))
  expect(
    first.page.filter((e) => e.group === "Custom events").map((e) => e.name)
  ).toEqual(
    Array.from({ length: 100 }, (_, i) => `record${String(i).padStart(5, "0")}`)
  )
  const names = first.page
    .filter((e) => e.group === "Custom events")
    .map((e) => e.name)
  let current = first
  while (!current.isDone) {
    current = await f.owner.client.query(api.automationEventCatalog.page, {
      organizationId: org,
      paginationOpts: { ...paginationOpts, cursor: current.continueCursor },
    })
    expect(current.page.length).toBeLessThanOrEqual(100)
    names.push(...current.page.map((e) => e.name))
  }
  expect(names).toHaveLength(12000)
  expect(new Set(names).size).toBe(12000)
  expect(names.at(-1)).toBe("record11999")
  const search = await f.owner.client.query(api.automationEventCatalog.search, {
    organizationId: org,
    search: "record11999",
    paginationOpts,
  })
  expect(search.page.map((e) => e.name)).toEqual(["record11999"])
  expect(schemaField(search.page[0].schema, "total")?.type).toBe("number")
  const options = await f.owner.client.query(
    api.automationEventCatalog.options,
    {
      organizationId: org,
      search: "record11999",
      selectedNames: ["record11000"],
    }
  )
  expect(options.map((e) => e.name)).toEqual(["record11999", "record11000"])
  const compatibility = await f.owner.client.query(
    api.automationEvents.catalog,
    { organizationId: org }
  )
  expect(compatibility.filter((e) => e.group === "Custom events")).toHaveLength(
    20
  )
  // Measure rows read, rather than inferring scalability from output size.
  await f.t.run(async (ctx) => {
    const opts = { ...paginationOpts, cursor: null, id: 7 }
    await catalogPage(ctx, org, opts)
    const pageMetrics = await ctx.meta.getTransactionMetrics()
    expect(pageMetrics.documentsRead.used).toBeLessThanOrEqual(101)
    expect(pageMetrics.bytesRead.used).toBeLessThanOrEqual(CATALOG_PAGE_BYTES)
    await catalogOptions(ctx, org, "record11999", ["record11000"])
    const pickerMetrics = await ctx.meta.getTransactionMetrics()
    expect(
      pickerMetrics.documentsRead.used - pageMetrics.documentsRead.used
    ).toBeLessThanOrEqual(3)
  })
  await f.t.run(async (ctx) => {
    await catalogPage(ctx, org, paginationOpts, "record11999")
    const metrics = await ctx.meta.getTransactionMetrics()
    expect(metrics.documentsRead.used).toBeLessThanOrEqual(100)
  })
  // A real legacy backfill retains all 12k definitions and enforces their count.
  await f.t.action(async (ctx) => {
    await runToCompletion(
      ctx,
      components.migrations,
      internal.migrations.countAutomationEvents,
      { cursor: null }
    )
  })
  await f.t.run(async (ctx) => {
    expect(await counters.automationEvents.total(ctx, org)).toBe(12000)
    const before = await ctx.meta.getTransactionMetrics()
    await expect(
      defineEvent(ctx, org, { name: "overflow", schema: [] })
    ).rejects.toThrow(CUSTOM_EVENT_LIMIT_MESSAGE)
    const after = await ctx.meta.getTransactionMetrics()
    expect(after.documentsRead.used - before.documentsRead.used).toBeLessThan(
      100
    )
  })
  // Drop below the cap, admit exactly the 10,000th, then refuse the next.
  for (let batch = 0; batch < 21; batch++) {
    await f.t.run(async (ctx) => {
      const rows = await ctx.db
        .query("automationEvents")
        .withIndex("by_organizationId_and_name", (q) =>
          q.eq("organizationId", org)
        )
        .take(batch === 20 ? 1 : 100)
      for (const row of rows) await deleteAutomationEvent(ctx, row._id)
    })
  }
  await f.t.run(async (ctx) => {
    expect(await counters.automationEvents.total(ctx, org)).toBe(9999)
    await defineEvent(ctx, org, { name: "last.allowed", schema: [] })
    expect(await counters.automationEvents.total(ctx, org)).toBe(10000)
    await expect(
      defineEvent(ctx, org, { name: "first.refused", schema: [] })
    ).rejects.toThrow(CUSTOM_EVENT_LIMIT_MESSAGE)
    const metrics = await ctx.meta.getTransactionMetrics()
    expect(metrics.documentsRead.used).toBeLessThan(100)
  })
  await expect(
    f.outsider.client.query(api.automationEventCatalog.options, {
      organizationId: org,
    })
  ).rejects.toThrow("permission")
  await expect(
    f.owner.client.query(api.automationEventCatalog.page, {
      organizationId: org,
      paginationOpts: { cursor: null, numItems: 101 },
    })
  ).rejects.toThrow("between 1 and 100")
}, 60000)

test("REST catalog keeps object event_catalog while adding forward search pages and cap failures", async () => {
  const f = await fixture()
  const org = f.owner.team
  await f.owner.client.mutation(api.automationEvents.ensure, {
    organizationId: org,
    names: ["zeta", "alpha", "beta"],
  })
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: org,
    input: { name: "Catalog test", permission: "full_access", domainId: null },
  })
  const request = (path: string, body?: object) =>
    f.t.fetch(path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  const first = await request("/events/catalog?limit=1")
  expect(first.status).toBe(200)
  const defaultPage = await request("/events/catalog")
  expect(await defaultPage.json()).toMatchObject({
    object: "event_catalog",
    data: expect.any(Array),
    has_more: false,
    next_cursor: null,
  })
  const body = await first.json()
  expect(body.object).toBe("event_catalog")
  expect(body).toMatchObject({
    object: "event_catalog",
    has_more: true,
    next_cursor: expect.any(String),
  })
  expect(body.data.at(-1).name).toBe("alpha")
  const next = await request(
    `/events/catalog?limit=1&after=${encodeURIComponent(body.next_cursor)}`
  )
  expect(await next.json()).toMatchObject({
    object: "event_catalog",
    has_more: true,
    data: [{ name: "beta" }],
  })
  const searched = await request("/events/catalog?search=zeta")
  expect(await searched.json()).toMatchObject({
    object: "event_catalog",
    has_more: false,
    next_cursor: null,
    data: [{ name: "zeta" }],
  })
  expect((await request("/events/catalog?limit=101")).status).toBe(422)
  vi.spyOn(counters.automationEvents, "total").mockResolvedValue(10000)
  const overflow = await request("/events", { name: "overflow" })
  expect(overflow.status).toBe(422)
  expect(await overflow.json()).toMatchObject({
    name: "validation_error",
    message: CUSTOM_EVENT_LIMIT_MESSAGE,
  })
})
