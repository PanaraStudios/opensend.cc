import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, components, internal } from "./_generated/api"
import { createAuth } from "./auth"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow } from "./counts"
import { EXPORT_SOURCES } from "./exportSources"
import { MAX_BYTES, MAX_ROWS } from "./exports"
import { listProperties } from "./audience"
import type { Id } from "./_generated/dataModel"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.opensend.test")
  vi.stubEnv("BETTER_AUTH_SECRET", "lane-seven-test-secret-at-least-thirty-two")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test.each(["verify", "reset", "change-email", "invite"] as const)(
  "%s links are logged only for the bootstrap admin without a sender",
  async (kind) => {
    const f = await fixture()
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await f.t.mutation(internal.systemEmail.send, {
      to: f.owner.user.email,
      kind,
      url: "https://opensend.test/secret",
    })
    expect(log).toHaveBeenCalledOnce()
    log.mockClear()
    await expect(
      f.t.mutation(internal.systemEmail.send, {
        to: f.outsider.user.email,
        kind,
        url: "https://opensend.test/private",
      })
    ).rejects.toThrow("Account email isn't set up yet")
    expect(log).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      "Account email withheld: no system sender"
    )
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/outsider|private/)
  }
)

test("a configured sender queues account email without logging its link", async () => {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  await f.t.run(async (ctx) => {
    await ctx.db.patch("domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "test",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true },
    })
    await ctx.db.patch("installation", f.installation, {
      systemSender: { domainId: f.domain, from: "hi@mail.example.test" },
    })
  })
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  await f.t.mutation(internal.systemEmail.send, {
    to: f.outsider.user.email,
    kind: "reset",
    url: "https://opensend.test/private",
  })
  expect(log).not.toHaveBeenCalled()
  expect(await f.t.run((ctx) => ctx.db.query("emails").collect())).toHaveLength(
    1
  )
})

test("operator recovery returns a working one-use Better Auth reset link without logs", async () => {
  const f = await fixture()
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  const link = await f.t.action(internal.accountRecovery.resetPassword, {
    email: f.outsider.user.email,
  })
  const token = new URL(link).pathname.split("/").pop()!
  const reset = () =>
    f.t.action((ctx) =>
      createAuth(ctx).api.resetPassword({
        body: { token, newPassword: "brand-new-password123" },
      })
    )
  expect(await reset()).toMatchObject({ status: true })
  await expect(reset()).rejects.toThrow()
  await expect(
    f.t.action(internal.accountRecovery.resetPassword, {
      email: "unknown@example.com",
    })
  ).rejects.toThrow("Unable to create")
  expect(
    JSON.stringify([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls])
  ).not.toMatch(/unknown|outsider|reset-password/)
})

test("CSV jobs admit plain members, isolate teams, validate rows and survive duplicate workers", async () => {
  const f = await fixture()
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
  const args = {
    organizationId: f.owner.team,
    csvImport: true,
    contacts: [{ email: "a@example.com" }, { email: "invalid" }],
    segmentIds: [],
  }
  await expect(
    f.outsider.client.mutation(api.contacts.upsert, args)
  ).rejects.toThrow("permission")
  const result = await member.client.mutation(api.contacts.upsert, args)
  expect(result.jobId).toBeDefined()
  expect(result.created).toBe(0)
  const id = result.jobId!
  await expect(
    f.outsider.client.query(api.contactImports.get, { id })
  ).rejects.toThrow("permission")
  await f.t.mutation(internal.contactImports.run, { id, offset: 0 })
  await f.t.mutation(internal.contactImports.run, { id, offset: 0 })
  const job = await member.client.query(api.contactImports.get, { id })
  expect(job).toMatchObject({
    status: "completed",
    offset: 2,
    result: { created: 1, skipped: 1 },
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("contacts").collect())
  ).toHaveLength(1)
  expect(await f.t.run((ctx) => ctx.db.query("events").collect())).toHaveLength(
    0
  )
})

test("combined contact and segment cost reduces each job transaction", async () => {
  const f = await fixture()
  const segmentIds = await f.t.run(async (ctx) => {
    const ids: Id<"segments">[] = []
    for (let i = 0; i < 10; i++)
      ids.push(
        await insertRow(ctx, "segments", {
          organizationId: f.owner.team,
          name: String(i),
        })
      )
    return ids
  })
  const result = await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: f.owner.team,
    csvImport: true,
    segmentIds,
    contacts: Array.from({ length: 100 }, (_, i) => ({
      email: `${i}@example.com`,
    })),
  })
  await f.t.mutation(internal.contactImports.step, {
    id: result.jobId!,
    offset: 0,
  })
  expect(
    await f.owner.client.query(api.contactImports.get, { id: result.jobId! })
  ).toMatchObject({ offset: 50, status: "processing", result: { created: 50 } })
  await f.t.mutation(internal.contactImports.step, {
    id: result.jobId!,
    offset: 50,
  })
  expect(
    await f.owner.client.query(api.contactImports.get, { id: result.jobId! })
  ).toMatchObject({
    offset: 100,
    status: "completed",
    result: { created: 100 },
  })
})

