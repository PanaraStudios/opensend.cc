import { afterEach, expect, test, vi } from "vitest"
import { runToCompletion } from "@convex-dev/migrations"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import type { FunctionReturnType } from "convex/server"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow, patchRow } from "./counts"
import { writeLog } from "./logs"
import { parseCsv } from "../lib/dashboard/csv"

const page = { cursor: null, numItems: 2 }
type Fixture = Awaited<ReturnType<typeof fixture>>
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function setup() {
  vi.useFakeTimers()
  return fixture()
}
const start = (
  f: Fixture,
  resource = "domains",
  filters: Record<string, string> = {}
) =>
  f.owner.client.mutation(api.exports.start, {
    organizationId: f.owner.team,
    resource,
    filters,
    summary: [],
  })
const drain = (f: Fixture) =>
  f.t.finishAllScheduledFunctions(() => vi.runAllTimers())
async function csv(f: Fixture, id: Id<"exports">) {
  return f.t.run(async (ctx) => {
    const row = await ctx.db.get("exports", id)
    return (await ctx.storage.get(row!.storageId!))!.text()
  })
}

const headers = {
  domains:
    "id,created_at,name,dkim_status,spf_status,spf_domain,nameserver,disable_content_storage,open_track,click_track,region",
  "api-keys": "id,created_at,name,token,permission,domain,creator",
  logs: "id,created_at,api_key_id,oauth_grant_id,user_agent,method,endpoint,response_status",
  contacts:
    "id,created_at,email,phone,first_name,last_name,unsubscribed,channel_identities",
  segments: "id,created_at,name,contacts",
}
test.each(Object.entries(headers))(
  "%s CSV has the exact headers",
  async (resource, header) => {
    const f = await setup()
    const id = await start(f, resource)
    await drain(f)
    expect((await csv(f, id)).split("\r\n")[0]).toBe(header)
  }
)

test("members start and view, admins download, other teams cannot access exports", async () => {
  const f = await setup()
  const m = await f.actor("member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: f.owner.team,
        userId: m.user._id,
        role: "member",
        createdAt: Date.now(),
      },
    },
  })
  const summary = [{ label: "Status", value: "All statuses" }]
  const args = {
    organizationId: f.owner.team,
    resource: "domains",
    filters: {},
    summary,
  }
  const id = await m.client.mutation(api.exports.start, args)
  await drain(f)
  const row = await m.client.query(api.exports.get, { id })
  expect(row).toMatchObject({
    status: "ready",
    summary,
    creatorEmail: "member@example.test",
    rows: 1,
  })
  expect(row!.fileName).toMatch(/^domains-\d+\.csv$/)
  expect(row).not.toHaveProperty("storageId")
  expect(row).not.toHaveProperty("filters")
  expect(
    (
      await m.client.query(api.exports.list, {
        organizationId: f.owner.team,
        paginationOpts: page,
      })
    ).page
  ).toHaveLength(1)
  expect(
    await m.client.query(api.exports.count, { organizationId: f.owner.team })
  ).toEqual({ total: 1 })
  await expect(m.client.query(api.exports.downloadUrl, { id })).rejects.toThrow(
    "permission"
  )
  expect(
    await f.owner.client.query(api.exports.downloadUrl, { id })
  ).toBeTruthy()
  await expect(
    f.outsider.client.mutation(api.exports.start, args)
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.exports.list, {
      organizationId: f.owner.team,
      paginationOpts: page,
    })
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.exports.count, { organizationId: f.owner.team })
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.exports.get, { id })
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.exports.downloadUrl, { id })
  ).rejects.toThrow("permission")
})

test("filters are stored exactly and invalid requests are rejected", async () => {
  const f = await setup()
  const args = {
    organizationId: f.owner.team,
    resource: "domains",
    filters: { search: "example" },
    summary: [{ label: "Search", value: "example" }],
  }
  const id = await f.owner.client.mutation(api.exports.start, args)
  expect(await f.t.query(internal.exports.job, { id })).toMatchObject({
    filters: args.filters,
    summary: args.summary,
  })
  await expect(
    f.owner.client.mutation(api.exports.start, {
      ...args,
      resource: "__proto__",
    })
  ).rejects.toThrow("cannot be exported")
  await expect(
    f.owner.client.mutation(api.exports.start, {
      ...args,
      summary: Array(21).fill(args.summary[0]),
    })
  ).rejects.toThrow("Too many filters")
  await expect(
    f.owner.client.mutation(api.exports.start, {
      ...args,
      filters: { search: "x".repeat(501) },
    })
  ).rejects.toThrow("too long")
  await drain(f)
})

