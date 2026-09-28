/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest"
import { api, components } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow } from "./counts"
import { effectiveTopicSubscription } from "../lib/dashboard/contacts"
import type { Id } from "./_generated/dataModel"

type Fixture = Awaited<ReturnType<typeof fixture>>
const page = { cursor: null, numItems: 50 }

afterEach(() => {
  vi.useRealTimers()
})

async function setup() {
  const f = await fixture()
  const org = f.owner.team
  const owner = f.owner.client
  const upsert = (
    contacts: { email: string; [key: string]: unknown }[],
    segmentIds: Id<"segments">[] = [],
    skipExisting?: boolean
  ) =>
    owner.mutation(api.contacts.upsert, {
      organizationId: org,
      contacts,
      segmentIds,
      skipExisting,
    })
  const contacts = async (
    filters: {
      search?: string
      segmentId?: Id<"segments">
      unsubscribed?: boolean
    } = {}
  ) =>
    (
      await owner.query(api.contacts.list, {
        organizationId: org,
        paginationOpts: page,
        ...filters,
      })
    ).page
  const events = (type: string) =>
    f.t.run((ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_organizationId_and_type", (q) =>
          q.eq("organizationId", org).eq("type", type)
        )
        .collect()
    )
  const drain = async () => {
    vi.useFakeTimers()
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  }
  return { f, org, owner, upsert, contacts, events, drain }
}

async function joinAsMember(f: Fixture) {
  await f.t.mutation(components.betterAuth.teams.invite, {
    sessionId: f.owner.session._id,
    organizationId: f.owner.team,
    email: f.outsider.user.email,
    role: "member",
  })
  const snapshot = await f.outsider.client.query(api.teams.snapshot)
  await f.outsider.client.mutation(api.teams.respond, {
    invitationId: snapshot!.receivedInvitations[0].id,
    accept: true,
  })
}

describe("audience access", () => {
  test("another team's member is refused everywhere", async () => {
    const { f, org, upsert } = await setup()
    const { createdIds } = await upsert([{ email: "ada@example.com" }])
    const segment = await f.owner.client.mutation(api.segments.create, {
      organizationId: org,
      name: "Customers",
    })
    const outsider = f.outsider.client
    await expect(
      outsider.query(api.contacts.list, {
        organizationId: org,
        paginationOpts: page,
      })
    ).rejects.toThrow("permission")
    await expect(
      outsider.query(api.contacts.get, { id: createdIds[0] })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.contacts.upsert, {
        organizationId: org,
        contacts: [{ email: "eve@example.com" }],
        segmentIds: [],
      })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.contacts.update, {
        id: createdIds[0],
        firstName: "Eve",
      })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.segments.update, { id: segment, name: "Mine" })
    ).rejects.toThrow("permission")
    await expect(
      outsider.query(api.topics.options, { organizationId: org })
    ).rejects.toThrow("permission")
    await expect(
      outsider.query(api.contactProperties.options, { organizationId: org })
    ).rejects.toThrow("permission")
    // Their own team cannot reach into ours by id either.
    await expect(
      outsider.mutation(api.contacts.remove, {
        organizationId: f.outsider.team,
        ids: createdIds,
      })
    ).rejects.toThrow("Contact not found")
    await expect(
      outsider.mutation(api.contacts.upsert, {
        organizationId: f.outsider.team,
        contacts: [{ email: "eve@example.com" }],
        segmentIds: [segment],
      })
    ).rejects.toThrow("Segment not found")
  })

  test("a plain member reads and writes the audience", async () => {
    const { f, org } = await setup()
    await joinAsMember(f)
    const member = f.outsider.client
    const segment = await member.mutation(api.segments.create, {
      organizationId: org,
      name: "Leads",
    })
    const result = await member.mutation(api.contacts.upsert, {
      organizationId: org,
      contacts: [{ email: "lead@example.com" }],
      segmentIds: [segment],
    })
    expect(result.created).toBe(1)
    await member.mutation(api.topics.create, {
      organizationId: org,
      name: "News",
      description: "",
      defaultSubscription: "opt_in",
      visibility: "public",
    })
    await member.mutation(api.contactProperties.create, {
      organizationId: org,
      key: "plan",
      name: "Plan",
      type: "string",
    })
    expect(
      (await member.query(api.segments.get, { id: segment }))?.memberCount
    ).toBe(1)
  })
})

