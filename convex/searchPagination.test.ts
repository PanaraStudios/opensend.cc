/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest"
import type {
  FunctionReference,
  PaginationOptions,
  PaginationResult,
} from "convex/server"
import { api } from "./_generated/api"
import {
  QueryStream,
  stream,
  type IndexBounds,
  type IndexKey,
} from "convex-helpers/server/stream"
import schema from "./schema"
import { TEMPLATE_SEARCH_BUDGET } from "./templates"
import { LOG_SEARCH_BUDGET } from "./logs"
import { filteredPage, matchesSearch } from "./lists"
import { insertRow } from "./counts"
import { insertAutomationEvent } from "./automationEventRows"
import { fixture } from "./testHelpers/ses.fixture"
import { knownTotal } from "../lib/dashboard/pagination"

const firstPage = { cursor: null, numItems: 40 }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function allPages<T>(
  read: (opts: PaginationOptions) => Promise<PaginationResult<T>>
) {
  const rows: T[] = []
  let cursor: string | null = null
  const seen = new Set<string>()
  for (let i = 0; i < 2000; i++) {
    const result = await read({ ...firstPage, cursor })
    expect(result.page.length).toBeLessThanOrEqual(1024)
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

// Deterministic indexed source; the production stream paginator owns cursors and splits.
class TestStream extends QueryStream<string> {
  constructor(private values: [string, IndexKey, number][]) {
    super()
  }
  native = vi.fn<
    (opts: PaginationOptions) => Promise<PaginationResult<string>>
  >(async () => ({
    page: this.values.map(([row]) => row),
    isDone: true,
    continueCursor: "native-end",
  }))
  inner() {
    return { paginate: this.native }
  }
  async *iterWithKeys(): AsyncGenerator<[string, IndexKey, number], undefined> {
    yield* this.values
  }
  narrow(bounds: IndexBounds): TestStream {
    return new TestStream(
      this.values.filter(([, [key]]) => {
        const n = key as number
        const lower = bounds.lowerBound[0] as number | undefined
        const upper = bounds.upperBound[0] as number | undefined
        return (
          (lower === undefined ||
            (bounds.lowerBoundInclusive ? n >= lower : n > lower)) &&
          (upper === undefined ||
            (bounds.upperBoundInclusive ? n <= upper : n < upper))
        )
      })
    )
  }
  getOrder() {
    return "asc" as const
  }
  getIndexFields() {
    return ["key"]
  }
  getEqualityIndexFilter() {
    return []
  }
}
const source = (count: number, bytes = 100) =>
  new TestStream(
    Array.from({ length: count }, (_, i) => [`row${i}`, [i], bytes])
  )

test("empty pages preserve continuation and split metadata instead of declaring exhaustion", async () => {
  const rows = source(1200)
  const result = await filteredPage(
    rows,
    firstPage,
    () => false,
    LOG_SEARCH_BUDGET,
    "missing"
  )
  expect(result.page).toEqual([])
  expect(result.isDone).toBe(false)
  expect(result.pageStatus).toBe("SplitRequired")
  expect(result.splitCursor).toBeTruthy()
  expect(
    knownTotal({
      loaded: 0,
      total: null,
      hasMore: !result.isDone,
      page: 0,
      pageSize: 40,
    })
  ).toBeNull()
  const next = await filteredPage(
    rows,
    { ...firstPage, cursor: result.continueCursor },
    () => false,
    LOG_SEARCH_BUDGET,
    "missing"
  )
  expect(next.isDone).toBe(true)
})

test("scan bounds respect stricter callers, cannot be disabled, and leave non-search options intact", async () => {
  const rows = source(100)
  const opts = {
    ...firstPage,
    numItems: 1,
    maximumRowsRead: 3,
    maximumBytesRead: 10000,
  }
  expect(
    (await filteredPage(rows, opts, () => true, LOG_SEARCH_BUDGET, "row")).page
  ).toHaveLength(3)
  expect(
    (
      await filteredPage(
        rows,
        { ...firstPage, maximumBytesRead: 150 },
        () => true,
        LOG_SEARCH_BUDGET,
        "row"
      )
    ).page
  ).toHaveLength(2)
  expect(
    (
      await filteredPage(
        rows,
        { ...firstPage, maximumRowsRead: 0, maximumBytesRead: 0 },
        () => true,
        LOG_SEARCH_BUDGET,
        "row"
      )
    ).page
  ).toHaveLength(1)
  const nonFinite = await filteredPage(
    source(1200),
    {
      ...firstPage,
      maximumRowsRead: NaN,
      maximumBytesRead: Infinity,
    },
    () => false,
    LOG_SEARCH_BUDGET,
    "missing"
  )
  expect(nonFinite.isDone).toBe(false)
  expect(nonFinite.pageStatus).toBe("SplitRequired")
  await filteredPage(rows, firstPage, () => true, LOG_SEARCH_BUDGET, "  ")
  expect(rows.native).toHaveBeenCalledExactlyOnceWith(firstPage)
  expect(rows.native.mock.calls[0][0]).toBe(firstPage)
})

test("hydration reservations bound dense matches even when endCursor overrides numItems", async () => {
  const rows = source(100)
  const end = await filteredPage(
    rows,
    firstPage,
    () => true,
    LOG_SEARCH_BUDGET,
    "row"
  )
  const opts = { ...firstPage, numItems: 1, endCursor: end.continueCursor }
  const result = await filteredPage(
    rows,
    opts,
    () => true,
    TEMPLATE_SEARCH_BUDGET,
    "row"
  )
  expect(result.page).toHaveLength(
    Math.ceil(
      TEMPLATE_SEARCH_BUDGET.bytes /
        (TEMPLATE_SEARCH_BUDGET.bytesPerMatch + 100)
    )
  )
  expect(result.isDone).toBe(false)
  expect(result.pageStatus).toBe("SplitRequired")
  expect(result.splitCursor).toBeTruthy()
  const left = await filteredPage(
    rows,
    { ...opts, endCursor: result.splitCursor },
    () => true,
    TEMPLATE_SEARCH_BUDGET,
    "row"
  )
  const right = await filteredPage(
    rows,
    { ...opts, cursor: result.splitCursor!, endCursor: result.continueCursor },
    () => true,
    TEMPLATE_SEARCH_BUDGET,
    "row"
  )
  expect([...left.page, ...right.page]).toEqual(result.page)
  // Repeated splits/continuations must never lose or repeat a kept row.
  const loaded = await allPages((paginationOpts) =>
    filteredPage(
      rows,
      paginationOpts,
      () => true,
      TEMPLATE_SEARCH_BUDGET,
      "row"
    )
  )
  expect(loaded).toEqual(Array.from({ length: 100 }, (_, i) => `row${i}`))
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
  const initial = await read("contact09", { ...firstPage, maximumRowsRead: 16 })
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

test("rare contact among 10000 rows takes ten bounded scans", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 10000; i++)
      await ctx.db.insert("contacts", {
        organizationId: f.owner.team,
        email: `${i === 0 ? "rare" : "ordinary"}${i}@example.test`,
        firstName: "",
        lastName: "",
        unsubscribed: false,
        properties: {},
        search: "",
        updatedAt: 0,
      })
  })
  let requests = 0
  const rows = await allPages((paginationOpts) => {
    requests++
    return f.owner.client.query(api.contacts.list, {
      organizationId: f.owner.team,
      search: "rare",
      paginationOpts: { ...paginationOpts, numItems: 1 },
    })
  })
  expect(rows.map((row) => row.email)).toEqual(["rare0@example.test"])
  expect(requests).toBe(10)
}, 20000)

