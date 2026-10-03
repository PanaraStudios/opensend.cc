import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { PaginationOptions } from "convex/server"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { insertRow, patchRow } from "./counts"
import { inboundFixture } from "./testHelpers/meta.fixture"
import type { Channel } from "../lib/channels"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** The fixture's domain and WhatsApp number, plus a Page, an Instagram
    account and a second domain, created a second apart in that order. */
async function setup() {
  const f = await inboundFixture()
  const account = await f.t.run((ctx) => ctx.db.get(f.account))
  const later = async <T>(insert: () => Promise<T>) => {
    vi.advanceTimersByTime(1000)
    return insert()
  }
  const page = await later(() =>
    f.t.run((ctx) =>
      insertRow(ctx, "channelAccounts", {
        organizationId: f.owner.team,
        channel: "messenger",
        externalId: "555000100",
        connectionId: account!.connectionId,
        displayName: "Acme Page",
        handle: "Acme Page",
        status: "active",
        throughputMps: 80,
      })
    )
  )
  await later(() =>
    f.t.run((ctx) =>
      insertRow(ctx, "channelAccounts", {
        organizationId: f.owner.team,
        channel: "instagram",
        externalId: "178414000001",
        connectionId: account!.connectionId,
        displayName: "Acme Instagram",
        handle: "acme",
        status: "active",
        throughputMps: 80,
      })
    )
  )
  const { _id, _creationTime, ...domain } = (await f.t.run((ctx) =>
    ctx.db.get(f.domain)
  ))!
  void _id
  void _creationTime
  await later(() =>
    f.t.run((ctx) =>
      insertRow(ctx, "domains", { ...domain, name: "news.example.test" })
    )
  )
  const list = (
    args: { channel?: Channel; search?: string } = {},
    paginationOpts: PaginationOptions = { cursor: null, numItems: 10 }
  ) =>
    f.owner.client.query(api.channels.senders.list, {
      organizationId: f.owner.team,
      paginationOpts,
      ...args,
    })
  const count = (args: { channel?: Channel; search?: string } = {}) =>
    f.owner.client.query(api.channels.senders.count, {
      organizationId: f.owner.team,
      ...args,
    })
  return { ...f, page: page as Id<"channelAccounts">, list, count }
}

const names = (
  page: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["list"]>>["page"]
) =>
  page.map((row) =>
    row.kind === "domain" ? row.domain.name : row.account.displayName
  )

test("lists domains and channel accounts in one newest-first list", async () => {
  const f = await setup()
  const result = await f.list()
  expect(names(result.page)).toEqual([
    "news.example.test",
    "Acme Instagram",
    "Acme Page",
    "Lucky Shrub",
    "mail.example.test",
  ])
  expect(result.isDone).toBe(true)
  const account = result.page.find((row) => row.kind === "account")
  expect(account?.kind === "account" && account.account.businessName).toBe(
    "Test"
  )
  expect(
    account?.kind === "account" && "encryptedToken" in account.account
  ).toBe(false)
  expect(await f.count()).toEqual({ total: 5 })
})

test("pages through the merged streams with one stable cursor", async () => {
  const f = await setup()
  const seen: string[] = []
  let cursor: string | null = null
  for (let i = 0; i < 10; i++) {
    const result: Awaited<ReturnType<typeof f.list>> = await f.list(
      {},
      { cursor, numItems: 2 }
    )
    seen.push(...names(result.page))
    if (result.isDone) break
    cursor = result.continueCursor
  }
  expect(seen).toEqual([
    "news.example.test",
    "Acme Instagram",
    "Acme Page",
    "Lucky Shrub",
    "mail.example.test",
  ])
})

test("filters by channel and searches names and handles", async () => {
  const f = await setup()
  expect(names((await f.list({ channel: "email" })).page)).toEqual([
    "news.example.test",
    "mail.example.test",
  ])
  expect(await f.count({ channel: "email" })).toEqual({ total: 2 })
  expect(names((await f.list({ channel: "messenger" })).page)).toEqual([
    "Acme Page",
  ])
  expect(await f.count({ channel: "whatsapp" })).toEqual({ total: 1 })
  expect(names((await f.list({ search: "ACME" })).page)).toEqual([
    "Acme Instagram",
    "Acme Page",
  ])
  expect(names((await f.list({ search: "+1555" })).page)).toEqual([
    "Lucky Shrub",
  ])
  expect(names((await f.list({ search: "news." })).page)).toEqual([
    "news.example.test",
  ])
  expect(await f.count({ search: "acme" })).toEqual({ total: null })
})

test("leaves out deleted domains and disconnected accounts", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "domains", f.domain, { deleted: true })
    await patchRow(ctx, "channelAccounts", f.page, {
      status: "disconnected",
      disconnectedAt: Date.now(),
    })
  })
  expect(names((await f.list()).page)).toEqual([
    "news.example.test",
    "Acme Instagram",
    "Lucky Shrub",
  ])
  expect(await f.count()).toEqual({ total: 3 })
})

test("an outsider cannot read another team's channels", async () => {
  const f = await setup()
  await expect(
    f.outsider.client.query(api.channels.senders.list, {
      organizationId: f.owner.team,
      paginationOpts: { cursor: null, numItems: 10 },
    })
  ).rejects.toThrow()
})
