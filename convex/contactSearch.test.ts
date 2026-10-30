/// <reference types="vite/client" />
import { expect, test } from "vitest"
import { runToCompletion } from "@convex-dev/migrations"
import { api, components, internal } from "./_generated/api"
import type { ActionCtx } from "./_generated/server"
import { setMembership } from "./audience"
import { insertRow } from "./counts"
import { EXPORT_SOURCES } from "./exportSources"
import { fixture } from "./testHelpers/ses.fixture"

const firstPage = { cursor: null, numItems: 40 }

async function setup() {
  const f = await fixture()
  const organizationId = f.owner.team
  await f.owner.client.mutation(api.contacts.upsert, {
    organizationId,
    segmentIds: [],
    contacts: [
      {
        email: "jane.doe@example.test",
        firstName: "Jane",
        lastName: "Doe",
      },
      { phone: "+1 (415) 555-2671", firstName: "Sam", lastName: "Hill" },
      {
        phone: "+44 7911 123456",
        firstName: "Olivia",
        lastName: "Brown",
        unsubscribed: true,
      },
      { email: "mary.janesson@example.test", firstName: "Mary" },
    ],
  })
  // Written before phone endings were part of the search text.
  const legacy = await f.t.run((ctx) =>
    insertRow(ctx, "contacts", {
      organizationId,
      phone: "+919876543210",
      firstName: "Ravi",
      lastName: "Kumar",
      unsubscribed: false,
      properties: {},
      search: "+919876543210 919876543210 Ravi Kumar",
      updatedAt: Date.now(),
    })
  )
  const names = async (search: string, unsubscribed?: boolean) => {
    const result = await f.owner.client.query(api.contacts.list, {
      organizationId,
      search,
      unsubscribed,
      paginationOpts: firstPage,
    })
    return result.page.map((row) => row.firstName).sort()
  }
  const backfill = () =>
    f.t.action((ctx: ActionCtx) =>
      runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.indexContactSearch
      )
    )
  return { ...f, organizationId, legacy, names, backfill }
}

test("search finds a contact not yet backfilled, then reads the index", async () => {
  const f = await setup()
  // Before the backfill, search scans as it did, so the ending still matches.
  expect(await f.names("543210")).toEqual(["Ravi"])
  expect(await f.names("ane")).toEqual(["Jane", "Mary"])
  await f.backfill()
  const legacy = await f.t.run((ctx) => ctx.db.get("contacts", f.legacy))
  expect(legacy?.search.split(" ")).toEqual(
    expect.arrayContaining(["9876543210", "3210"])
  )
  expect(await f.names("543210")).toEqual(["Ravi"])
  expect(await f.names("98765 43210")).toEqual(["Ravi"])
  // Word prefixes now, not any substring.
  expect(await f.names("ane")).toEqual([])
})

test("search by name, email, full phone and phone ending through the index", async () => {
  const f = await setup()
  await f.backfill()
  expect(await f.names("jane")).toEqual(["Jane", "Mary"])
  expect(await f.names("JANE DO")).toEqual(["Jane"])
  expect(await f.names("Doe Jane")).toEqual(["Jane"])
  expect(await f.names("jane do@nowhere")).toEqual([])
  // A whole email is one point read on the email index.
  expect(await f.names("Jane.Doe@example.test")).toEqual(["Jane"])
  expect(await f.names("example")).toEqual(["Jane", "Mary"])
  expect(await f.names("@example.")).toEqual(["Jane", "Mary"])
  // A whole number with its country code, however it is written.
  expect(await f.names("+1 415-555-2671")).toEqual(["Sam"])
  expect(await f.names("14155552671")).toEqual(["Sam"])
  // A national number or ending in any country, trunk "0" or "00" included.
  expect(await f.names("(415) 555-2671")).toEqual(["Sam"])
  expect(await f.names("2671")).toEqual(["Sam"])
  expect(await f.names("555 2671")).toEqual(["Sam"])
  expect(await f.names("07911 123456")).toEqual(["Olivia"])
  expect(await f.names("00447911123456")).toEqual(["Olivia"])
  // Partly typed: the zero-stripped run is the last term, the one Convex
  // matches as a prefix (see contact-search.test.ts for the term order).
  expect(await f.names("07911 12")).toEqual(["Olivia"])
  expect(await f.names("0044 7911 12")).toEqual(["Olivia"])
  expect(await f.names("123456")).toEqual(["Olivia"])
  // A run of digits inside the number is the start of one of its endings.
  expect(await f.names("5552")).toEqual(["Sam"])
  expect(await f.names("0000")).toEqual([])
  // The unsubscribed filter is a filter field of the index.
  expect(await f.names("123456", true)).toEqual(["Olivia"])
  expect(await f.names("123456", false)).toEqual([])
  expect(await f.names("+44 7911 123456", false)).toEqual([])
  expect(await f.names("@")).toEqual([])
  // Another team's contacts never match.
  const other = await f.outsider.client.query(api.contacts.list, {
    organizationId: f.outsider.team,
    search: "jane",
    paginationOpts: firstPage,
  })
  expect(other.page).toEqual([])
})

