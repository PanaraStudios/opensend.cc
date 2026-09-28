/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest"
import type {
  FunctionReference,
  PaginationOptions,
  PaginationResult,
} from "convex/server"
import { api } from "./_generated/api"
import { filteredPage, matchesSearch } from "./lists"
import { insertRow } from "./counts"
import { insertAutomationEvent } from "./automationEventRows"
import { fixture } from "./testHelpers/ses.fixture"
import { knownTotal } from "../lib/dashboard/pagination"

const firstPage = { cursor: null, numItems: 40 }

afterEach(() => vi.useRealTimers())

async function allPages<T>(
  read: (opts: PaginationOptions) => Promise<PaginationResult<T>>
) {
  const rows: T[] = []
  let cursor: string | null = null
  const seen = new Set<string>()
  for (let i = 0; i < 2000; i++) {
    const result = await read({ ...firstPage, cursor })
    expect(result.page.length).toBeLessThanOrEqual(16)
    rows.push(...result.page)
    if (result.isDone) return rows
    expect(seen.has(result.continueCursor)).toBe(false)
    seen.add(result.continueCursor)
    cursor = result.continueCursor
  }
  throw new Error("Search did not exhaust its index range")
}

test("whole-query matching includes interior, punctuation, Unicode and long substrings", () => {
  expect(matchesSearch(" ONTACT09 ")("qa.contact0999@example.test")).toBe(true)
  expect(matchesSearch("@EXAMPLE.")("qa.contact0999@example.test")).toBe(true)
  expect(matchesSearch("bara tor")("Barbara Torvalds")).toBe(true)
  expect(matchesSearch("Barbara Torvalds")("Barbara", "Torvalds")).toBe(false)
  expect(matchesSearch("ÉLO")("Héloïse")).toBe(true)
  expect(matchesSearch("東京")("東京都")).toBe(true)
  const long = "x".repeat(300)
  expect(matchesSearch(`${long}z`)(`${long}y`)).toBe(false)
})

test("one bounded scan preserves empty-page continuation and reactive split metadata", async () => {
  const result: PaginationResult<string> = {
    page: ["unrelated"],
    isDone: false,
    continueCursor: "next",
    splitCursor: "middle",
    pageStatus: "SplitRequired",
  }
  const paginate = vi.fn(async () => result)
  const opts = {
    numItems: 10000,
    cursor: "start",
    endCursor: "end",
    id: 7,
    maximumRowsRead: 10000,
    maximumBytesRead: 100000000,
  }
  expect(
    await filteredPage(
      { paginate },
      opts,
      (row) => matchesSearch("missing")(row),
      "missing"
    )
  ).toEqual({ ...result, page: [] })
  expect(paginate).toHaveBeenCalledExactlyOnceWith({
    ...opts,
    numItems: 16,
    maximumRowsRead: 16,
    maximumBytesRead: 1024 * 1024,
  })
  expect(
    knownTotal({
      loaded: 0,
      total: null,
      hasMore: !result.isDone,
      page: 0,
      pageSize: 40,
    })
  ).toBeNull()
})

test("scan bounds respect stricter callers, cannot be disabled, and leave non-search options intact", async () => {
  const paginate = vi.fn<
    (opts: PaginationOptions) => Promise<PaginationResult<string>>
  >(async () => ({
    page: [],
    isDone: true,
    continueCursor: "end",
  }))
  const opts = { ...firstPage, maximumRowsRead: 3, maximumBytesRead: 100 }
  await filteredPage({ paginate }, opts, () => true, "x")
  expect(paginate).toHaveBeenLastCalledWith({ ...opts, numItems: 16 })
  await filteredPage(
    { paginate },
    { ...firstPage, maximumRowsRead: 0, maximumBytesRead: 0 },
    () => true,
    "x"
  )
  expect(paginate).toHaveBeenLastCalledWith({
    ...firstPage,
    numItems: 16,
    maximumRowsRead: 1,
    maximumBytesRead: 1,
  })
  await filteredPage({ paginate }, firstPage, () => true, "  ")
  expect(paginate.mock.calls.at(-1)?.[0]).toBe(firstPage)
})

