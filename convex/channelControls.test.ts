import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import {
  inboundFixture,
  fakeGraph,
  graphError,
  incoming,
  signedWebhook,
  APP_SECRET,
  PHONE_ID,
} from "./testHelpers/meta.fixture"
import {
  pagesFixture,
  pageGraphRoutes,
  pageEnvelope,
  PAGE_ID,
  PSID,
  IGSID,
} from "./testHelpers/pages.fixture"
import { patchRow } from "./counts"
import type { MessagingChannel } from "../lib/channels"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
  vi.stubEnv("BETTER_AUTH_SECRET", "controls-test-secret-32-bytes!!")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function setup(channel: MessagingChannel = "whatsapp") {
  const graph = fakeGraph(
    channel === "whatsapp"
      ? [
          {
            method: "POST",
            path: `/${PHONE_ID}/messages`,
            respond: () => ({ success: true }),
          },
        ]
      : pageGraphRoutes()
  )
  const f =
    channel === "whatsapp" ? await inboundFixture() : await pagesFixture()
  if ("account" in f)
    await f.t.run((ctx) =>
      patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
    )
  const body =
    channel === "whatsapp"
      ? incoming()
      : pageEnvelope(channel, {
          message: { mid: "mid.inbound", text: "Hello" },
        })
  expect(
    (await f.t.fetch("/meta/webhook", await signedWebhook(APP_SECRET, body)))
      .status
  ).toBe(200)
  const event = await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  )
  await f.t.mutation(internal.meta.projection.project, { id: event!._id })
  const message = await f.t.run((ctx) =>
    ctx.db.query("channelMessages").order("desc").first()
  )
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Controls", permission: "full_access", domainId: null },
  })
  const call = (path: string, body: unknown = {}, bearer = token) =>
    f.t.fetch(`/${channel}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  return {
    ...f,
    graph,
    message: message!,
    call,
    channel,
    endpoint: channel === "whatsapp" ? PHONE_ID : PAGE_ID,
  }
}

describe("Meta conversation controls", () => {
  test.each(["whatsapp", "messenger", "instagram"] as const)(
    "%s sends exact read and typing bodies with the configured endpoint/token",
    async (channel) => {
      const f = await setup(channel)
      const response = await f.call(`messages/${f.message._id}/read`, {
        typing: true,
      })
      expect(response.status).toBe(200)
      const calls = f.graph.to(`/${f.endpoint}/messages`, "POST")
      expect(calls.map((c) => c.body)).toEqual(
        channel === "whatsapp"
          ? [
              {
                messaging_product: "whatsapp",
                status: "read",
                message_id: "wamid.inbound",
                typing_indicator: { type: "text" },
              },
            ]
          : [
              {
                recipient: { id: channel === "messenger" ? PSID : IGSID },
                sender_action: "mark_seen",
              },
              {
                recipient: { id: channel === "messenger" ? PSID : IGSID },
                sender_action: "typing_on",
              },
            ]
      )
      expect(
        calls.every(
          (c) => c.version === "v25.0" && c.authorization?.startsWith("Bearer ")
        )
      ).toBe(true)
      const detail = await f.t.query(internal.api.channelMessages.get, {
        caller: await caller(f),
        channel,
        id: f.message._id,
      })
      expect(detail?.normalized.read_receipt_sent_at).toBe(
        new Date(Date.now()).toISOString()
      )
      const events = await f.t.run((ctx) => ctx.db.query("events").collect())
      expect(
        events.some((e) => e.type === `${channel}.message.read_receipt_sent`)
      ).toBe(true)
    }
  )
  test("read calls are atomic per conversation, even for different inbound messages", async () => {
    const f = await setup()
    expect((await f.call(`messages/${f.message._id}/read`)).status).toBe(200)
    const second = await f.t.run(async (ctx) => {
      const { _id, _creationTime, ...data } = f.message
      void _id
      void _creationTime
      return ctx.db.insert("channelMessages", {
        ...data,
        externalId: "wamid.new",
      })
    })
    expect((await f.call(`messages/${second}/read`)).status).toBe(202)
    expect(f.graph.to(`/${PHONE_ID}/messages`)).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    expect((await f.call(`messages/${second}/read`)).status).toBe(200)
    expect(f.graph.to(`/${PHONE_ID}/messages`)).toHaveLength(2)
  })
  test.each(["messenger", "instagram"] as const)(
    "%s typing throttles for five seconds and supports off",
    async (channel) => {
      const f = await setup(channel)
      const path = `conversations/${f.message.conversationId}/typing`
      expect((await f.call(path, { on: true })).status).toBe(200)
      expect((await f.call(path, { on: false })).status).toBe(202)
      vi.advanceTimersByTime(5000)
      expect((await f.call(path, { on: false })).status).toBe(200)
      expect(f.graph.to(`/${PAGE_ID}/messages`).map((c) => c.body)).toEqual([
        {
          recipient: { id: channel === "messenger" ? PSID : IGSID },
          sender_action: "typing_on",
        },
        {
          recipient: { id: channel === "messenger" ? PSID : IGSID },
          sender_action: "typing_off",
        },
      ])
    }
  )
  test.each(["messenger", "instagram"] as const)(
    "%s typing can use an outbound-only conversation without a message age limit",
    async (channel) => {
      const f = await setup(channel)
      const recipient = channel === "messenger" ? PSID : IGSID
      await f.t.run((ctx) =>
        ctx.db.patch("channelMessages", f.message._id, {
          direction: "outbound",
          from: PAGE_ID,
          to: recipient,
          externalId: undefined,
          observedAt: Date.now() - 31 * 86400_000,
        })
      )
      expect(
        (
          await f.call(`conversations/${f.message.conversationId}/typing`, {
            on: true,
          })
        ).status
      ).toBe(200)
      expect(f.graph.to(`/${PAGE_ID}/messages`)[0].body).toEqual({
        recipient: { id: recipient },
        sender_action: "typing_on",
      })
    }
  )
  test("WhatsApp typing uses the latest inbound, records its receipt, throttles and rejects off", async () => {
    const f = await setup()
    const second = await f.t.run(async (ctx) => {
      const { _id, _creationTime, ...data } = f.message
      void _id
      void _creationTime
      return ctx.db.insert("channelMessages", {
        ...data,
        externalId: "wamid.latest",
      })
    })
    const path = `conversations/${f.message.conversationId}/typing`
    expect((await f.call(path, { on: true })).status).toBe(200)
    expect(f.graph.to(`/${PHONE_ID}/messages`)[0].body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.latest",
      typing_indicator: { type: "text" },
    })
    expect(
      await f.t.run((ctx) => ctx.db.get("channelMessages", second))
    ).toHaveProperty("readReceiptSentAt")
    expect((await f.call(path, { on: true })).status).toBe(202)
    expect((await f.call(path, { on: false })).status).toBe(422)
    expect(f.graph.to(`/${PHONE_ID}/messages`)).toHaveLength(1)
  })
  test("outbound, stale and foreign messages never reach Meta; body and write scopes are enforced", async () => {
    const f = await setup()
    await f.t.run((ctx) =>
      ctx.db.patch("channelMessages", f.message._id, { direction: "outbound" })
    )
    expect((await f.call(`messages/${f.message._id}/read`)).status).toBe(422)
    await f.t.run((ctx) =>
      ctx.db.patch("channelMessages", f.message._id, {
        direction: "inbound",
        observedAt: Date.now() - 31 * 86400_000,
      })
    )
    const old = await f.call(`messages/${f.message._id}/read`)
    expect(old.status).toBe(422)
    expect(await old.text()).toContain("30 days")
    await f.t.run((ctx) =>
      ctx.db.patch("channelMessages", f.message._id, {
        organizationId: "another-team",
      })
    )
    expect((await f.call(`messages/${f.message._id}/read`)).status).toBe(404)
    expect(
      (await f.call(`messages/${f.message._id}/read`, { typing: "yes" })).status
    ).toBe(422)
    expect(
      (await f.call(`conversations/${f.message.conversationId}/typing`, {}))
        .status
    ).toBe(422)
    const key = await f.owner.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: {
        name: "Read only",
        permission: "custom",
        scopes: ["whatsapp:read"],
        domainId: null,
      },
    })
    expect(
      (await f.call(`messages/${f.message._id}/read`, {}, key.token)).status
    ).toBe(403)
    expect(
      (
        await f.call(
          `conversations/${f.message.conversationId}/typing`,
          { on: true },
          key.token
        )
      ).status
    ).toBe(403)
    expect(f.graph.to(`/${PHONE_ID}/messages`)).toHaveLength(0)
  })
  test("conversation isolation and repeated idempotency keys prevent extra provider calls", async () => {
    const f = await setup()
    const headers = {
      Authorization: `Bearer ${(await f.owner.client.action(api.apiKeys.create, { organizationId: f.owner.team, input: { name: "Idempotency", permission: "full_access", domainId: null } })).token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "receipt-key",
    }
    const send = () =>
      f.t.fetch(`/whatsapp/messages/${f.message._id}/read`, {
        method: "POST",
        headers,
        body: "{}",
      })
    expect((await send()).status).toBe(200)
    vi.advanceTimersByTime(2100)
    expect((await send()).status).toBe(200)
    expect(f.graph.to(`/${PHONE_ID}/messages`)).toHaveLength(1)
    await f.t.run((ctx) =>
      ctx.db.patch("conversations", f.message.conversationId, {
        organizationId: "foreign-team",
      })
    )
    expect(
      (
        await f.call(`conversations/${f.message.conversationId}/typing`, {
          on: true,
        })
      ).status
    ).toBe(404)
  })
  test("dashboard markRead clears counters and schedules exactly one receipt for the latest inbound", async () => {
    const f = await setup()
    const second = await f.t.run(async (ctx) => {
      const { _id, _creationTime, ...data } = f.message
      void _id
      void _creationTime
      return ctx.db.insert("channelMessages", {
        ...data,
        externalId: "wamid.latest",
      })
    })
    for (let i = 0; i < 2; i++)
      await f.member.client.mutation(api.conversations.markRead, {
        id: f.message.conversationId,
      })
    const jobs = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    )
    const receipts = jobs.filter(
      (j) => j.name === "channels/controlActions:send"
    )
    expect(receipts).toHaveLength(1)
    expect(receipts[0].args).toEqual([{ messageId: second, read: true }])
    expect(
      await f.t.run((ctx) =>
        ctx.db.get("conversations", f.message.conversationId)
      )
    ).toMatchObject({ unread: false, unreadCount: 0 })
    await f.t.action(internal.channels.controlActions.send, {
      messageId: second,
      read: true,
    })
    expect(f.graph.to(`/${PHONE_ID}/messages`)[0].body).toMatchObject({
      message_id: "wamid.latest",
    })
  })
  test("a failed typing_on after a successful Page receipt preserves its timestamp and records only typing failure", async () => {
    const f = await setup("instagram")
    f.graph.use({
      path: `/${PAGE_ID}/messages`,
      respond: (call) =>
        (call.body as { sender_action: string }).sender_action === "typing_on"
          ? graphError("Typing refused", 100)
          : { recipient_id: IGSID },
    })
    expect(
      (await f.call(`messages/${f.message._id}/read`, { typing: true })).status
    ).toBe(502)
    expect(
      await f.t.run((ctx) => ctx.db.get("channelMessages", f.message._id))
    ).toHaveProperty("readReceiptSentAt")
    const events = await f.t.run((ctx) =>
      ctx.db
        .query("channelMessageEvents")
        .withIndex("by_messageId_and_at", (q) =>
          q.eq("messageId", f.message._id)
        )
        .collect()
    )
    expect(events.map((e) => e.type)).toEqual([
      "received",
      "read_receipt_sent",
      "typing_failed",
    ])
  })
  test("Graph failures log readable trail entries, leave receipt time unset and do not change message status", async () => {
    const f = await setup()
    f.graph.use({
      path: `/${PHONE_ID}/messages`,
      respond: () => graphError("Receipt refused", 100),
    })
    expect((await f.call(`messages/${f.message._id}/read`)).status).toBe(502)
    const message = await f.t.run((ctx) =>
      ctx.db.get("channelMessages", f.message._id)
    )
    expect(message?.readReceiptSentAt).toBeUndefined()
    expect(message?.status).toBe("received")
    const events = await f.t.run((ctx) =>
      ctx.db
        .query("channelMessageEvents")
        .withIndex("by_messageId_and_at", (q) =>
          q.eq("messageId", f.message._id)
        )
        .collect()
    )
    expect(events.at(-1)).toMatchObject({ type: "read_receipt_failed" })
    expect(events.at(-1)?.details).toContain("Read receipt failed:")
  })
  test("dashboard receipt preparation failures clear unread and are logged", async () => {
    const f = await setup()
    await f.t.run((ctx) =>
      ctx.db.patch("channelMessages", f.message._id, {
        observedAt: Date.now() - 31 * 86400_000,
      })
    )
    await f.member.client.mutation(api.conversations.markRead, {
      id: f.message.conversationId,
    })
    expect(
      await f.t.run((ctx) =>
        ctx.db.get("conversations", f.message.conversationId)
      )
    ).toMatchObject({ unread: false, unreadCount: 0 })
    expect(
      (
        await f.t.run((ctx) =>
          ctx.db
            .query("channelMessageEvents")
            .withIndex("by_messageId_and_at", (q) =>
              q.eq("messageId", f.message._id)
            )
            .collect()
        )
      ).at(-1)?.details
    ).toContain("Read receipt failed:")
    expect(f.graph.to(`/${PHONE_ID}/messages`)).toHaveLength(0)
  })
})
async function caller(f: Awaited<ReturnType<typeof setup>>) {
  const key = await f.t.run((ctx) =>
    ctx.db
      .query("apiKeys")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.owner.team)
      )
      .first()
  )
  return {
    organizationId: f.owner.team,
    apiKeyId: key!._id,
    name: "Controls",
    permission: "full_access" as const,
  }
}
