import { Workpool } from "@convex-dev/workpool"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { createChannelMessage } from "./channels/messages"
import { patchRow } from "./counts"
import {
  inboundFixture,
  fakeGraph,
  incoming,
  envelope,
  PHONE_ID,
  SENDER,
  WABA_ID,
} from "./testHelpers/meta.fixture"
import {
  pagesFixture,
  pageGraphRoutes,
  pageEnvelope,
  PSID,
} from "./testHelpers/pages.fixture"

type Fixture = Awaited<ReturnType<typeof inboundFixture>>
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "sc-regression-secret-".repeat(4))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function project(f: Pick<Fixture, "t">, body: unknown) {
  const id = await f.t.run((ctx) =>
    ctx.db.insert("metaWebhookEvents", {
      object: (body as { object: string }).object,
      body: JSON.stringify(body),
      bodyHash: JSON.stringify(body),
      receivedAt: Date.now(),
    })
  )
  await f.t.mutation(internal.meta.projection.project, { id })
  return id
}
async function whatsapp() {
  const f = await inboundFixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  await project(f, incoming())
  return f
}
function send(f: Fixture, to = SENDER, replyTo?: string) {
  return f.t.run((ctx) =>
    createChannelMessage(
      ctx,
      {
        channel: "whatsapp",
        to,
        body: { text: "Reply" },
        ...(replyTo ? { replyTo } : {}),
      },
      { organizationId: f.owner.team, source: "dashboard" }
    )
  )
}
const row = (f: Pick<Fixture, "t">, id: Id<"channelMessages">) =>
  f.t.run((ctx) => ctx.db.get("channelMessages", id))

test("SC review 1: statuses use account and Meta id even when recipient differs; replies use conversation", async () => {
  const f = await whatsapp()
  const id = await send(f)
  await f.t.mutation(internal.channels.messages.record, {
    id,
    generation: 0,
    outcome: { kind: "sent", externalId: "wamid.sc" },
  })
  await project(
    f,
    envelope({
      metadata: { phone_number_id: PHONE_ID },
      statuses: [
        {
          id: "wamid.sc",
          status: "read",
          recipient_id: "5511999999999",
          timestamp: String(Date.now() / 1000),
        },
      ],
    })
  )
  expect(await row(f, id)).toMatchObject({ status: "read" })
  const received = await f.t.run((ctx) =>
    ctx.db.query("channelMessages").first()
  )
  await f.t.run((ctx) =>
    patchRow(ctx, "channelMessages", received!._id, { from: "canonical-wa-id" })
  )
  expect(await send(f, SENDER, received!._id)).toBeTruthy()
  await expect(send(f, "16505559999", received!._id)).rejects.toThrow(
    /conversation/
  )
})

test("SC review 2: unknown statuses never delay inbound or matched statuses, and retries do not replay inbound", async () => {
  const f = await whatsapp()
  const id = await send(f)
  await f.t.mutation(internal.channels.messages.record, {
    id,
    generation: 0,
    outcome: { kind: "sent", externalId: "wamid.known" },
  })
  const body = incoming("wamid.immediate")
  Object.assign(body.entry[0].changes[0].value as object, {
    statuses: [
      {
        id: "wamid.unknown",
        status: "delivered",
        recipient_id: SENDER,
        timestamp: String(Date.now() / 1000),
      },
      {
        id: "wamid.known",
        status: "read",
        recipient_id: SENDER,
        timestamp: String(Date.now() / 1000),
      },
    ],
  })
  const eventId = await project(f, body)
  expect(await row(f, id)).toMatchObject({ status: "read" })
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("channelMessages")
        .withIndex("by_channel_and_externalId", (q) =>
          q.eq("channel", "whatsapp").eq("externalId", "wamid.immediate")
        )
        .unique()
    )
  ).toBeTruthy()
  const retry = await f.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).find(
      (job) => job.args[0]?.id === eventId
    )
  )
  expect(retry?.args[0]).toMatchObject({ attempt: 1, statusIndexes: [1] })
  await f.t.mutation(internal.meta.projection.project, {
    id: eventId,
    attempt: 3,
    statusIndexes: [1],
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("channelMessages").collect())
  ).toHaveLength(3)
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("channelMessageEvents")
        .withIndex("by_messageId_and_at", (q) => q.eq("messageId", id))
        .collect()
    )
  ).toHaveLength(3)
})

