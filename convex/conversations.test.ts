/// <reference types="vite/client" />
import workpoolTest from "@convex-dev/workpool/test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Id } from "./_generated/dataModel"
import { api, internal } from "./_generated/api"
import {
  APP_SECRET,
  SENDER,
  WABA_ID,
  fakeGraph,
  inboundFixture,
  incoming,
  signedWebhook,
} from "./testHelpers/meta.fixture"
import { insertRow, patchRow } from "./counts"
import { WINDOW_CLOSED } from "./channels/messages"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
  vi.stubEnv("BETTER_AUTH_SECRET", "conversations-test-secret-32-bytes!!")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const page = { cursor: null, numItems: 20 }
type Fixture = Awaited<ReturnType<typeof setup>>

async function setup() {
  const f = await inboundFixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "channelAccounts", f.account, {
      registeredAt: Date.now(),
    })
    await ctx.db.patch("domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-team-cfg",
      receiving: true,
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 10 },
    })
  })
  const team = f.owner.team
  const list = (filters: Record<string, unknown> = {}) =>
    f.member.client.query(api.conversations.list, {
      organizationId: team,
      paginationOpts: page,
      ...filters,
    })
  return { ...f, team, list }
}

/** A signed WhatsApp webhook, projected at once. */
async function project(f: Fixture, body: unknown) {
  expect(
    (await f.t.fetch("/meta/webhook", await signedWebhook(APP_SECRET, body)))
      .status
  ).toBe(200)
  const event = await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  )
  await f.t.mutation(internal.meta.projection.project, { id: event!._id })
}

/** A parsed inbound email, as receiving stores it. */
async function receive(
  f: Fixture,
  from = "Ada Lovelace <ada@example.com>",
  subject = "Order question"
) {
  const address = from.replace(/^.*<|>$/g, "").toLowerCase()
  return f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["raw"]))
    const id = await ctx.db.insert("inboundMessages", {
      organizationId: f.team,
      domainId: f.domain,
      region: "us-east-1",
      topicArn: "topic",
      messageId: crypto.randomUUID(),
      sesMessageId: crypto.randomUUID(),
      bucket: "inbound-bucket",
      objectKey: crypto.randomUUID(),
      storageId,
      notification: JSON.stringify({ receipt: {} }),
    })
    return ctx.runMutation(internal.received.complete, {
      id,
      metadata: {
        from,
        sender: address,
        to: ["Support <support@mail.example.test>"],
        cc: [],
        bcc: [],
        replyTo: [],
        subject,
        messageId: "<question@example.com>",
      },
      content: { html: "", text: "Where is my order?", headers: {} },
      attachments: [],
    })
  })
}

/** Closes WhatsApp's customer service window, as 24 quiet hours would. */
const expire = (f: Fixture, id: Id<"conversations">) =>
  f.t.run((ctx) =>
    patchRow(ctx, "conversations", id, { windowExpiresAt: Date.now() - 1 })
  )

async function thread(f: Fixture, channel: "whatsapp" | "email") {
  const { page } = await f.list({ channel })
  expect(page).toHaveLength(1)
  return page[0].conversation._id
}

test("an inbound WhatsApp message opens an unread thread the inbox lists, filters, searches and counts", async () => {
  const f = await setup()
  await project(f, incoming())
  const { page: rows } = await f.list()
  expect(rows).toEqual([
    expect.objectContaining({
      name: "Sheena Nelson",
      handle: `+${SENDER}`,
      conversation: expect.objectContaining({
        channel: "whatsapp",
        status: "open",
        unread: true,
        unreadCount: 1,
        lastDirection: "inbound",
        lastPreview: "Does it come in another color?",
      }),
    }),
  ])
  await receive(f)
  expect((await f.list()).page.map((row) => row.conversation.channel)).toEqual([
    "email",
    "whatsapp",
  ])
  expect((await f.list({ channel: "whatsapp" })).page).toHaveLength(1)
  expect((await f.list({ search: "sheena" })).page).toHaveLength(1)
  expect((await f.list({ search: "lovelace" })).page).toHaveLength(1)
  expect((await f.list({ search: "nobody" })).page).toHaveLength(0)
  expect((await f.list({ status: "closed" })).page).toHaveLength(0)
  expect(
    await f.member.client.query(api.conversations.count, {
      organizationId: f.team,
      unread: true,
    })
  ).toEqual({ total: 2 })
})