test("failed imports are readable and retired teams cannot be recreated", async () => {
  const f = await fixture()
  const segment = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.owner.team,
    name: "Gone",
  })
  const start = () =>
    f.owner.client.mutation(api.contacts.upsert, {
      organizationId: f.owner.team,
      csvImport: true,
      segmentIds: [segment],
      contacts: [{ email: "a@example.com" }],
    })
  const first = await start()
  const second = await start()
  await f.owner.client.mutation(api.segments.remove, { id: segment })
  await f.t.mutation(internal.contactImports.run, {
    id: first.jobId!,
    offset: 0,
  })
  expect(
    await f.owner.client.query(api.contactImports.get, { id: first.jobId! })
  ).toMatchObject({
    status: "failed",
    error: expect.stringContaining("Import could not"),
  })
  await f.t.run((ctx) =>
    ctx.db.insert("teamRetirements", { teamId: f.owner.team })
  )
  await f.t.mutation(internal.contactImports.run, {
    id: second.jobId!,
    offset: 0,
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("contacts").collect())
  ).toHaveLength(0)
})

test("active property lookup and duplicate detection work beyond 200 tombstones", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 210; i++)
      await insertRow(ctx, "contactProperties", {
        organizationId: f.owner.team,
        name: `old${i}`,
        key: `old${i}`,
        type: "string",
        deleting: true,
      })
    await insertRow(ctx, "contactProperties", {
      organizationId: f.owner.team,
      name: "Current",
      key: "zzcurrent",
      type: "string",
    })
  })
  expect(
    (await f.t.run((ctx) => listProperties(ctx, f.owner.team))).map(
      (row) => row.key
    )
  ).toEqual(["zzcurrent"])
  const create = (key: string) =>
    f.owner.client.mutation(api.contactProperties.create, {
      organizationId: f.owner.team,
      name: key,
      key,
      type: "string",
    })
  await expect(create("zzcurrent")).rejects.toThrow()
  await expect(create("old209")).rejects.toThrow()
  await expect(create("newkey")).resolves.toBeDefined()
})

test("metrics reject oversized queries but every existing day preset fits", async () => {
  const f = await fixture()
  const from = Math.floor(Date.now() / DAY) * DAY
  for (const days of [1, 3, 7, 15, 30, 31]) {
    const spans = Array.from({ length: days }, (_, i) => ({
      from: from + i * DAY,
      to: from + (i + 1) * DAY - 1,
    }))
    expect(
      await f.owner.client.query(api.metrics.summary, {
        organizationId: f.owner.team,
        spans,
      })
    ).toHaveLength(days)
  }
  await expect(
    f.owner.client.query(api.metrics.summary, {
      organizationId: f.owner.team,
      spans: [{ from, to: from + 90 * DAY - 1 }],
    })
  ).rejects.toThrow("31 days")
  await expect(
    f.owner.client.query(api.metrics.summary, {
      organizationId: f.owner.team,
      spans: [{ from: from + 1, to: from + DAY - 1 }],
    })
  ).rejects.toThrow("Invalid metrics")
})
const DAY = 86_400_000

test.each(["rows", "bytes"])(
  "exports fail readably at the %s cap without publishing a partial file",
  async (limit) => {
    const f = await fixture()
    const pages =
      limit === "rows"
        ? Math.ceil(MAX_ROWS / 500) + 1
        : Math.ceil(MAX_BYTES / (512 * 1024)) + 1
    let calls = 0
    vi.spyOn(EXPORT_SOURCES.contacts, "page").mockImplementation(async () => ({
      rows:
        limit === "rows"
          ? Array.from({ length: 500 }, () => ["a"])
          : [["é".repeat(256 * 1024)]],
      isDone: ++calls === pages,
      continueCursor: String(calls),
    }))
    const id = await f.owner.client.mutation(api.exports.start, {
      organizationId: f.owner.team,
      resource: "contacts",
      filters: {},
      summary: [],
    })
    await f.t.action(internal.exports.run, { id })
    expect(await f.owner.client.query(api.exports.get, { id })).toMatchObject({
      status: "failed",
      error: expect.stringContaining(
        limit === "rows" ? "200,000 rows" : "16 MiB"
      ),
    })
    expect(
      (await f.t.run((ctx) => ctx.db.get("exports", id)))?.storageId
    ).toBeUndefined()
  }
)

test("the reset HTTP flow keeps its generic response while withholding non-bootstrap links", async () => {
  const f = await fixture()
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  const response = await f.t.fetch("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: f.outsider.user.email,
      redirectTo: "https://opensend.test/reset-password",
    }),
  })
  // Better Auth deliberately swallows delivery errors on this anti-enumeration endpoint.
  expect(response.status).toBe(200)
  expect(warning).toHaveBeenCalledWith(
    "Account email withheld: no system sender"
  )
  expect(log).not.toHaveBeenCalled()
  expect(JSON.stringify(error.mock.calls)).not.toMatch(
    /outsider|reset-password/
  )
})
