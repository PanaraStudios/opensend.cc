import type { FunctionReturnType } from "convex/server"
import { withoutSystemFields } from "convex-helpers"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { fixture } from "./testHelpers/ses.fixture"
import { inboundFixture, fakeGraph, SENDER } from "./testHelpers/meta.fixture"
import {
  pagesFixture,
  pageGraphRoutes,
  PSID,
} from "./testHelpers/pages.fixture"
import { upsertChannelThread, upsertEmailThread } from "./channels/identity"
import { insertContact } from "./audience"
import { insertRow } from "./counts"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "history-test-secret-".repeat(4))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const page = { cursor: null, numItems: 10 }

test.each(["whatsapp", "messenger"] as const)(
  "%s history works without an email and isolates teams",
  async (channel) => {
    fakeGraph(pageGraphRoutes())
    const f =
      channel === "whatsapp" ? await inboundFixture() : await pagesFixture()
    const accountId =
      "account" in f
        ? f.account
        : f.accounts.find((a) => a.channel === channel)!.id
    const ids = await f.t.run(async (ctx) => {
      const account = await ctx.db.get("channelAccounts", accountId)
      const ids = await upsertChannelThread(ctx, account!, {
        externalId: channel === "whatsapp" ? SENDER : PSID,
        phone: channel === "whatsapp" ? `+${SENDER}` : undefined,
        at: Date.now(),
        preview: "Customer question",
        direction: "inbound",
      })
      const messageId = await insertRow(ctx, "channelMessages", {
        organizationId: f.owner.team,
        channel,
        accountId,
        conversationId: ids.conversationId,
        channelContactId: ids.channelContactId,
        direction: "inbound",
        from: "person",
        to: account!.externalId,
        type: "text",
        status: "received",
        preview: "Customer question",
        generation: 0,
        attempts: 0,
      })
      const thread = (await ctx.db.get("conversations", ids.conversationId))!
      const fields = withoutSystemFields(thread)
      await ctx.db.insert("conversations", {
        ...fields,
        organizationId: f.outsider.team,
        lastPreview: "Private other-team thread",
      })
      return { ...ids, messageId }
    })
    const args = {
      organizationId: f.owner.team,
      contactId: ids.contactId,
      paginationOpts: page,
    }
    const result = await f.owner.client.query(
      api.conversations.contactHistory,
      args
    )
    expect(result.page).toHaveLength(1)
    expect(result.page[0]).toMatchObject({
      conversation: {
        channel,
        unread: true,
        unreadCount: 1,
        lastPreview: "Customer question",
      },
      latest: { kind: "channel", id: ids.messageId },
      accountHandle: channel === "whatsapp" ? "+15550783881" : "Acme Page",
    })
    const contact = await f.t.run((ctx) =>
      ctx.db.get("contacts", ids.contactId)
    )
    expect(contact?.email).toBeUndefined()
    await expect(
      f.outsider.client.query(api.conversations.contactHistory, args)
    ).rejects.toMatchObject({ data: "You do not have permission" })
    await expect(
      f.outsider.client.query(api.conversations.contactHistory, {
        ...args,
        organizationId: f.outsider.team,
      })
    ).rejects.toMatchObject({ data: "Contact not found" })
    if (channel === "whatsapp") {
      const identities = await f.owner.client.query(api.contacts.identities, {
        id: ids.contactId,
        paginationOpts: page,
      })
      expect(identities.page[0].accounts).toEqual([
        { id: accountId, name: "Lucky Shrub" },
      ])
    }
  }
)

