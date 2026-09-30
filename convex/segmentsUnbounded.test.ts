/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { insertRow } from "./counts"
import {
  EVENT_SEGMENT_IDS,
  MEMBERSHIP_BATCH,
  SEGMENT_INPUT_LIMIT,
} from "./audience"
import { fixture } from "./testHelpers/ses.fixture"

/* A team has no segment limit: nothing reads all of its segments, or all
   of a contact's, in one transaction. These seed past the old 500 cap and
   past one transaction's membership share. */

const OLD_CAP = 500

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-09-29T00:00:00Z") }))
afterEach(() => vi.useRealTimers())

async function setup(segmentCount: number) {
  const f = await fixture()
  const org = f.owner.team
  const segments = await f.t.run(async (ctx) => {
    const ids: Id<"segments">[] = []
    for (let i = 0; i < segmentCount; i++)
      ids.push(
        await insertRow(ctx, "segments", {
          organizationId: org,
          name: `Segment ${String(i).padStart(4, "0")}`,
        })
      )
    return ids
  })
  const drain = () => f.t.finishAllScheduledFunctions(vi.runAllTimers)
  const events = (type: string) =>
    f.t.run((ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_organizationId_and_type", (q) =>
          q.eq("organizationId", org).eq("type", type)
        )
        .collect()
    )
  const memberships = (contactId: Id<"contacts">) =>
    f.t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("segmentMembers")
            .withIndex("by_contactId", (q) => q.eq("contactId", contactId))
            .collect()
        ).length
    )
  return { f, org, owner: f.owner.client, segments, drain, events, memberships }
}

test("a team creates segments past the old cap; usage reports no limit", async () => {
  const { org, owner, segments } = await setup(OLD_CAP)
  const id = await owner.mutation(api.segments.create, {
    organizationId: org,
    name: "One more",
  })
  expect(await owner.query(api.segments.get, { id })).toMatchObject({
    name: "One more",
  })
  const { usage } = await owner.query(api.usage.get, { organizationId: org })
  expect(usage.segments).toEqual({ used: segments.length + 1, limit: null })
}, 60_000)

test("pickers suggest, search and resolve a selection beyond the first page", async () => {
  const { org, owner, segments } = await setup(OLD_CAP + 20)
  const first = await owner.query(api.segments.options, { organizationId: org })
  expect(first).toHaveLength(20)
  // The oldest segment is far past the newest-first suggestions.
  expect(first.some((row) => row._id === segments[0])).toBe(false)
  const found = await owner.query(api.segments.options, {
    organizationId: org,
    search: "Segment 0000",
  })
  expect(found.map((row) => row._id)).toContain(segments[0])
  const selected = await owner.query(api.segments.options, {
    organizationId: org,
    selectedId: segments[0],
  })
  expect(selected).toHaveLength(20)
  expect(selected.at(-1)).toMatchObject({
    _id: segments[0],
    name: "Segment 0000",
    memberCount: 0,
  })
}, 60_000)