test("large source documents stop at the byte budget before the row budget", async () => {
  const f = await fixture()
  for (let batch = 0; batch < 2; batch++)
    await f.t.run(async (ctx) => {
      for (let i = batch * 20; i < (batch + 1) * 20; i++)
        await ctx.db.insert("contacts", {
          organizationId: f.owner.team,
          email: `large${i}@example.test`,
          firstName: "",
          lastName: "",
          unsubscribed: false,
          properties: { historical: "x".repeat(500000) },
          search: "",
          updatedAt: 0,
        })
    })
  const result = await f.t.run((ctx) =>
    filteredPage(
      stream(ctx.db, schema)
        .query("contacts")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .order("desc"),
      firstPage,
      () => true,
      LOG_SEARCH_BUDGET,
      "large"
    )
  )
  expect(result.page).toHaveLength(9)
  expect(result.isDone).toBe(false)
  expect(result.pageStatus).toBe("SplitRequired")
})

test("templates scan 512 nonmatches but reserve draft bytes only for matches", async () => {
  const rows = source(600)
  let inspected = 0
  const empty = await filteredPage(
    rows,
    firstPage,
    () => {
      inspected++
      return false
    },
    TEMPLATE_SEARCH_BUDGET,
    "missing"
  )
  expect(inspected).toBe(512)
  expect(empty.page).toEqual([])
  expect(empty.isDone).toBe(false)
  const dense = await filteredPage(
    rows,
    firstPage,
    () => true,
    TEMPLATE_SEARCH_BUDGET,
    "row"
  )
  expect(dense.page).toHaveLength(8)
  expect(dense.pageStatus).toBe("SplitRequired")
  const continuation = await filteredPage(
    rows,
    { ...firstPage, cursor: dense.continueCursor },
    () => true,
    TEMPLATE_SEARCH_BUDGET,
    "row"
  )
  expect(continuation.page[0]).toBe("row8")
})