describe("contacts", () => {
  test("an address is unique per team, whatever its case", async () => {
    const { f, upsert, contacts } = await setup()
    expect((await upsert([{ email: " Ada@Example.com " }])).created).toBe(1)
    const again = await upsert([{ email: "ada@example.COM", firstName: "Ada" }])
    expect(again).toMatchObject({ created: 0, updated: 1 })
    const rows = await contacts()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      email: "ada@example.com",
      firstName: "Ada",
    })
    // Another team keeps its own contact with the same address.
    const other = await f.outsider.client.mutation(api.contacts.upsert, {
      organizationId: f.outsider.team,
      contacts: [{ email: "ADA@example.com" }],
      segmentIds: [],
    })
    expect(other.created).toBe(1)
  })

  test("upsert merges, skips invalid rows and can leave known ones", async () => {
    const { f, org, upsert, contacts } = await setup()
    await f.owner.client.mutation(api.contactProperties.create, {
      organizationId: org,
      key: "plan",
      name: "Plan",
      type: "string",
    })
    await f.owner.client.mutation(api.contactProperties.create, {
      organizationId: org,
      key: "seats",
      name: "Seats",
      type: "number",
    })
    await upsert([
      {
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        properties: { plan: "pro" },
      },
    ])
    const result = await upsert([
      // Blank names keep what is stored; properties merge key by key.
      { email: "ada@example.com", firstName: "", properties: { seats: "3" } },
      { email: "new@example.com" },
      // A repeat within the batch merges into the row that introduced it.
      { email: "NEW@example.com", lastName: "Later" },
      { email: "not-an-email" },
      { email: "bad@example.com", properties: { seats: "many" } },
      { email: "odd@example.com", properties: { unknown: "x" } },
    ])
    expect(result).toMatchObject({ created: 1, updated: 2, skipped: 3 })
    expect(result.errors).toEqual([
      "not-an-email is not a valid email address",
      "seats must be a number",
      "Unknown property: unknown",
    ])
    const byEmail = Object.fromEntries(
      (await contacts()).map((row) => [row.email, row])
    )
    expect(byEmail["ada@example.com"]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      properties: { plan: "pro", seats: "3" },
    })
    expect(byEmail["new@example.com"].lastName).toBe("Later")
    expect(byEmail["bad@example.com"]).toBeUndefined()

    const skipped = await upsert(
      [{ email: "ada@example.com", firstName: "Changed" }, { email: "b@c.io" }],
      [],
      true
    )
    expect(skipped).toMatchObject({ created: 1, updated: 0, skipped: 1 })
    expect(
      (await contacts({ search: "ada" })).map((row) => row.firstName)
    ).toEqual(["Ada"])

    await expect(
      upsert(
        Array.from({ length: 101 }, (_, i) => ({ email: `u${i}@example.com` }))
      )
    ).rejects.toThrow("at most 100")
  })

  test("update edits fields, clears empty properties and validates", async () => {
    const { f, org, upsert } = await setup()
    await f.owner.client.mutation(api.contactProperties.create, {
      organizationId: org,
      key: "plan",
      name: "Plan",
      type: "string",
    })
    const [id] = (
      await upsert([{ email: "ada@example.com", properties: { plan: "pro" } }])
    ).createdIds
    await f.owner.client.mutation(api.contacts.update, {
      id,
      firstName: " Ada ",
      unsubscribed: true,
      properties: { plan: "" },
    })
    expect(await f.owner.client.query(api.contacts.get, { id })).toMatchObject({
      firstName: "Ada",
      unsubscribed: true,
      properties: {},
    })
    await expect(
      f.owner.client.mutation(api.contacts.update, {
        id,
        properties: { nope: "1" },
      })
    ).rejects.toThrow("Unknown property: nope")
  })

  test("search and filters find contacts", async () => {
    const { upsert, contacts } = await setup()
    await upsert([
      { email: "ada@lovelace.dev", firstName: "Ada" },
      { email: "grace@hopper.dev", unsubscribed: true },
    ])
    expect(
      (await contacts({ search: "lovelace" })).map((c) => c.email)
    ).toEqual(["ada@lovelace.dev"])
    expect((await contacts({ search: "gra" })).map((c) => c.email)).toEqual([
      "grace@hopper.dev",
    ])
    expect(
      (await contacts({ unsubscribed: true })).map((c) => c.email)
    ).toEqual(["grace@hopper.dev"])
  })

  test("contact events carry Resend's webhook data", async () => {
    const { f, upsert, events } = await setup()
    const segment = await f.owner.client.mutation(api.segments.create, {
      organizationId: f.owner.team,
      name: "Customers",
    })
    const [id] = (await upsert([{ email: "ada@example.com" }], [segment]))
      .createdIds
    const [created] = await events("contact.created")
    expect(created.data).toMatchObject({
      id,
      email: "ada@example.com",
      first_name: null,
      last_name: null,
      unsubscribed: false,
      segment_ids: [segment],
    })
    expect(created.data.created_at).toMatch(/^\d{4}-\d\d-\d\dT/)
    // No change, no event.
    await upsert([{ email: "ada@example.com" }])
    expect(await events("contact.updated")).toHaveLength(0)
    await f.owner.client.mutation(api.contacts.update, { id, lastName: "L" })
    await f.owner.client.mutation(api.contacts.setSegment, {
      id,
      segmentId: segment,
      member: false,
    })
    const updated = await events("contact.updated")
    expect(updated.map((row) => row.data.segment_ids)).toEqual([[segment], []])
    await f.owner.client.mutation(api.contacts.remove, {
      organizationId: f.owner.team,
      ids: [id],
    })
    const [deleted] = await events("contact.deleted")
    expect(deleted.data).toMatchObject({ id, last_name: "L" })
  })
})