test("SC review 3: overlapping template syncs preserve newer observations, content and completion clocks", async () => {
  const f = await inboundFixture()
  const base = { organizationId: f.owner.team, wabaId: WABA_ID }
  const template = {
    id: "meta.sc",
    name: "sc",
    language: "en_US",
    category: "UTILITY" as const,
    status: "APPROVED" as const,
    parameterFormat: "positional" as const,
    components: [{ type: "BODY", text: "New content" }],
  }
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    ...base,
    syncedAt: 200,
    templates: [template],
  })
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    ...base,
    syncedAt: 100,
    templates: [
      {
        ...template,
        status: "PENDING",
        components: [{ type: "BODY", text: "Old content" }],
      },
    ],
  })
  await f.t.mutation(internal.whatsapp.templates.finishSync, {
    ...base,
    syncedAt: 100,
    cursor: null,
    seenMetaIds: [],
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("templates").first())
  ).toMatchObject({ whatsapp: { metaStatus: "APPROVED", syncedAt: 200 } })
  await f.t.mutation(internal.whatsapp.templates.finishSync, {
    ...base,
    syncedAt: 200,
    cursor: null,
    seenMetaIds: [template.id],
  })
  await f.t.mutation(internal.whatsapp.templates.finishSync, {
    ...base,
    syncedAt: 100,
    cursor: null,
    seenMetaIds: [],
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("whatsappBusinessAccounts").first())
  ).toMatchObject({ templatesSyncStartedAt: 200, templatesSyncedAt: 200 })
  // A newer sync protects unchanged rows without writing to each template.
  const beforeRepeat = await f.t.run((ctx) => ctx.db.query("templates").first())
  vi.advanceTimersByTime(1000)
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    ...base,
    syncedAt: 300,
    templates: [template],
  })
  expect(await f.t.run((ctx) => ctx.db.query("templates").first())).toEqual(
    beforeRepeat
  )
  // Even an old page containing a previously unknown template is ignored.
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    ...base,
    syncedAt: 250,
    templates: [
      { ...template, status: "PENDING" },
      { ...template, id: "meta.stale", name: "stale" },
    ],
  })
  await f.t.mutation(internal.whatsapp.templates.finishSync, {
    ...base,
    syncedAt: 250,
    cursor: null,
    seenMetaIds: [],
  })
  expect(await f.t.run((ctx) => ctx.db.query("templates").first())).toEqual(
    beforeRepeat
  )
  expect(
    await f.t.run((ctx) => ctx.db.query("templates").collect())
  ).toHaveLength(1)
  expect(
    await f.t.run((ctx) => ctx.db.query("whatsappBusinessAccounts").first())
  ).toMatchObject({ templatesSyncStartedAt: 300, templatesSyncedAt: 200 })
  await f.t.mutation(internal.whatsapp.templates.finishSync, {
    ...base,
    syncedAt: 300,
    cursor: null,
    seenMetaIds: [template.id],
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("whatsappBusinessAccounts").first())
  ).toMatchObject({ templatesSyncStartedAt: 300, templatesSyncedAt: 300 })
})

async function pages() {
  fakeGraph(pageGraphRoutes())
  const f = await pagesFixture()
  await project(
    f,
    pageEnvelope("messenger", { message: { mid: "mid.sc", text: "Hello" } })
  )
  return f
}
test("SC review 4: stored Page templates with empty quick replies omit the payload key", async () => {
  const f = await pages()
  const id = await f.owner.client.mutation(api.templates.create, {
    organizationId: f.owner.team,
    name: "Empty replies",
    channel: "messenger",
    content: { text: "Hello", quickReplies: [] },
  })
  await f.owner.client.mutation(api.templates.publish, { id })
  const messageId = await f.t.run((ctx) =>
    createChannelMessage(
      ctx,
      { channel: "messenger", to: PSID, body: { template: { id } } },
      { organizationId: f.owner.team, source: "dashboard" }
    )
  )
  const content = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .unique()
  )
  expect(JSON.parse(content!.payload).message).not.toHaveProperty(
    "quick_replies"
  )
})

test.each([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EADDRNOTAVAIL",
  "EAI_AGAIN",
])(
  "SC review 5: unreachable %s retries without failing the message",
  async (code) => {
    const f = await whatsapp()
    const enqueue = vi.spyOn(Workpool.prototype, "enqueueAction")
    const id = await send(f)
    const graph = fakeGraph()
    graph.spy.mockRejectedValue(
      Object.assign(new Error("unreachable"), { code })
    )
    await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
    expect(await row(f, id)).toMatchObject({
      status: "queued",
      attempts: 1,
      generation: 1,
      claimed: false,
    })
    expect(enqueue.mock.calls.at(-1)?.[2]).toMatchObject({ id, generation: 1 })
    expect(enqueue.mock.calls.at(-1)?.[3]).toMatchObject({
      runAfter: expect.any(Number),
      retry: false,
    })
  }
)

test("SC review 6: inbound and outbound share the 8–15 digit phone rule", async () => {
  const f = await whatsapp()
  const body = incoming("wamid.short")
  const value = body.entry[0].changes[0].value as {
    messages: { from: string; id: string }[]
  }
  value.messages[0].from = "12345678"
  await project(f, body)
  expect(await send(f, "12345678")).toBeTruthy()
  value.messages[0].id = "wamid.invalid"
  value.messages[0].from = "1234567"
  await project(f, body)
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("channelMessages")
        .withIndex("by_channel_and_externalId", (q) =>
          q.eq("channel", "whatsapp").eq("externalId", "wamid.invalid")
        )
        .first()
    )
  ).toBeNull()
  await expect(send(f, "1234567")).rejects.toThrow(/E.164 phone number/)
})