test("reading clears the unread count; closing hides a thread from Open until the person writes again", async () => {
  const f = await setup()
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  await f.member.client.mutation(api.conversations.markRead, { id })
  expect((await f.list({ unread: true })).page).toHaveLength(0)
  expect((await f.list()).page[0].conversation).toMatchObject({
    unread: false,
    unreadCount: 0,
  })
  await f.member.client.mutation(api.conversations.setStatus, {
    id,
    status: "closed",
  })
  expect((await f.list({ status: "open" })).page).toHaveLength(0)
  expect(
    await f.member.client.query(api.conversations.count, {
      organizationId: f.team,
      status: "closed",
    })
  ).toEqual({ total: 1 })
  await project(f, incoming("wamid.again"))
  expect((await f.list({ status: "open" })).page[0].conversation).toMatchObject(
    { status: "open", unread: true, unreadCount: 1 }
  )
})

test("a reply inside the window queues a dashboard message; outside it the standard 422 message comes back", async () => {
  const f = await setup()
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  const detail = await f.member.client.query(api.conversations.get, { id })
  expect(detail).toMatchObject({
    name: "Sheena Nelson",
    account: { handle: "+15550783881", wabaId: WABA_ID },
    contact: { phone: `+${SENDER}` },
  })
  expect(detail!.conversation.windowExpiresAt).toBeGreaterThan(Date.now())
  const replyId = await f.member.client.mutation(api.conversations.reply, {
    id,
    text: "On its way!",
  })
  const message = await f.t.run((ctx) =>
    ctx.db.get("channelMessages", replyId as Id<"channelMessages">)
  )
  expect(message).toMatchObject({
    source: "dashboard",
    direction: "outbound",
    status: "queued",
    to: SENDER,
    conversationId: id,
  })
  const thread1 = await f.member.client.query(api.conversations.messages, {
    id,
    paginationOpts: page,
  })
  expect(thread1.page.map((m) => [m.direction, m.text, m.status])).toEqual([
    ["outbound", "On its way!", "queued"],
    ["inbound", "Does it come in another color?", "received"],
  ])
  expect((await f.list()).page[0].conversation).toMatchObject({
    lastDirection: "outbound",
    lastPreview: "On its way!",
  })

  await expire(f, id)
  await expect(
    f.member.client.mutation(api.conversations.reply, { id, text: "Late" })
  ).rejects.toMatchObject({ data: WINDOW_CLOSED })
})

test("an approved template is sent with its variables once the window has closed", async () => {
  const f = await setup()
  fakeGraph([
    {
      method: "GET",
      path: `/${WABA_ID}/message_templates`,
      respond: () => ({
        data: [
          {
            id: "3001",
            name: "order_update",
            language: "en_US",
            category: "UTILITY",
            status: "APPROVED",
            parameter_format: "POSITIONAL",
            components: [
              {
                type: "BODY",
                text: "Hi {{1}}, your order is ready.",
                example: { body_text: [["Pablo"]] },
              },
            ],
          },
        ],
        paging: { cursors: {} },
      }),
    },
  ])
  await f.owner.client.action(api.whatsapp.templateActions.sync, {
    organizationId: f.team,
  })
  const template = await f.t.run(
    async (ctx) =>
      (await ctx.db
        .query("templates")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", f.team))
        .first())!
  )
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  await expire(f, id)
  expect(
    await f.member.client.query(api.conversations.templateVariables, {
      id,
      templateId: template._id,
    })
  ).toEqual(["1"])
  await expect(
    f.member.client.mutation(api.conversations.reply, {
      id,
      template: { id: template._id, variables: {} },
    })
  ).rejects.toMatchObject({ data: expect.stringContaining("1") })
  const sent = await f.member.client.mutation(api.conversations.reply, {
    id,
    template: { id: template._id, variables: { "1": "Ada" } },
  })
  const row = await f.t.run(async (ctx) => {
    const messageId = sent as Id<"channelMessages">
    return {
      message: await ctx.db.get("channelMessages", messageId),
      content: await ctx.db
        .query("channelMessageContents")
        .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
        .unique(),
    }
  })
  expect(row.message).toMatchObject({
    type: "template",
    preview: "[template: order_update]",
  })
  expect(JSON.parse(row.content!.payload).template).toMatchObject({
    name: "order_update",
    components: [{ type: "body", parameters: [{ type: "text", text: "Ada" }] }],
  })
})