describe("segments", () => {
  test("membership adds, removes and keeps the count", async () => {
    const { f, org, upsert, contacts } = await setup()
    const owner = f.owner.client
    const segment = await owner.mutation(api.segments.create, {
      organizationId: org,
      name: "Customers",
    })
    const ids = (
      await upsert([
        { email: "a@example.com" },
        { email: "b@example.com" },
        { email: "c@example.com" },
      ])
    ).createdIds
    await owner.mutation(api.contacts.addToSegments, {
      organizationId: org,
      ids: [ids[0], ids[1], ids[0]],
      segmentIds: [segment, segment],
    })
    const count = async () =>
      (await owner.query(api.segments.get, { id: segment }))!.memberCount
    expect(await count()).toBe(2)
    // Adding again changes nothing.
    await owner.mutation(api.contacts.setSegment, {
      id: ids[0],
      segmentId: segment,
      member: true,
    })
    expect(await count()).toBe(2)
    await owner.mutation(api.contacts.setSegment, {
      id: ids[1],
      segmentId: segment,
      member: false,
    })
    expect(await count()).toBe(1)
    expect(
      (await contacts({ segmentId: segment })).map((row) => row._id)
    ).toEqual([ids[0]])
    // Deleting a member leaves the segment one smaller.
    await owner.mutation(api.contacts.remove, {
      organizationId: org,
      ids: [ids[0]],
    })
    expect(await count()).toBe(0)
    await expect(
      owner.mutation(api.segments.create, { organizationId: org, name: " " })
    ).rejects.toThrow("Name a segment")
  })

  test("deleting a segment clears its memberships in batches", async () => {
    const { f, org, upsert, drain } = await setup()
    const owner = f.owner.client
    const segment = await owner.mutation(api.segments.create, {
      organizationId: org,
      name: "Big",
    })
    const [contactId] = (await upsert([{ email: "a@example.com" }])).createdIds
    // More rows than one cleanup pass deletes.
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 520; i++)
        await insertRow(ctx, "segmentMembers", {
          organizationId: org,
          segmentId: segment,
          contactId,
        })
    })
    await owner.mutation(api.segments.remove, { id: segment })
    expect(await owner.query(api.segments.get, { id: segment })).toBeNull()
    await drain()
    const left = await f.t.run((ctx) =>
      ctx.db
        .query("segmentMembers")
        .withIndex("by_segmentId", (q) => q.eq("segmentId", segment))
        .collect()
    )
    expect(left).toHaveLength(0)
  })
})