test("120 distinct contact prefixes are complete, even after an empty page", async () => {
  vi.useFakeTimers()
  const f = await fixture()
  const org = f.owner.team
  // Historical rows predate the count backfill; search must work immediately.
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 120; i++) {
      const token = `contact09${String(i).padStart(3, "0")}`
      await ctx.db.insert("contacts", {
        organizationId: org,
        email: `qa.${token}@example.test`,
        firstName: "Barbara",
        lastName: "Torvalds",
        unsubscribed: i % 2 === 0,
        properties: {},
        search: `qa ${token} example test Barbara Torvalds`,
        updatedAt: Date.now(),
      })
    }
    for (let i = 0; i < 20; i++)
      await ctx.db.insert("contacts", {
        organizationId: org,
        email: `other${i}@example.test`,
        firstName: "Unrelated",
        lastName: "",
        unsubscribed: false,
        properties: {},
        search: "other",
        updatedAt: Date.now(),
      })
    await ctx.db.insert("contacts", {
      organizationId: f.outsider.team,
      email: "qa.contact09999@example.test",
      firstName: "Barbara",
      lastName: "Torvalds",
      unsubscribed: false,
      properties: {},
      search: "contact09999",
      updatedAt: Date.now(),
    })
  })
  const read = (search: string, paginationOpts: PaginationOptions) =>
    f.owner.client.query(api.contacts.list, {
      organizationId: org,
      search,
      paginationOpts,
    })
  const initial = await read("contact09", firstPage)
  expect(initial.page).toEqual([])
  expect(initial.isDone).toBe(false)
  const rows = await allPages((opts) => read("contact09", opts))
  expect(rows).toHaveLength(120)
  expect(new Set(rows.map((row) => row._id)).size).toBe(120)
  expect(await allPages((opts) => read("ONTACT09", opts))).toHaveLength(120)
  expect(await allPages((opts) => read("Barbara Torvalds", opts))).toHaveLength(
    120
  )
  expect(await allPages((opts) => read("@example.", opts))).toHaveLength(140)
  const filtered = await allPages((paginationOpts) =>
    f.owner.client.query(api.contacts.list, {
      organizationId: org,
      search: "contact09",
      unsubscribed: true,
      paginationOpts,
    })
  )
  expect(filtered).toHaveLength(60)
  expect(filtered.every((row) => row.unsubscribed)).toBe(true)
  expect(
    await f.owner.client.query(api.contacts.count, {
      organizationId: org,
      search: "contact09",
    })
  ).toEqual({ total: null })
  expect(
    knownTotal({
      loaded: rows.length,
      total: null,
      hasMore: false,
      page: 0,
      pageSize: 40,
    })
  ).toBe(120)
  // Normal lists retain the requested page size.
  expect(
    (
      await f.owner.client.query(api.contacts.list, {
        organizationId: org,
        paginationOpts: firstPage,
      })
    ).page
  ).toHaveLength(40)
})

test("search paginates beyond 1024 matching documents", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 1050; i++)
      await ctx.db.insert("contacts", {
        organizationId: f.owner.team,
        email: `contact${i}@example.test`,
        firstName: "",
        lastName: "",
        unsubscribed: false,
        properties: {},
        search: `contact${i}`,
        updatedAt: Date.now(),
      })
  })
  const rows = await allPages((paginationOpts) =>
    f.owner.client.query(api.contacts.list, {
      organizationId: f.owner.team,
      paginationOpts,
      search: "contact",
    })
  )
  expect(rows).toHaveLength(1050)
  expect(new Set(rows.map((row) => row._id)).size).toBe(1050)
})

test("segment searches retain membership, subscription and date filters", async () => {
  vi.useFakeTimers()
  const f = await fixture()
  const org = f.owner.team
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId: org,
    name: "Group",
  })
  await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: org,
    segmentIds: [segmentId],
    contacts: [{ email: "before@example.test" }],
  })
  vi.setSystemTime(Date.now() + 1000)
  const from = Date.now()
  await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: org,
    segmentIds: [segmentId],
    contacts: [
      { email: "included@example.test", unsubscribed: true },
      { email: "subscribed@example.test" },
    ],
  })
  await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: org,
    segmentIds: [],
    contacts: [{ email: "nonmember@example.test", unsubscribed: true }],
  })
  const rows = await allPages((paginationOpts) =>
    f.owner.client.query(api.contacts.list, {
      organizationId: org,
      segmentId,
      unsubscribed: true,
      from,
      to: from,
      search: "@example.",
      paginationOpts,
    })
  )
  expect(rows.map((row) => row.email)).toEqual(["included@example.test"])
  await expect(
    f.outsider.client.query(api.contacts.list, {
      organizationId: f.outsider.team,
      segmentId,
      search: "example",
      paginationOpts: firstPage,
    })
  ).rejects.toThrow("Segment not found")
})