test("received email becomes one thread per sender, linked to the contact, and a reply threads the answer", async () => {
  const f = await setup()
  const contact = await f.t.run((ctx) =>
    insertRow(ctx, "contacts", {
      organizationId: f.team,
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Byron",
      unsubscribed: false,
      properties: {},
      search: "ada@example.com Ada Byron",
      updatedAt: Date.now(),
    })
  )
  await receive(f)
  vi.setSystemTime(Date.now() + 1000)
  await receive(f, "ada@example.com", "Re: Order question")
  const id = await thread(f, "email")
  const detail = await f.member.client.query(api.conversations.get, { id })
  expect(detail).toMatchObject({
    name: "Ada Byron",
    handle: "ada@example.com",
    contact: { id: contact },
    account: null,
    lastEmail: { subject: "Re: Order question" },
    conversation: { unreadCount: 2, emailAddress: "ada@example.com" },
  })
  await expect(
    f.member.client.mutation(api.conversations.reply, { id, text: "Hi" })
  ).rejects.toMatchObject({ data: "Missing `from` field." })
  vi.setSystemTime(Date.now() + 1000)
  const emailId = await f.member.client.mutation(api.conversations.reply, {
    id,
    text: "It ships today.",
    from: "Support <support@mail.example.test>",
  })
  const sent = await f.t.run(async (ctx) => ({
    email: await ctx.db.get("emails", emailId as Id<"emails">),
    content: await ctx.db
      .query("emailContents")
      .withIndex("by_emailId", (q) => q.eq("emailId", emailId as Id<"emails">))
      .unique(),
  }))
  expect(sent.email).toMatchObject({
    to: ["ada@example.com"],
    subject: "Re: Order question",
    source: "dashboard",
  })
  expect(sent.content?.headers).toEqual([
    { name: "In-Reply-To", value: "<question@example.com>" },
    { name: "References", value: "<question@example.com>" },
  ])
  const messages = await f.member.client.query(api.conversations.messages, {
    id,
    paginationOpts: page,
  })
  expect(messages.page.map((m) => [m.kind, m.direction, m.text])).toEqual([
    ["email", "outbound", "It ships today."],
    ["received", "inbound", "Where is my order?"],
    ["received", "inbound", "Where is my order?"],
  ])
  expect((await f.list()).page[0].conversation).toMatchObject({
    lastDirection: "outbound",
    lastPreview: "It ships today.",
    // A send keeps the name mail gave the thread.
    search: expect.stringContaining("Ada Lovelace"),
  })
})

test("another team cannot list, read, change or reply to a thread", async () => {
  const f = await setup()
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  const outsider = f.outsider.client
  await expect(
    outsider.query(api.conversations.list, {
      organizationId: f.team,
      paginationOpts: page,
    })
  ).rejects.toBeDefined()
  await expect(
    outsider.query(api.conversations.get, { id })
  ).rejects.toBeDefined()
  await expect(
    outsider.query(api.conversations.messages, { id, paginationOpts: page })
  ).rejects.toBeDefined()
  for (const call of [
    () => outsider.mutation(api.conversations.markRead, { id }),
    () =>
      outsider.mutation(api.conversations.setStatus, { id, status: "closed" }),
    () => outsider.mutation(api.conversations.reply, { id, text: "Hi" }),
  ])
    await expect(call()).rejects.toBeDefined()
  expect(
    (
      await outsider.query(api.conversations.list, {
        organizationId: f.outsider.team,
        paginationOpts: page,
      })
    ).page
  ).toHaveLength(0)
  expect((await f.list()).page[0].conversation.unread).toBe(true)
})