test("a contact joins more segments than one transaction writes, in steps, with one event", async () => {
  const { org, owner, segments, drain, events, memberships } = await setup(
    OLD_CAP + 100
  )
  const created = await owner.mutation(api.contacts.upsert, {
    organizationId: org,
    contacts: [{ email: "many@example.test" }, { email: "few@example.test" }],
    segmentIds: segments,
  })
  const [many, few] = created.createdIds // both join every segment
  // The first transaction wrote only its share; the rest are scheduled.
  expect((await memberships(many)) + (await memberships(few))).toBe(
    MEMBERSHIP_BATCH
  )
  await drain()
  expect(await memberships(many)).toBe(segments.length)
  expect(await memberships(few)).toBe(segments.length)
  const createdEvents = await events("contact.created")
  expect(createdEvents).toHaveLength(2)
  for (const event of createdEvents)
    expect((event.data as { segment_ids: string[] }).segment_ids).toHaveLength(
      EVENT_SEGMENT_IDS
    )
  // Joining the same segments again changes nothing and emits nothing.
  await owner.mutation(api.contacts.addToSegments, {
    organizationId: org,
    ids: [many],
    segmentIds: segments,
  })
  await drain()
  expect(await events("contact.updated")).toHaveLength(0)
  // A contact already stored joins them later with one update event.
  const later = await addContact(owner, org, "later@example.test")
  await owner.mutation(api.contacts.addToSegments, {
    organizationId: org,
    ids: [later],
    segmentIds: segments,
  })
  await drain()
  expect(await memberships(later)).toBe(segments.length)
  const updated = await events("contact.updated")
  expect(updated).toHaveLength(1)
  expect(
    (updated[0].data as { segment_ids: string[] }).segment_ids
  ).toHaveLength(EVENT_SEGMENT_IDS)

  // The contact's segments page through the server, newest joined first.
  const seen = new Set<string>()
  let cursor: string | null = null
  for (;;) {
    const result: {
      page: { _id: Id<"segments"> }[]
      isDone: boolean
      continueCursor: string
    } = await owner.query(api.contacts.segments, {
      id: many,
      paginationOpts: { cursor, numItems: 100 },
    })
    for (const row of result.page) seen.add(row._id)
    if (result.isDone) break
    cursor = result.continueCursor
  }
  expect(seen.size).toBe(segments.length)
  // List and detail rows no longer carry every membership.
  const detail = await owner.query(api.contacts.get, { id: many })
  expect(detail).not.toHaveProperty("segmentIds")
  // A page of contacts checks membership in one segment.
  const outsider = await addContact(owner, org, "outside@example.test")
  expect(
    await owner.query(api.segments.memberIds, {
      id: segments[0],
      contactIds: [many, outsider, few],
    })
  ).toEqual([many, few])
}, 120_000)

test("a segment deleted while a contact is still joining is skipped", async () => {
  const { org, owner, segments, drain, memberships } = await setup(
    MEMBERSHIP_BATCH + 10
  )
  const { createdIds } = await owner.mutation(api.contacts.upsert, {
    organizationId: org,
    contacts: [{ email: "late@example.test" }],
    segmentIds: segments,
  })
  await owner.mutation(api.segments.remove, { id: segments.at(-1)! })
  await drain()
  expect(await memberships(createdIds[0])).toBe(segments.length - 1)
}, 60_000)

test("a request names at most the segment input limit", async () => {
  const { f, org, owner, segments } = await setup(1)
  // Repeats count once.
  await owner.mutation(api.contacts.upsert, {
    organizationId: org,
    contacts: [{ email: "dupes@example.test" }],
    segmentIds: Array.from(
      { length: SEGMENT_INPUT_LIMIT + 1 },
      () => segments[0]
    ),
  })
  const distinct = await f.t.run(async (ctx) => {
    const ids: Id<"segments">[] = []
    for (let i = 0; i <= SEGMENT_INPUT_LIMIT; i++)
      ids.push(
        await ctx.db.insert("segments", { organizationId: org, name: `${i}` })
      )
    return ids
  })
  await expect(
    owner.mutation(api.contacts.upsert, {
      organizationId: org,
      contacts: [{ email: "limit@example.test" }],
      segmentIds: distinct,
    })
  ).rejects.toThrow(`Choose at most ${SEGMENT_INPUT_LIMIT} segments`)
  await expect(
    owner.mutation(api.contacts.addToSegments, {
      organizationId: org,
      ids: [],
      segmentIds: distinct,
    })
  ).rejects.toThrow(`Choose at most ${SEGMENT_INPUT_LIMIT} segments`)
}, 60_000)

async function addContact(
  owner: Awaited<ReturnType<typeof fixture>>["owner"]["client"],
  organizationId: string,
  email: string
) {
  const { createdIds } = await owner.mutation(api.contacts.upsert, {
    organizationId,
    contacts: [{ email }],
    segmentIds: [],
  })
  return createdIds[0]
}
