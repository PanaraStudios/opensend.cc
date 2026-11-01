import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { EXPORT_SOURCES } from "./exportSources"
import {
  SEGMENT_DELETED,
  TOPIC_DELETED,
  addImportError,
  enqueueImport,
} from "./contactImports"
import { listenToEvents } from "./testHelpers/eventListener"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

async function setup() {
  const f = await fixture()
  const organizationId = f.owner.team
  const create = (contacts: { email?: string; phone?: string }[]) =>
    f.owner.client.mutation(api.contacts.upsert, {
      organizationId,
      contacts,
      segmentIds: [],
    })
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId,
    input: {
      name: "Phone contacts",
      permission: "full_access",
      domainId: null,
    },
  })
  const call = (path: string, method = "GET", body?: unknown) => {
    vi.advanceTimersByTime(1100)
    return f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  return { ...f, organizationId, create, call, token }
}

test("dashboard creates normalized phone-only contacts, finds their digits and refuses duplicates", async () => {
  const f = await setup()
  const result = await f.create([{ phone: "+1 (415) 555-2671" }])
  expect(result).toMatchObject({ created: 1, skipped: 0 })
  const id = result.createdIds[0]
  expect(await f.owner.client.query(api.contacts.get, { id })).toMatchObject({
    phone: "+14155552671",
  })
  const page = await f.owner.client.query(api.contacts.list, {
    organizationId: f.organizationId,
    search: "415555",
    paginationOpts: { numItems: 50, cursor: null },
  })
  expect(page.page.map((row) => row._id)).toEqual([id])
  expect(await f.create([{ phone: "+14155552671" }])).toMatchObject({
    failed: 1,
    errors: ["That phone number already exists"],
  })
  expect(await f.create([{}])).toMatchObject({
    failed: 1,
    errors: ["An email or phone number is required"],
  })
  await expect(
    f.outsider.client.mutation(api.contacts.update, {
      id,
      phone: "+14155552672",
    })
  ).rejects.toThrow(/permission/i)
  // The same phone is available in another team.
  expect(
    await f.outsider.client.mutation(api.contacts.upsert, {
      organizationId: f.outsider.team,
      contacts: [{ phone: "+14155552671" }],
      segmentIds: [],
    })
  ).toMatchObject({ created: 1 })
})

test("REST phone-only contacts return nullable identities, properties, memberships and validation errors", async () => {
  const f = await setup()
  await listenToEvents(f.t, f.organizationId, ["contact.created"])
  const created = await f.call("/contacts", "POST", {
    phone: "+44 (20) 7946-0958",
  })
  expect(created.status).toBe(201)
  const { id } = await created.json()
  const contact = await (await f.call(`/contacts/${id}`)).json()
  expect(contact).toMatchObject({
    object: "contact",
    email: null,
    phone: "+442079460958",
    properties: {},
  })
  expect((await (await f.call("/contacts")).json()).data).toContainEqual(
    expect.objectContaining({ id, email: null, phone: "+442079460958" })
  )
  for (const body of [
    {},
    { phone: "02079460958" },
    { phone: "+442079460958" },
    { email: "new@example.test", phone: "+442079460958" },
  ]) {
    const refused = await f.call("/contacts", "POST", body)
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({
      name: "validation_error",
      message: expect.any(String),
    })
  }
  expect(
    (await f.call(`/contacts/${id}`, "PATCH", { phone: null })).status
  ).toBe(422)
  expect(
    (await f.call(`/contacts/${id}`, "PATCH", { email: " ADA@EXAMPLE.TEST " }))
      .status
  ).toBe(200)
  expect(
    (await f.call(`/contacts/${id}`, "PATCH", { phone: null })).status
  ).toBe(200)
  expect(await (await f.call(`/contacts/${id}`)).json()).toMatchObject({
    email: "ada@example.test",
    phone: null,
  })
  const events = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.organizationId)
      )
      .take(20)
  )
  expect(
    events.find((row) => row.type === "contact.created")?.data
  ).toMatchObject({ email: null, phone: "+442079460958" })
})