test("keys, templates, logs and custom events exhaust over 64 prefix terms", async () => {
  const f = await fixture()
  const org = f.owner.team
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 120; i++) {
      const name = `prefix${String(i).padStart(3, "0")}`
      await insertRow(ctx, "apiKeys", {
        organizationId: org,
        name,
        tokenHash: name,
        tokenPrefix: "os_prefix",
        tokenLast4: "0000",
        permission: "full_access",
        createdBy: { name: "Owner" },
        search: name,
      })
      await insertRow(ctx, "templates", {
        organizationId: org,
        name,
        alias: name,
        status: "draft",
        subject: "",
        preview: "",
        variables: [],
        updatedAt: Date.now(),
        searchText: name,
      })
      await insertRow(ctx, "apiLogs", {
        organizationId: org,
        method: "GET",
        path: `/${name}`,
        status: 200,
        statusClass: "2xx",
        durationMs: 1,
        userAgent: "test",
        source: "api",
        summary: `GET /${name} 200`,
      })
      await insertAutomationEvent(ctx, org, {
        name,
        schema: [{ key: "account_id", type: "string" }],
      })
    }
  })
  for (const list of [
    api.apiKeys.list,
    api.templates.list,
    api.logs.list,
    api.automationEvents.list,
  ]) {
    const rows = await allPages<{ _id: string }>((paginationOpts) =>
      f.owner.client.query(list, {
        organizationId: org,
        search: "prefix",
        paginationOpts,
      })
    )
    expect(rows).toHaveLength(120)
    expect(
      await allPages<{ _id: string }>((paginationOpts) =>
        f.owner.client.query(list, {
          organizationId: org,
          search: "REFIX",
          paginationOpts,
        })
      )
    ).toHaveLength(120)
  }
  expect(
    await allPages((paginationOpts) =>
      f.owner.client.query(api.automationEvents.list, {
        organizationId: org,
        search: "count_id",
        paginationOpts,
      })
    )
  ).toHaveLength(120)
  // Whole-query input must not be silently truncated to a matching prefix.
  await f.owner.client.mutation(api.templates.create, {
    organizationId: org,
    name: "x".repeat(220),
  })
  expect(
    await allPages((paginationOpts) =>
      f.owner.client.query(api.templates.list, {
        organizationId: org,
        search: "x".repeat(220) + "z",
        paginationOpts,
      })
    )
  ).toEqual([])
}, 20000)

test("log search intersects all filters even when the chosen index covers only email", async () => {
  const f = await fixture()
  const org = f.owner.team
  await f.owner.client.action(api.apiKeys.create, {
    organizationId: org,
    input: { name: "Test", permission: "full_access" },
  })
  const keyId = (
    await f.owner.client.query(api.apiKeys.list, {
      organizationId: org,
      paginationOpts: firstPage,
    })
  ).page[0]._id
  await f.t.run(async (ctx) => {
    const base = {
      organizationId: org,
      method: "GET" as const,
      path: "/contacts",
      status: 200,
      statusClass: "2xx" as const,
      durationMs: 1,
      userAgent: "sdk",
      source: "api" as const,
      summary: "GET /contacts 200",
      emailId: "email",
      apiKeyId: keyId,
    }
    await insertRow(ctx, "apiLogs", base)
    await insertRow(ctx, "apiLogs", { ...base, apiKeyId: undefined })
    await insertRow(ctx, "apiLogs", { ...base, source: "smtp" })
    await insertRow(ctx, "apiLogs", { ...base, userAgent: "browser" })
    await insertRow(ctx, "apiLogs", {
      ...base,
      status: 400,
      statusClass: "4xx",
    })
    await insertRow(ctx, "apiLogs", { ...base, emailId: "another" })
  })
  const rows = await allPages((paginationOpts) =>
    f.owner.client.query(api.logs.list, {
      organizationId: org,
      emailId: "email",
      apiKeyId: keyId,
      statusClass: "2xx",
      source: "api",
      userAgent: "sdk",
      search: "TACTS",
      paginationOpts,
    })
  )
  expect(rows).toHaveLength(1)
})