test("a search page reads matches, not the team's whole contact list", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 1100; i++)
      await insertRow(ctx, "contacts", {
        organizationId: f.organizationId,
        email: `filler${i}@example.test`,
        firstName: "",
        lastName: "",
        unsubscribed: false,
        properties: {},
        search: `filler${i}@example.test filler${i} example test`,
        updatedAt: Date.now(),
      })
  })
  const read = () =>
    f.owner.client.query(api.contacts.list, {
      organizationId: f.organizationId,
      search: "4155552671",
      paginationOpts: firstPage,
    })
  // The match is among the oldest contacts: the scan reads its 1,024-row
  // budget of newer ones and comes back with an empty page.
  const scanned = await read()
  expect(scanned.page).toEqual([])
  expect(scanned.isDone).toBe(false)
  await f.backfill()
  const result = await read()
  expect(result.page.map((row) => row.firstName)).toEqual(["Sam"])
  expect(result.isDone).toBe(true)
})

test("an export with a search holds what the list shows, scanned in full", async () => {
  const f = await setup()
  const exported = async (search: string) => {
    const result = await f.t.run((ctx) =>
      EXPORT_SOURCES.contacts.page(
        ctx,
        f.organizationId,
        { search },
        firstPage,
        []
      )
    )
    return result.rows.map((row) => String(row[4])).sort()
  }
  // Before the backfill both the list and the export match substrings.
  expect(await exported("ane")).toEqual(["Jane", "Mary"])
  await f.backfill()
  for (const search of [
    "ane",
    "jane",
    "(415) 555-2671",
    "07911 12",
    "Jane.Doe@example.test",
    "+1 415 555 2671",
    "@",
  ])
    expect(await exported(search)).toEqual(await f.names(search))
  expect(await exported("(415) 555-2671")).toEqual(["Sam"])
  expect(await exported("ane")).toEqual([])
})

test("a search with a segment or date filter scans with the list's test", async () => {
  const f = await setup()
  await f.backfill()
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.organizationId,
    name: "VIP",
  })
  // Sam and Jane join the segment; Mary, who also matches "jane", does not.
  const members = await f.t.run(async (ctx) => {
    const joined = []
    for (const contact of await ctx.db.query("contacts").collect())
      if (contact.firstName === "Sam" || contact.firstName === "Jane") {
        await setMembership(ctx, contact, segmentId, true)
        joined.push(contact.firstName)
      }
    return joined.sort()
  })
  expect(members).toEqual(["Jane", "Sam"])
  const list = async (filters: {
    search: string
    segmentId?: typeof segmentId
    from?: number
    to?: number
  }) => {
    const result = await f.owner.client.query(api.contacts.list, {
      organizationId: f.organizationId,
      ...filters,
      paginationOpts: firstPage,
    })
    return result.page.map((row) => row.firstName).sort()
  }
  // A formatted number is no substring of "+14155552671": only the new test
  // finds Sam, through the scan of the segment's team.
  expect(await list({ search: "(415) 555-2671", segmentId })).toEqual(["Sam"])
  expect(await list({ search: "jane", segmentId })).toEqual(["Jane"])
  expect(await list({ search: "ane", segmentId })).toEqual([])
  expect(await list({ search: "07911 12", segmentId })).toEqual([])
  expect(await list({ search: "jane", from: 0, to: Date.now() + 1 })).toEqual([
    "Jane",
    "Mary",
  ])
  expect(await list({ search: "ane", from: 0, to: Date.now() + 1 })).toEqual([])
  expect(await list({ search: "07911 12", from: Date.now() + 60_000 })).toEqual(
    []
  )
})