test("API key export filters, masks secrets and resolves domain and creator", async () => {
  const f = await setup()
  const domains = await f.owner.client.query(api.domains.list, {
    organizationId: f.owner.team,
    paginationOpts: page,
  })
  const domain = domains.page[0]
  const created = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "=cmd", permission: "sending_access", domainId: domain._id },
  })
  await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Excluded", permission: "full_access" },
  })
  await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Theirs", permission: "sending_access" },
  })
  const id = await start(f, "api-keys", { permission: "sending_access" })
  await drain(f)
  const text = await csv(f, id)
  const table = parseCsv(text)
  expect(table.rows).toHaveLength(1)
  expect(table.rows[0][2]).toBe("'=cmd")
  expect(table.rows[0][5]).toBe(domain.name)
  expect(table.rows[0][6]).toBe("owner@example.test")
  expect(table.rows[0][1]).toMatch(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}\+00$/
  )
  expect(text).not.toContain(created.token)
  expect(text).not.toContain("Excluded")
  expect(text).not.toContain("Theirs")
})

test("contacts export honors search, subscription, date and segment with custom properties", async () => {
  const f = await setup()
  const organizationId = f.owner.team
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId,
    name: "Paid customers",
  })
  await f.owner.client.mutation(api.contactProperties.create, {
    organizationId,
    key: "company",
    name: "Company",
    type: "string",
  })
  await f.owner.client.mutation(api.contacts.upsert, {
    organizationId,
    segmentIds: [segmentId],
    contacts: [
      {
        email: "ada@example.test",
        firstName: "Ada",
        lastName: "Lovelace",
        properties: { company: "ACME" },
      },
      { email: "other@example.test", firstName: "Ada", lastName: "Byron" },
      {
        email: "unsubscribed@example.test",
        firstName: "Ada",
        lastName: "Lovelace",
        unsubscribed: true,
      },
    ],
  })
  await f.owner.client.mutation(api.contacts.upsert, {
    organizationId,
    segmentIds: [],
    contacts: [
      { email: "outside@example.test", firstName: "Ada", lastName: "Lovelace" },
    ],
  })
  const filters = {
    search: "Ada Lovelace",
    segmentId,
    unsubscribed: "false",
    from: String(Date.now() - 60000),
    to: String(Date.now() + 60000),
  }
  const id = await start(f, "contacts", filters)
  const emptyId = await start(f, "contacts", {
    from: String(Date.now() + 60000),
  })
  await drain(f)
  const table = parseCsv(await csv(f, id))
  expect(table.headers).toEqual([...headers.contacts.split(","), "company"])
  expect(table.rows).toHaveLength(1)
  expect(table.rows[0].slice(2)).toEqual([
    "ada@example.test",
    "",
    "Ada",
    "Lovelace",
    "false",
    "[]",
    "ACME",
  ])
  expect(parseCsv(await csv(f, emptyId)).rows).toHaveLength(0)
  const foreign = await f.outsider.client.mutation(api.segments.create, {
    organizationId: f.outsider.team,
    name: "Other",
  })
  await expect(
    f.t.query(internal.exports.page, {
      organizationId,
      resource: "contacts",
      filters: { segmentId: foreign },
      extra: [],
      cursor: null,
    })
  ).rejects.toThrow("Segment not found")
})

test("segments export uses whole-query case-insensitive search and counted membership", async () => {
  const f = await setup()
  const organizationId = f.owner.team
  const id = await f.owner.client.mutation(api.segments.create, {
    organizationId,
    name: "Paid customers",
  })
  await f.owner.client.mutation(api.segments.create, {
    organizationId,
    name: "Paid leads",
  })
  await f.owner.client.mutation(api.contacts.upsert, {
    organizationId,
    contacts: [{ email: "a@example.test" }],
    segmentIds: [id],
  })
  const exported = await start(f, "segments", { search: "PAID CUSTOM" })
  await drain(f)
  expect(
    parseCsv(await csv(f, exported)).rows.map((row) => row.slice(2))
  ).toEqual([["Paid customers", "1"]])
})

test("logs retain OAuth attribution and export response_status", async () => {
  const f = await setup()
  await f.t.run((ctx) =>
    writeLog(ctx, f.owner.team, {
      method: "GET",
      path: "/contacts",
      status: 200,
      durationMs: 5,
      userAgent: "test",
      source: "api",
      oauthGrantId: "grant-123",
      requestHeaders: [],
    })
  )
  const id = await start(f, "logs", { source: "api", userAgent: "test" })
  await drain(f)
  const rows = parseCsv(await csv(f, id)).rows
  expect(rows).toHaveLength(1)
  expect(rows[0].slice(2)).toEqual([
    "",
    "grant-123",
    "test",
    "GET",
    "/contacts",
    "200",
  ])
})

