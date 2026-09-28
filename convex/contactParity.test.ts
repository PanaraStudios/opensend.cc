import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { signUnsubscribeToken } from "../lib/unsubscribe/token"
import { setTopicChoices } from "./audience"
import { insertRow } from "./counts"

const SECRET = "contact-parity-secret-".repeat(4)
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function setup() {
  const f = await fixture()
  const member = await f.actor("plain")
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
  const upsert = (
    csvImport = false,
    email = "ada@example.com",
    firstName = "Ada"
  ) =>
    member.client.mutation(api.contacts.upsert, {
      organizationId: f.owner.team,
      contacts: [{ email, firstName }],
      segmentIds: [],
      csvImport,
    })
  const events = () =>
    f.t.run((ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .collect()
    )
  const topic = await member.client.mutation(api.topics.create, {
    organizationId: f.owner.team,
    name: "News",
    description: "",
    visibility: "public",
    defaultSubscription: "opt_out",
  })
  return { ...f, member, upsert, events, topic }
}

test("CSV creates and updates contacts silently; ordinary creation still emits", async () => {
  const f = await setup()
  expect(await f.upsert(true)).toMatchObject({ created: 1 })
  expect(await f.upsert(true, "ada@example.com", "Updated")).toMatchObject({
    updated: 1,
  })
  expect(await f.events()).toHaveLength(0)
  await f.upsert(false, "normal@example.com")
  expect((await f.events()).map((row) => row.type)).toEqual(["contact.created"])
})

test("CSV import validates rows and rejects another team's member", async () => {
  const f = await setup()
  expect(await f.upsert(true, "invalid")).toMatchObject({
    skipped: 1,
    created: 0,
  })
  await expect(
    f.outsider.client.mutation(api.contacts.upsert, {
      organizationId: f.owner.team,
      contacts: [{ email: "x@example.com" }],
      segmentIds: [],
      csvImport: true,
    })
  ).rejects.toThrow("permission")
  expect(await f.events()).toHaveLength(0)
})

test("dashboard, bulk, REST and preference choices share idempotent events and updated_at", async () => {
  const f = await setup()
  const {
    createdIds: [id],
  } = await f.upsert(true)
  vi.advanceTimersByTime(1000)
  await f.member.client.mutation(api.contacts.setTopic, {
    id,
    topicId: f.topic,
    subscription: "subscribed",
  })
  await f.member.client.mutation(api.contacts.subscribeToTopics, {
    organizationId: f.owner.team,
    ids: [id],
    topicIds: [f.topic],
  })
  expect(await f.events()).toHaveLength(1)
  const token = await signUnsubscribeToken(
    { organizationId: f.owner.team, contactId: id },
    SECRET
  )
  await f.t.mutation(api.unsubscribe.setTopic, {
    token,
    topicId: f.topic,
    subscribed: false,
  })
  const key = await f.t.run((ctx) =>
    insertRow(ctx, "apiKeys", {
      organizationId: f.owner.team,
      name: "test",
      permission: "full_access",
      tokenHash: "hash",
      tokenPrefix: "os_test",
      tokenLast4: "test",
      search: "test",
      createdBy: { name: "test" },
    })
  )
  const caller = {
    organizationId: f.owner.team,
    apiKeyId: key,
    permission: "full_access" as const,
    name: "test",
  }
  await f.t.mutation(internal.api.audience.subscriptions, {
    caller,
    id,
    body: JSON.stringify({ topics: [{ id: f.topic, subscription: "opt_in" }] }),
  })
  await f.member.client.mutation(api.contacts.setTopic, {
    id,
    topicId: f.topic,
    subscription: "unsubscribed",
  })
  await f.member.client.mutation(api.contacts.subscribeToTopics, {
    organizationId: f.owner.team,
    ids: [id],
    topicIds: [f.topic],
  })
  // Background consumers use the same helper; repeated choices are silent.
  await f.t.run(async (ctx) =>
    setTopicChoices(ctx, (await ctx.db.get("contacts", id))!, [
      { topicId: f.topic, subscription: "subscribed" },
    ])
  )
  const events = await f.events()
  expect(events).toHaveLength(5)
  expect(events.every((event) => event.type === "contact.updated")).toBe(true)
  expect(events[0].data.updated_at).toBe(new Date(Date.now()).toISOString())
  await expect(
    f.outsider.client.mutation(api.contacts.setTopic, {
      id,
      topicId: f.topic,
      subscription: "subscribed",
    })
  ).rejects.toThrow("permission")
})

test("a multi-topic operation emits once and a foreign topic rolls back the whole change", async () => {
  const f = await setup()
  const {
    createdIds: [id],
  } = await f.upsert(true)
  const other = await f.member.client.mutation(api.topics.create, {
    organizationId: f.owner.team,
    name: "Other",
    description: "",
    visibility: "public",
    defaultSubscription: "opt_out",
  })
  await f.member.client.mutation(api.contacts.subscribeToTopics, {
    organizationId: f.owner.team,
    ids: [id],
    topicIds: [f.topic, other],
  })
  expect(await f.events()).toHaveLength(1)
  const foreign = await f.outsider.client.mutation(api.topics.create, {
    organizationId: f.outsider.team,
    name: "Foreign",
    description: "",
    visibility: "public",
    defaultSubscription: "opt_out",
  })
  await expect(
    f.t.run(async (ctx) =>
      setTopicChoices(ctx, (await ctx.db.get("contacts", id))!, [
        { topicId: f.topic, subscription: "unsubscribed" },
        { topicId: foreign, subscription: "unsubscribed" },
      ])
    )
  ).rejects.toThrow("Topic not found")
  expect(await f.events()).toHaveLength(1)
})