test("SC review 7: Inbox returns complete Page text and local template bodies", async () => {
  const f = await pages()
  const text = "Long reply ".repeat(100)
  await project(
    f,
    pageEnvelope("messenger", { message: { mid: "mid.long", text } })
  )
  const conversation = await f.t.run((ctx) =>
    ctx.db.query("conversations").first()
  )
  const thread = await f.owner.client.query(api.conversations.messages, {
    id: conversation!._id,
    paginationOpts: { cursor: null, numItems: 20 },
  })
  expect(thread.page[0].text).toBe(text)
  const template = await f.owner.client.mutation(api.templates.create, {
    organizationId: f.owner.team,
    name: "Long template",
    channel: "messenger",
    content: { text, quickReplies: [] },
  })
  await f.owner.client.mutation(api.templates.publish, { id: template })
  const id = await f.t.run((ctx) =>
    createChannelMessage(
      ctx,
      { channel: "messenger", to: PSID, body: { template: { id: template } } },
      { organizationId: f.owner.team, source: "dashboard" }
    )
  )
  const sent = await f.owner.client.query(api.conversations.messages, {
    id: conversation!._id,
    paginationOpts: { cursor: null, numItems: 20 },
  })
  expect(sent.page.find((message) => message.id === id)?.text).toBe(text)
})

test("SC review 8: account and message filter 404s use each channel's account noun", async () => {
  const f = await pages()
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Labels", permission: "full_access", domainId: null },
  })
  for (const [channel, resource, key, noun] of [
    ["messenger", "pages", "page_id", "Page"],
    ["instagram", "accounts", "account_id", "Account"],
    ["whatsapp", "phone-numbers", "phone_number_id", "Number"],
  ])
    for (const path of [
      `/${channel}/${resource}/missing`,
      `/${channel}/messages?${key}=missing`,
    ]) {
      vi.setSystemTime(Date.now() + 1100)
      const result = await f.t.fetch(path, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(result.status).toBe(404)
      expect(await result.json()).toMatchObject({
        message: `${noun} not found`,
      })
    }
})

test("SC identity: list, detail, suggestions and Inbox hydrate channel-only contacts without per-row client calls", async () => {
  const f = await pages()
  const identity = await f.t.run((ctx) =>
    ctx.db.query("channelContacts").first()
  )
  const expected = { channel: "messenger", externalId: PSID }
  const list = await f.owner.client.query(api.contacts.list, {
    organizationId: f.owner.team,
    paginationOpts: { cursor: null, numItems: 10 },
  })
  expect(list.page[0]).toMatchObject({
    _id: identity!.contactId,
    channelIdentity: expected,
  })
  const detail = await f.owner.client.query(api.contacts.get, {
    id: identity!.contactId!,
  })
  expect(detail?.channelIdentity).toMatchObject(expected)
  const options = await f.owner.client.query(api.contacts.options, {
    organizationId: f.owner.team,
    selectedId: identity!.contactId,
  })
  expect(options[0].channelIdentity).toMatchObject(expected)
  const thread = await f.t.run((ctx) => ctx.db.query("conversations").first())
  expect(
    await f.owner.client.query(api.conversations.get, { id: thread!._id })
  ).toMatchObject({ name: PSID, contact: { channelIdentity: expected } })
  await expect(
    f.outsider.client.query(api.contacts.get, { id: identity!.contactId! })
  ).rejects.toMatchObject({ data: "You do not have permission" })
})

test("SC profile writes: enrichment uses audience search tokens and preserves CRM names", async () => {
  const f = await pages()
  const identity = await f.t.run((ctx) =>
    ctx.db.query("channelContacts").first()
  )
  await f.owner.client.mutation(api.contacts.update, {
    id: identity!.contactId!,
    email: "ada+crm@example.com",
    phone: "+12345678",
  })
  await f.t.mutation(internal.meta.pageState.profileComplete, {
    identityId: identity!._id,
    name: "Ada Lovelace",
  })
  const contact = await f.t.run((ctx) =>
    ctx.db.get("contacts", identity!.contactId!)
  )
  expect(contact).toMatchObject({ firstName: "Ada", lastName: "Lovelace" })
  expect(contact?.search).toContain("ada crm example com")
  expect(contact?.search).toContain("12345678")
  await f.t.mutation(internal.meta.pageState.profileComplete, {
    identityId: identity!._id,
    name: "New Meta name",
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("contacts", identity!.contactId!))
  ).toMatchObject({
    firstName: "Ada",
    lastName: "Lovelace",
    search: contact?.search,
  })
})