test("failed exports stay Failed and cannot download", async () => {
  const f = await setup()
  const id = await start(f)
  await f.t.mutation(internal.exports.finish, { id })
  await drain(f)
  expect(await f.owner.client.query(api.exports.get, { id })).toMatchObject({
    status: "failed",
  })
  expect(await f.owner.client.query(api.exports.downloadUrl, { id })).toBeNull()
})

test("expiry is enforced before cleanup; files and old rows are removed with counts", async () => {
  const f = await setup()
  const id = await start(f)
  await drain(f)
  const old = await f.t.query(internal.exports.job, { id })
  await f.t.run((ctx) =>
    patchRow(ctx, "exports", id, { expiresAt: Date.now() - 1 })
  )
  expect(await f.owner.client.query(api.exports.downloadUrl, { id })).toBeNull()
  expect(await f.owner.client.query(api.exports.get, { id })).toMatchObject({
    status: "expired",
  })
  await f.t.mutation(internal.exports.expire, {})
  expect(await f.t.run((ctx) => ctx.storage.get(old!.storageId!))).toBeNull()
  expect(
    await f.owner.client.query(api.exports.count, {
      organizationId: f.owner.team,
    })
  ).toEqual({ total: 1 })
  await f.t.run((ctx) =>
    patchRow(ctx, "exports", id, { expiresAt: Date.now() - 31 * 86400000 })
  )
  await f.t.mutation(internal.exports.expire, {})
  expect(await f.owner.client.query(api.exports.get, { id })).toBeNull()
  expect(
    await f.owner.client.query(api.exports.count, {
      organizationId: f.owner.team,
    })
  ).toEqual({ total: 0 })
})

test("exports paginate by team and the count backfill is idempotent", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 5; i++)
      await insertRow(ctx, "exports", {
        organizationId: f.owner.team,
        resource: "domains",
        filters: {},
        rows: 0,
        status: "failed",
        expiresAt: Date.now() + 86400000,
      })
    // Simulates an older installation before the counter existed.
    await ctx.db.insert("exports", {
      organizationId: f.owner.team,
      resource: "logs",
      filters: {},
      rows: 0,
      status: "failed",
      expiresAt: Date.now() + 86400000,
    })
  })
  for (let i = 0; i < 2; i++)
    await f.t.action(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.countExports,
        { cursor: null }
      )
    })
  expect(
    await f.owner.client.query(api.exports.count, {
      organizationId: f.owner.team,
    })
  ).toEqual({ total: 6 })
  const ids = new Set<string>()
  let cursor: string | null = null
  for (;;) {
    const result: FunctionReturnType<typeof api.exports.list> =
      await f.owner.client.query(api.exports.list, {
        organizationId: f.owner.team,
        paginationOpts: { ...page, cursor },
      })
    expect(result.page.length).toBeLessThanOrEqual(2)
    for (const row of result.page) ids.add(row._id)
    if (result.isDone) break
    cursor = result.continueCursor
  }
  expect(ids.size).toBe(6)
  expect(
    (
      await f.outsider.client.query(api.exports.list, {
        organizationId: f.outsider.team,
        paginationOpts: page,
      })
    ).page
  ).toEqual([])
})

test("large exports page through every row and invoke the email seam", async () => {
  const f = await setup()
  for (let batch = 0; batch < 3; batch++) {
    await f.t.run(async (ctx) => {
      for (let i = batch * 400; i < Math.min((batch + 1) * 400, 1001); i++) {
        await insertRow(ctx, "contacts", {
          organizationId: f.owner.team,
          email: `contact${i}@example.test`,
          firstName: "",
          lastName: "",
          unsubscribed: false,
          properties: {},
          search: `contact${i}@example.test`,
          updatedAt: Date.now(),
        })
      }
    })
  }
  const id = await start(f, "contacts")
  await drain(f)
  expect(await f.owner.client.query(api.exports.get, { id })).toMatchObject({
    status: "ready",
    rows: 1001,
  })
  const rows = parseCsv(await csv(f, id)).rows
  expect(new Set(rows.map((row) => row[2])).size).toBe(1001)
  const scheduled = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect()
  )
  expect(
    scheduled.some(
      (job) =>
        job.name === "exports:emailCreator" && job.state.kind === "success"
    )
  ).toBe(true)
})