test("updates enforce normalized uniqueness and require a remaining identity", async () => {
  const f = await setup()
  const first = (
    await f.create([{ email: "first@example.test", phone: "+14155552671" }])
  ).createdIds[0]
  const second = (await f.create([{ email: "second@example.test" }]))
    .createdIds[0]
  await expect(
    f.owner.client.mutation(api.contacts.update, {
      id: second,
      phone: "+1 (415) 555-2671",
    })
  ).rejects.toThrow(/already exists/)
  await expect(
    f.owner.client.mutation(api.contacts.update, {
      id: second,
      email: "FIRST@EXAMPLE.TEST",
    })
  ).rejects.toThrow(/already exists/)
  await expect(
    f.owner.client.mutation(api.contacts.update, { id: second, email: "" })
  ).rejects.toThrow(/email or phone/)
  await f.owner.client.mutation(api.contacts.update, { id: first, email: "" })
  await expect(
    f.owner.client.mutation(api.contacts.update, { id: first, phone: "" })
  ).rejects.toThrow(/email or phone/)
  expect(
    await f.owner.client.query(api.contacts.get, { id: first })
  ).toMatchObject({ phone: "+14155552671" })
  const collision = await f.create([
    { email: "second@example.test", phone: "+14155552671" },
  ])
  expect(collision).toMatchObject({ skipped: 0, failed: 1 })
})

test("phone-only contacts support segments, topics and export with empty email cells", async () => {
  const f = await setup()
  const id = (await f.create([{ phone: "+14155552671" }])).createdIds[0]
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.organizationId,
    name: "Phone contacts",
  })
  await f.owner.client.mutation(api.contacts.setSegment, {
    id,
    segmentId,
    member: true,
  })
  const topicId = await f.owner.client.mutation(api.topics.create, {
    organizationId: f.organizationId,
    name: "News",
    description: "",
    visibility: "public",
    defaultSubscription: "opt_out",
  })
  await f.owner.client.mutation(api.contacts.setTopic, {
    id,
    topicId,
    subscription: "subscribed",
  })
  expect(
    (await (await f.call(`/segments/${segmentId}/contacts`)).json()).data[0]
  ).toMatchObject({ id, email: null, phone: "+14155552671" })
  expect(
    (await (await f.call(`/contacts/${id}/topics`)).json()).data[0]
  ).toMatchObject({ id: topicId, subscription: "opt_in" })
  const exported = await f.t.run((ctx) =>
    EXPORT_SOURCES.contacts.page(
      ctx,
      f.organizationId,
      {},
      { numItems: 50, cursor: null },
      []
    )
  )
  expect(exported.rows[0].slice(2, 4)).toEqual(["", "+14155552671"])
})

test("dashboard CSV import creates, upserts and skips phone-only contacts", async () => {
  const f = await setup()
  for (const skipExisting of [false, false, true]) {
    const result = await f.owner.client.mutation(api.contacts.upsert, {
      organizationId: f.organizationId,
      contacts: [{ phone: "+1 (415) 555-2671", firstName: "Ada" }, {}],
      segmentIds: [],
      csvImport: true,
      skipExisting,
    })
    await f.t.mutation(internal.contactImports.step, {
      id: result.jobId!,
      offset: 0,
    })
    const job = await f.owner.client.query(api.contactImports.get, {
      id: result.jobId!,
    })
    expect(job).toMatchObject({ status: "completed", failedCount: 1 })
    expect(job?.result).toMatchObject({
      skipped: skipExisting ? 1 : 0,
      failed: 1,
    })
  }
})

test("REST CSV accepts a mapped phone column without an email column", async () => {
  const f = await setup()
  const form = new FormData()
  form.append(
    "file",
    new Blob(["Number,first_name\n+1 (415) 555-2671,Ada"]),
    "contacts.csv"
  )
  form.append("column_map", JSON.stringify({ phone: "Number" }))
  const response = await f.t.fetch("/contacts/imports", {
    method: "POST",
    headers: { Authorization: `Bearer ${f.token}` },
    body: form,
  })
  expect(response.status).toBe(201)
  const { id } = await response.json()
  await f.t.mutation(internal.contactImports.step, { id, offset: 0 })
  expect(
    await f.owner.client.query(api.contactImports.get, { id })
  ).toMatchObject({ status: "completed", result: { created: 1, skipped: 0 } })
  expect((await (await f.call("/contacts")).json()).data[0]).toMatchObject({
    email: null,
    phone: "+14155552671",
    first_name: "Ada",
  })
})