test("Sending and Receiving merge email and WhatsApp by time, and filter by channel and status", async () => {
  const f = await setup()
  await project(f, incoming())
  vi.setSystemTime(Date.now() + 1000)
  await receive(f)
  vi.setSystemTime(Date.now() + 1000)
  const whatsapp = (await f.member.client.mutation(api.conversations.reply, {
    id: await thread(f, "whatsapp"),
    text: "On its way!",
  })) as Id<"channelMessages">
  vi.setSystemTime(Date.now() + 1000)
  const email = (await f.member.client.mutation(api.conversations.reply, {
    id: await thread(f, "email"),
    text: "Shipped.",
    from: "support@mail.example.test",
  })) as Id<"emails">
  const sending = (filters: Record<string, unknown> = {}) =>
    f.member.client.query(api.messages.sending, {
      organizationId: f.team,
      paginationOpts: page,
      ...filters,
    })
  const ids = (rows: Awaited<ReturnType<typeof sending>>) =>
    rows.page.map((row) =>
      row.kind === "email" ? row.email._id : row.message._id
    )
  expect(ids(await sending())).toEqual([email, whatsapp])
  expect(ids(await sending({ channel: "whatsapp" }))).toEqual([whatsapp])
  expect(ids(await sending({ channel: "email" }))).toEqual([email])
  expect(ids(await sending({ status: "queued" }))).toEqual([email, whatsapp])
  expect(ids(await sending({ status: "opened" }))).toEqual([])
  expect(ids(await sending({ search: "on its way" }))).toEqual([whatsapp])
  // One row a page still pages through both tables in order.
  const first = await f.member.client.query(api.messages.sending, {
    organizationId: f.team,
    paginationOpts: { cursor: null, numItems: 1 },
  })
  const second = await f.member.client.query(api.messages.sending, {
    organizationId: f.team,
    paginationOpts: { cursor: first.continueCursor, numItems: 1 },
  })
  expect([...ids(first), ...ids(second)]).toEqual([email, whatsapp])
  expect(
    await f.member.client.query(api.messages.sendingCount, {
      organizationId: f.team,
    })
  ).toEqual({ total: 2 })
  expect(
    await f.member.client.query(api.messages.sendingCount, {
      organizationId: f.team,
      channel: "whatsapp",
    })
  ).toEqual({ total: 1 })

  const receiving = await f.member.client.query(api.messages.receiving, {
    organizationId: f.team,
    paginationOpts: page,
  })
  expect(receiving.page.map((row) => row.kind)).toEqual(["email", "channel"])
  expect(
    await f.member.client.query(api.messages.receivingCount, {
      organizationId: f.team,
    })
  ).toEqual({ total: 2 })
  expect(
    (
      await f.member.client.query(api.messages.receiving, {
        organizationId: f.team,
        channel: "whatsapp",
        paginationOpts: page,
      })
    ).page
  ).toHaveLength(1)

  const detail = await f.member.client.query(api.messages.get, {
    id: whatsapp,
  })
  expect(detail).toMatchObject({
    message: { _id: whatsapp, status: "queued" },
    account: { handle: "+15550783881" },
    events: [expect.objectContaining({ type: "queued" })],
  })
  expect(JSON.parse(detail!.payload)).toMatchObject({ to: SENDER })
  await expect(
    f.outsider.client.query(api.messages.get, { id: whatsapp })
  ).rejects.toBeDefined()
  await expect(
    f.outsider.client.query(api.messages.sending, {
      organizationId: f.team,
      paginationOpts: page,
    })
  ).rejects.toBeDefined()
})