describe("topics", () => {
  test("a contact follows the default until they choose", async () => {
    const { f, org, upsert } = await setup()
    const owner = f.owner.client
    const topic = await owner.mutation(api.topics.create, {
      organizationId: org,
      name: "Product updates",
      description: "",
      defaultSubscription: "opt_out",
      visibility: "public",
    })
    const [id] = (await upsert([{ email: "a@example.com" }])).createdIds
    const stored = (
      await owner.query(api.topics.options, { organizationId: org })
    )[0]
    const status = async () => {
      const contact = await owner.query(api.contacts.get, { id })
      return effectiveTopicSubscription(
        contact!.topics.find((row) => row.topicId === topic)?.subscription,
        stored
      )
    }
    expect(await status()).toBe("subscribed")
    await owner.mutation(api.contacts.setTopic, {
      id,
      topicId: topic,
      subscription: "unsubscribed",
    })
    expect(await status()).toBe("unsubscribed")
    await owner.mutation(api.contacts.subscribeToTopics, {
      organizationId: org,
      ids: [id],
      topicIds: [topic],
    })
    expect(await status()).toBe("subscribed")
    // The default is fixed once the topic exists.
    await expect(
      owner.mutation(api.topics.update, {
        id: topic,
        defaultSubscription: "opt_in",
      } as never)
    ).rejects.toThrow()
    await owner.mutation(api.topics.update, {
      id: topic,
      visibility: "private",
    })
    // Deleting the topic removes every choice made for it.
    await owner.mutation(api.topics.remove, { id: topic })
    const choices = await f.t.run((ctx) =>
      ctx.db.query("topicSubscriptions").collect()
    )
    expect(choices).toHaveLength(0)
  })
})

describe("properties", () => {
  test("reserved and malformed keys are refused", async () => {
    const { f, org } = await setup()
    const create = (key: string) =>
      f.owner.client.mutation(api.contactProperties.create, {
        organizationId: org,
        key,
        name: key,
        type: "string",
      })
    await expect(create("email")).rejects.toThrow("That key already exists")
    await expect(create("First_Name")).rejects.toThrow(
      "That key already exists"
    )
    await expect(create("1st")).rejects.toThrow("Use a lowercase key")
    await create("Company Name")
    await expect(create("company_name")).rejects.toThrow("already exists")
  })

  test("deleting a property strips it from every contact", async () => {
    const { f, org, upsert, contacts, drain } = await setup()
    const owner = f.owner.client
    const plan = await owner.mutation(api.contactProperties.create, {
      organizationId: org,
      key: "plan",
      name: "Plan",
      type: "string",
    })
    await upsert(
      Array.from({ length: 3 }, (_, i) => ({
        email: `u${i}@example.com`,
        properties: { plan: "pro" },
      }))
    )
    await owner.mutation(api.contactProperties.remove, { id: plan })
    // Hidden at once, and its key stays taken until the values are gone.
    expect(
      await owner.query(api.contactProperties.options, { organizationId: org })
    ).toEqual([])
    await expect(
      owner.mutation(api.contactProperties.create, {
        organizationId: org,
        key: "plan",
        name: "Plan",
        type: "string",
      })
    ).rejects.toThrow("already exists")
    await drain()
    expect((await contacts()).map((row) => row.properties)).toEqual([
      {},
      {},
      {},
    ])
    await owner.mutation(api.contactProperties.create, {
      organizationId: org,
      key: "plan",
      name: "Plan",
      type: "string",
    })
  })
})