test("an import keeps going when its segment is deleted and says so", async () => {
  const f = await setup()
  const [segmentId, kept, other] = await Promise.all(
    ["Leads", "Kept", "Other"].map((name) =>
      f.owner.client.mutation(api.segments.create, {
        organizationId: f.organizationId,
        name,
      })
    )
  )
  const contacts = Array.from({ length: 100 }, (_, n) => ({
    email: `lead${n}@example.test`,
  }))
  const { jobId } = await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: f.organizationId,
    contacts,
    segmentIds: [segmentId, kept, other],
    csvImport: true,
  })
  // Three segments share one step's membership budget: 66 contacts a step.
  await f.t.mutation(internal.contactImports.step, { id: jobId!, offset: 0 })
  await f.owner.client.mutation(api.segments.remove, { id: segmentId })
  await f.t.mutation(internal.contactImports.step, { id: jobId!, offset: 66 })
  const job = await f.owner.client.query(api.contactImports.get, {
    id: jobId!,
  })
  expect(job).toMatchObject({
    status: "completed",
    result: { created: 100, skipped: 0, failed: 0 },
  })
  expect(job?.result.errors).toEqual([SEGMENT_DELETED])
  const members = await f.t.run((ctx) =>
    ctx.db
      .query("segmentMembers")
      .withIndex("by_segmentId", (q) => q.eq("segmentId", segmentId))
      .collect()
  )
  expect(members).toEqual([])
  expect(
    await f.owner.client.query(api.segments.get, { id: kept })
  ).toMatchObject({ memberCount: 100 })
})

test("imports stored before the failed count read invalid rows apart", async () => {
  const f = await setup()
  const { jobId } = await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: f.organizationId,
    contacts: [{ email: "ada@example.test" }, { email: "bad" }],
    segmentIds: [],
    csvImport: true,
  })
  await f.t.mutation(internal.contactImports.step, { id: jobId!, offset: 0 })
  // The old shape counted the invalid row in `skipped` and `failedCount`.
  await f.t.run(async (ctx) => {
    const { failed, ...result } = (await ctx.db.get("contactImports", jobId!))!
      .result
    await ctx.db.patch("contactImports", jobId!, {
      result: { ...result, skipped: result.skipped + failed! },
    })
  })
  expect(
    (await f.owner.client.query(api.contactImports.get, { id: jobId! }))?.result
  ).toMatchObject({ created: 1, skipped: 0, failed: 1 })
  expect(
    await (await f.call(`/contacts/imports/${jobId}`)).json()
  ).toMatchObject({ counts: { total: 2, created: 1, skipped: 0, failed: 1 } })
})

test("an import keeps going when its topic is deleted and says so", async () => {
  const f = await setup()
  const [gone, kept] = await Promise.all(
    ["Gone", "Kept"].map((name) =>
      f.owner.client.mutation(api.topics.create, {
        organizationId: f.organizationId,
        name,
        description: "",
        defaultSubscription: "opt_out",
        visibility: "public",
      })
    )
  )
  const { jobId } = await f.t.run((ctx) =>
    enqueueImport(ctx, {
      organizationId: f.organizationId,
      contacts: Array.from({ length: 150 }, (_, n) => ({
        email: `reader${n}@example.test`,
      })),
      segmentIds: [],
      skipExisting: false,
      topics: [gone, kept].map((topicId) => ({
        topicId,
        subscription: "subscribed" as const,
      })),
    })
  )
  // Two topics share one step's membership budget: 100 contacts a step.
  await f.t.mutation(internal.contactImports.step, { id: jobId, offset: 0 })
  await f.owner.client.mutation(api.topics.remove, { id: gone })
  await f.t.mutation(internal.contactImports.step, { id: jobId, offset: 100 })
  const job = await f.owner.client.query(api.contactImports.get, {
    id: jobId,
  })
  expect(job).toMatchObject({
    status: "completed",
    result: { created: 150, skipped: 0, failed: 0 },
  })
  expect(job?.result.errors).toEqual([TOPIC_DELETED])
  const choices = await f.t.run((ctx) =>
    ctx.db
      .query("topicSubscriptions")
      .withIndex("by_topicId_and_subscription", (q) => q.eq("topicId", kept))
      .collect()
  )
  expect(choices).toHaveLength(150)
})

test("import notes keep the five-message limit and leave row errors first", () => {
  const errors: string[] = []
  for (let n = 0; n < 7; n++) addImportError(errors, `row ${n}`)
  expect(errors).toEqual(["row 0", "row 1", "row 2", "row 3", "row 4"])
  addImportError(errors, SEGMENT_DELETED)
  addImportError(errors, SEGMENT_DELETED)
  addImportError(errors, TOPIC_DELETED)
  addImportError(errors, "row 7")
  expect(errors).toEqual([
    "row 0",
    "row 1",
    "row 2",
    SEGMENT_DELETED,
    TOPIC_DELETED,
  ])
})