test("domain exports honor the visible filters and map DNS fields", async () => {
  const f = await setup()
  const organizationId = f.owner.team
  const { page: domains } = await f.owner.client.query(api.domains.list, {
    organizationId,
    paginationOpts: page,
  })
  const domain = domains[0]
  const id = await start(f, "domains", {
    search: domain.name.slice(0, 3),
    status: domain.status,
    region: domain.region,
  })
  const excluded = await start(f, "domains", { search: "nonexistent" })
  await drain(f)
  const table = parseCsv(await csv(f, id))
  expect(table.rows).toHaveLength(1)
  expect(table.rows[0][2]).toBe(domain.name)
  expect(table.rows[0][5]).toBe(`${domain.customReturnPath}.${domain.name}`)
  expect(table.rows[0].slice(7)).toEqual([
    "false",
    "false",
    "false",
    domain.region,
  ])
  expect(parseCsv(await csv(f, excluded)).rows).toEqual([])
})

test("contact CSV retains phone and all scoped channel identities, excluding other teams and merged identities", async () => {
  const f = await setup()
  const { createdIds } = await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: f.owner.team,
    segmentIds: [],
    contacts: [{ phone: "+15551234567", firstName: "Ada" }],
  })
  const id = createdIds[0]
  const channelOnlyId = await f.t.run(async (ctx) => {
    for (const channel of ["whatsapp", "messenger", "instagram"] as const)
      await ctx.db.insert("channelContacts", {
        organizationId: f.owner.team,
        contactId: id,
        channel,
        scopeId: `${channel}-sender`,
        externalId: `${channel}-recipient`,
        marketingOptOut: false,
        username: "ada",
        profileName: "Ada",
      })
    const canonical = await ctx.db
      .query("channelContacts")
      .withIndex("by_contactId", (q) => q.eq("contactId", id))
      .first()
    await ctx.db.insert("channelContacts", {
      organizationId: f.owner.team,
      contactId: id,
      channel: "messenger",
      scopeId: "old",
      externalId: "merged-private",
      mergedIntoId: canonical!._id,
      marketingOptOut: false,
    })
    const channelOnlyId = await insertRow(ctx, "contacts", {
      organizationId: f.owner.team,
      firstName: "",
      lastName: "",
      search: "Grace",
      updatedAt: Date.now(),
      unsubscribed: false,
      properties: {},
    })
    await ctx.db.insert("channelContacts", {
      organizationId: f.owner.team,
      contactId: channelOnlyId,
      channel: "instagram",
      scopeId: "instagram-sender",
      externalId: "channel-only",
      profileName: "Grace",
      marketingOptOut: false,
    })
    await ctx.db.insert("channelContacts", {
      organizationId: f.outsider.team,
      contactId: id,
      channel: "instagram",
      scopeId: "foreign",
      externalId: "private",
      marketingOptOut: false,
    })
    return channelOnlyId
  })
  const exportId = await start(f, "contacts")
  await drain(f)
  const table = parseCsv(await csv(f, exportId))
  const row = table.rows.find((row) => row[0] === id)!
  expect(row[table.headers.indexOf("phone")]).toBe("'+15551234567")
  const identities = JSON.parse(
    row[table.headers.indexOf("channel_identities")]
  )
  expect(
    identities.map((identity: { channel: string }) => identity.channel)
  ).toEqual(["whatsapp", "messenger", "instagram"])
  expect(identities).toContainEqual({
    channel: "instagram",
    scope_id: "instagram-sender",
    external_id: "instagram-recipient",
    username: "ada",
    profile_name: "Ada",
  })
  expect(JSON.stringify(identities)).not.toContain("private")
  const channelOnlyRow = table.rows.find((row) => row[0] === channelOnlyId)!
  expect(channelOnlyRow[table.headers.indexOf("email")]).toBe("")
  expect(channelOnlyRow[table.headers.indexOf("phone")]).toBe("")
  expect(
    JSON.parse(channelOnlyRow[table.headers.indexOf("channel_identities")])[0]
  ).toMatchObject({ channel: "instagram", profile_name: "Grace" })
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.owner.team,
    name: "Phone customers",
  })
  await f.owner.client.mutation(api.contacts.addToSegments, {
    organizationId: f.owner.team,
    ids: [id, channelOnlyId],
    segmentIds: [segmentId],
  })
  expect(
    (
      await f.owner.client.query(api.contacts.list, {
        organizationId: f.owner.team,
        segmentId,
        paginationOpts: page,
      })
    ).page.map((contact) => contact._id)
  ).toEqual(expect.arrayContaining([id, channelOnlyId]))
})
