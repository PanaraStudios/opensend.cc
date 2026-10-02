import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { createNote } from "./contactNotes"
import { TEAM_TABLES } from "./teamCleanup"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
async function setup() {
  const f = await fixture()
  const contacts = await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: f.owner.team,
    contacts: [
      { email: "notes@example.test" },
      { email: "other@example.test" },
    ],
    segmentIds: [],
  })
  const contactId = contacts.createdIds[0]
  const list = (cursor: string | null = null, numItems = 20) =>
    f.owner.client.query(api.contactNotes.list, {
      contactId,
      paginationOpts: { cursor, numItems },
    })
  const create = (body: string) =>
    f.owner.client.mutation(api.contactNotes.create, { contactId, body })
  return { ...f, contactId, otherId: contacts.createdIds[1], list, create }
}
test("notes preserve text, authors and creation order across edits, with native pagination", async () => {
  const f = await setup()
  const first = await f.create("First\n<script>plain text</script>")
  vi.setSystemTime(Date.now() + 10)
  const second = await f.create("Second")
  const page = await f.list(null, 1)
  expect(page.page.map((n) => n._id)).toEqual([second])
  expect(page.isDone).toBe(false)
  expect((await f.list(page.continueCursor, 1)).page.map((n) => n._id)).toEqual(
    [first]
  )
  vi.setSystemTime(Date.now() + 10)
  await f.owner.client.mutation(api.contactNotes.update, {
    id: first,
    body: "Edited",
  })
  const notes = (await f.list()).page
  expect(notes.map((n) => n._id)).toEqual([second, first])
  expect(notes[1]).toMatchObject({
    body: "Edited",
    author: { kind: "user", id: expect.any(String) },
  })
  expect(notes[1].updatedAt).toBeGreaterThan(notes[1].createdAt)
  await f.owner.client.mutation(api.contactNotes.remove, { id: second })
  expect((await f.list()).page.map((n) => n._id)).toEqual([first])
  const events = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .filter((q) => q.eq(q.field("type"), "contact.note_created"))
      .collect()
  )
  expect(events).toHaveLength(2)
  expect(events[0].data).toMatchObject({
    id: first,
    contact_id: f.contactId,
    body: "First\n<script>plain text</script>",
    author: { kind: "user" },
  })
})
test("all dashboard entry points require membership and validate note bodies", async () => {
  const f = await setup()
  const id = await f.create("Private")
  await expect(
    f.outsider.client.query(api.contactNotes.list, {
      contactId: f.contactId,
      paginationOpts: { cursor: null, numItems: 10 },
    })
  ).rejects.toThrow(/permission/i)
  await expect(
    f.outsider.client.mutation(api.contactNotes.create, {
      contactId: f.contactId,
      body: "intrusion",
    })
  ).rejects.toThrow(/permission/i)
  await expect(
    f.outsider.client.mutation(api.contactNotes.update, {
      id,
      body: "intrusion",
    })
  ).rejects.toThrow(/permission/i)
  await expect(
    f.outsider.client.mutation(api.contactNotes.remove, { id })
  ).rejects.toThrow(/permission/i)
  await expect(
    f.t.mutation(api.contactNotes.create, {
      contactId: f.contactId,
      body: "anonymous",
    })
  ).rejects.toThrow(/sign in/i)
  for (const body of ["", " \n ", "a".repeat(10001)]) {
    await expect(f.create(body)).rejects.toThrow(/10000/)
    await expect(
      f.owner.client.mutation(api.contactNotes.update, { id, body })
    ).rejects.toThrow(/10000/)
  }
  await f.create("a".repeat(10000))
})
test("contact deletion drains notes in bounded batches and leaves other contacts' notes", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    const contact = (await ctx.db.get("contacts", f.contactId))!
    for (let i = 0; i < 57; i++)
      await createNote(ctx, contact, {
        body: `Note ${i}`,
        author: { kind: "api" },
      })
  })
  const survivor = await f.owner.client.mutation(api.contactNotes.create, {
    contactId: f.otherId,
    body: "Keep me",
  })
  await f.owner.client.mutation(api.contacts.remove, {
    organizationId: f.owner.team,
    ids: [f.contactId],
  })
  await f.t.mutation(internal.contacts.purge, { contactId: f.contactId })
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("contactNotes")
        .withIndex("by_contactId", (q) => q.eq("contactId", f.contactId))
        .collect()
    )
  ).toEqual([])
  expect(
    await f.t.run((ctx) => ctx.db.get("contactNotes", survivor))
  ).not.toBeNull()
})
test("team retirement erases notes while preserving other organizations", async () => {
  const f = await setup()
  const id = await f.create("Retire me")
  const foreign = await f.outsider.client.mutation(api.contacts.upsert, {
    organizationId: f.outsider.team,
    contacts: [{ email: "foreign@example.test" }],
    segmentIds: [],
  })
  const keep = await f.outsider.client.mutation(api.contactNotes.create, {
    contactId: foreign.createdIds[0],
    body: "Keep",
  })
  await f.t.run((ctx) =>
    ctx.db.insert("teamRetirements", { teamId: f.owner.team })
  )
  await f.t.mutation(internal.teamCleanup.purge, {
    organizationId: f.owner.team,
    table: TEAM_TABLES.indexOf("contactNotes"),
  })
  expect(await f.t.run((ctx) => ctx.db.get("contactNotes", id))).toBeNull()
  expect(
    await f.t.run((ctx) => ctx.db.get("contactNotes", keep))
  ).not.toBeNull()
})
test("note-created events dispatch the note payload to contact automation triggers", async () => {
  const f = await setup()
  const organizationId = f.owner.team
  const automation = await f.owner.client.mutation(api.automations.create, {
    organizationId,
  })
  await f.owner.client.mutation(api.automations.update, {
    organizationId,
    id: automation,
    trigger: "contact.note_created",
    graph: JSON.stringify([
      { key: "wait", type: "delay", duration: "1 minute" },
    ]),
  })
  expect(
    await f.owner.client.mutation(api.automations.setStatus, {
      organizationId,
      id: automation,
      status: "enabled",
    })
  ).toEqual([])
  const noteId = await f.create("Follow up")
  const event = (await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .filter((q) => q.eq(q.field("type"), "contact.note_created"))
      .first()
  ))!
  await f.t.mutation(internal.automationRuntime.dispatch, {
    id: event._id,
    phase: "start",
    cursor: null,
  })
  const run = await f.t.run((ctx) => ctx.db.query("automationRuns").first())
  expect(run).toMatchObject({
    contactId: f.contactId,
    payload: { id: noteId, body: "Follow up", author: { kind: "user" } },
  })
})