test("email threads created before linking a contact are included once and link to the latest email", async () => {
  const f = await fixture()
  const address = "ada@example.com"
  const contactId = await f.t.run((ctx) =>
    insertContact(ctx, f.owner.team, { email: address })
  )
  const sent = await f.t.run(async (ctx) => {
    const email = await insertRow(ctx, "emails", {
      organizationId: f.owner.team,
      domainId: f.domain,
      from: "team@example.com",
      to: [address],
      subject: "Reply",
      status: "sent",
      source: "dashboard",
      generation: 0,
      attempts: 0,
      search: address,
    })
    await insertRow(ctx, "emailRecipients", {
      organizationId: f.owner.team,
      emailId: email,
      address,
    })
    const conversationId = await upsertEmailThread(ctx, {
      organizationId: f.owner.team,
      address,
      at: Date.now(),
      preview: "Reply",
      direction: "outbound",
    })
    await ctx.db.patch("conversations", conversationId, {
      contactId: undefined,
    })
    await upsertEmailThread(ctx, {
      organizationId: f.outsider.team,
      address,
      at: Date.now(),
      preview: "Private",
      direction: "outbound",
    })
    return { email, conversationId }
  })
  const args = { organizationId: f.owner.team, contactId, paginationOpts: page }
  let history = await f.owner.client.query(
    api.conversations.contactHistory,
    args
  )
  expect(history.page).toHaveLength(1)
  expect(history.page[0]).toMatchObject({
    conversation: { channel: "email" },
    accountHandle: address,
    latest: { id: sent.email, kind: "email" },
  })
  await f.t.run((ctx) =>
    ctx.db.patch("conversations", sent.conversationId, { contactId })
  )
  history = await f.owner.client.query(api.conversations.contactHistory, args)
  expect(history.page).toHaveLength(1)
  vi.advanceTimersByTime(1000)
  const receivedId = await f.t.run(async (ctx) => {
    const rawId = await ctx.storage.store(new Blob(["raw"]))
    const inboundId = await ctx.db.insert("inboundMessages", {
      organizationId: f.owner.team,
      domainId: f.domain,
      region: "us-east-1",
      topicArn: "topic",
      messageId: "inbound",
      sesMessageId: "inbound",
      bucket: "test",
      objectKey: "inbound",
      storageId: rawId,
      notification: "{}",
    })
    const values = {
      organizationId: f.owner.team,
      inboundId,
      domainId: f.domain,
      from: address,
      sender: address,
      to: ["team@example.com"],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "New question",
      messageId: "question",
      receivedFor: ["team@example.com"],
      authentication: {},
      receivedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      rawId,
    }
    const id = await insertRow(ctx, "receivedEmails", values)
    await ctx.db.insert("receivedEmails", {
      ...values,
      organizationId: f.outsider.team,
      receivedAt: Date.now() + 10000,
    })
    return id
  })
  expect(
    (await f.owner.client.query(api.conversations.contactHistory, args)).page[0]
      .latest
  ).toEqual({ id: receivedId, kind: "received" })
  await expect(
    f.outsider.client.query(api.conversations.contactHistory, args)
  ).rejects.toMatchObject({ data: "You do not have permission" })
})

test("contact broadcast history pages WhatsApp and email recipients by contact, scoped to the team", async () => {
  const f = await fixture()
  const contactId = await f.t.run((ctx) =>
    insertContact(ctx, f.owner.team, {
      email: "ada@example.com",
      phone: "+12345678",
    })
  )
  async function recipient(
    channel: "email" | "whatsapp",
    organizationId: string
  ) {
    return f.t.run(async (ctx) => {
      const broadcast = await insertRow(ctx, "broadcasts", {
        organizationId,
        channel,
        name: `${channel} campaign`,
        subject: "Hello",
        preview: "",
        segmentId: null,
        topicId: null,
        status: "sent",
        updatedAt: Date.now(),
        generation: 1,
        audienceDone: true,
      })
      await insertRow(ctx, "broadcastRecipients", {
        organizationId,
        broadcastId: broadcast,
        contactId,
        email: channel === "email" ? "ada@example.com" : "",
        skipReason: channel === "whatsapp" ? "missing_variables" : undefined,
        failed: false,
        sent: channel === "email",
        settled: true,
      })
      return broadcast
    })
  }
  const expected = [
    await recipient("whatsapp", f.owner.team),
    await recipient("email", f.owner.team),
  ]
  await recipient("whatsapp", f.outsider.team)
  await recipient("email", f.outsider.team)
  const args = { organizationId: f.owner.team, contactId }
  const ids: Id<"broadcasts">[] = []
  let cursor: string | null = null
  let whatsapp: Doc<"broadcastRecipients"> | undefined
  for (let i = 0; i < 10; i++) {
    const result: FunctionReturnType<typeof api.broadcasts.history> =
      await f.owner.client.query(api.broadcasts.history, {
        ...args,
        paginationOpts: { cursor, numItems: 1 },
      })
    ids.push(...result.page.map((row) => row._id))
    whatsapp ??= result.page.find(
      (row) => row.channel === "whatsapp"
    )?.recipient
    if (result.isDone) break
    cursor = result.continueCursor
  }
  expect(ids).toHaveLength(2)
  expect(new Set(ids)).toEqual(new Set(expected))
  expect(whatsapp).toMatchObject({ contactId, skipReason: "missing_variables" })
  expect(await f.owner.client.query(api.broadcasts.historyCount, args)).toEqual(
    { total: null }
  )
  expect(
    (
      await f.owner.client.query(api.broadcasts.history, {
        organizationId: f.owner.team,
        email: "ada@example.com",
        paginationOpts: page,
      })
    ).page
  ).toHaveLength(1)
  await f.owner.client.mutation(api.contacts.update, {
    id: contactId,
    email: "",
  })
  const phoneHistory = await f.owner.client.query(api.broadcasts.history, {
    ...args,
    paginationOpts: page,
  })
  expect(phoneHistory.page.map((row) => row._id)).toContain(expected[0])
  await expect(
    f.outsider.client.query(api.broadcasts.history, {
      ...args,
      paginationOpts: page,
    })
  ).rejects.toMatchObject({ data: "You do not have permission" })
  await expect(
    f.outsider.client.query(api.broadcasts.history, {
      ...args,
      organizationId: f.outsider.team,
      paginationOpts: page,
    })
  ).rejects.toMatchObject({ data: "Contact not found" })
})