type SearchList = FunctionReference<
  "query",
  "public",
  {
    organizationId: string
    search?: string
    paginationOpts: PaginationOptions
  },
  PaginationResult<{ _id: string }>
>
const lists: [string, SearchList][] = [
  ["contacts", api.contacts.list],
  ["keys", api.apiKeys.list],
  ["templates", api.templates.list],
  ["logs", api.logs.list],
  ["webhooks", api.webhooks.list],
  ["segments", api.segments.list],
  ["topics", api.topics.list],
  ["properties", api.contactProperties.list],
  ["events", api.automationEvents.list],
]

test.each(lists)("%s search rejects another team's reader", async (_, list) => {
  const f = await fixture()
  await expect(
    f.outsider.client.query(list, {
      organizationId: f.owner.team,
      search: "prefix",
      paginationOpts: firstPage,
    })
  ).rejects.toThrow("permission")
})

test("all existing count queries keep search totals unknown", async () => {
  const f = await fixture()
  for (const count of [
    api.contacts.count,
    api.apiKeys.count,
    api.templates.count,
    api.logs.count,
    api.webhooks.count,
    api.segments.count,
    api.topics.count,
    api.contactProperties.count,
  ])
    expect(
      await f.owner.client.query(count, {
        organizationId: f.owner.team,
        search: "prefix",
      })
    ).toEqual({ total: null })
})

test("small lists share bounded substring search and preserve their filters", async () => {
  const f = await fixture()
  const org = f.owner.team
  await f.t.run(async (ctx) => {
    for (const name of ["alpha_suffix", "beta_suffix", "unrelated"]) {
      await insertRow(ctx, "segments", { organizationId: org, name })
      await insertRow(ctx, "topics", {
        organizationId: org,
        name,
        description: "",
        defaultSubscription: "opt_in",
        visibility: "public",
      })
      await insertRow(ctx, "contactProperties", {
        organizationId: org,
        name,
        key: name,
        type: "string",
        deleting: name === "beta_suffix",
      })
      await insertRow(ctx, "webhooks", {
        organizationId: org,
        endpoint: `https://example.test/${name}`,
        events: ["email.sent"],
        enabled: name !== "beta_suffix",
        secret: "encrypted",
      })
    }
  })
  for (const list of [api.segments.list, api.topics.list, api.webhooks.list])
    expect(
      await allPages<{ _id: string }>((paginationOpts) =>
        f.owner.client.query(list, {
          organizationId: org,
          search: "_SUFF",
          paginationOpts,
        })
      )
    ).toHaveLength(2)
  expect(
    await allPages((paginationOpts) =>
      f.owner.client.query(api.contactProperties.list, {
        organizationId: org,
        search: "_SUFF",
        paginationOpts,
      })
    )
  ).toHaveLength(1)
  expect(
    await allPages((paginationOpts) =>
      f.owner.client.query(api.webhooks.list, {
        organizationId: org,
        search: "_SUFF",
        enabled: true,
        paginationOpts,
      })
    )
  ).toHaveLength(1)
})

test("key permission and template status filters still intersect substring searches", async () => {
  const f = await fixture()
  const org = f.owner.team
  await f.t.run(async (ctx) => {
    for (const permission of ["full_access", "sending_access"] as const)
      await insertRow(ctx, "apiKeys", {
        organizationId: org,
        name: "Team credential",
        tokenHash: permission,
        tokenPrefix: "os_example",
        tokenLast4: "0000",
        permission,
        createdBy: { name: "Owner" },
        search: "Team credential",
      })
    for (const status of ["draft", "published"] as const)
      await insertRow(ctx, "templates", {
        organizationId: org,
        name: "Team welcome",
        alias: status,
        status,
        subject: "",
        preview: "",
        variables: [],
        updatedAt: Date.now(),
        searchText: "Team welcome",
      })
  })
  const keys = await allPages((paginationOpts) =>
    f.owner.client.query(api.apiKeys.list, {
      organizationId: org,
      search: "REDENT",
      permission: "sending_access",
      paginationOpts,
    })
  )
  expect(keys.map((key) => key.permission)).toEqual(["sending_access"])
  const templates = await allPages((paginationOpts) =>
    f.owner.client.query(api.templates.list, {
      organizationId: org,
      search: "ELCO",
      status: "published",
      paginationOpts,
    })
  )
  expect(templates.map((template) => template.status)).toEqual(["published"])
})
