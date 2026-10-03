import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, internal } from "./_generated/api"
import { PAGE_CHANNELS, type PageChannel } from "../lib/channels"
import { skipReasonLabel } from "../lib/dashboard/format"
import { fakeGraph } from "./testHelpers/meta.fixture"
import {
  pagesFixture,
  pageGraphRoutes,
  PAGE_ID,
} from "./testHelpers/pages.fixture"
import { upsertChannelThread } from "./channels/identity"
import { patchRow } from "./counts"
import { sendWhatsAppRecipient } from "./broadcastWhatsApp"
import { resolvePageBroadcast } from "./broadcastMessaging"

let graph: ReturnType<typeof fakeGraph>
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "broadcast-page-key-".repeat(4))
  vi.stubEnv("BETTER_AUTH_SECRET", "broadcast-page-secret-".repeat(4))
  graph = fakeGraph(pageGraphRoutes())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function setup(channel: PageChannel) {
  const f = await pagesFixture()
  workpoolTest.register(f.t, "webhookPool")
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
  })
  const accountId = f.accounts.find((a) => a.channel === channel)!.id
  const people = await f.t.run(async (ctx) => {
    const account = (await ctx.db.get("channelAccounts", accountId))!
    const open = await upsertChannelThread(ctx, account, {
      externalId: "101",
      profileName: "Open Person",
      at: Date.now(),
      direction: "inbound",
      preview: "Hi",
    })
    const closed = await upsertChannelThread(ctx, account, {
      externalId: "102",
      profileName: "Closed Person",
      at: Date.now() - 25 * 3600_000,
      direction: "inbound",
      preview: "Hi",
    })
    return { open, closed }
  })
  const [missing] = (
    await f.owner.client.mutation(api.contacts.upsert, {
      organizationId: f.owner.team,
      contacts: [{ email: "missing@example.test", firstName: "Missing" }],
      segmentIds: [],
    })
  ).createdIds
  const templateId = await f.owner.client.mutation(api.templates.create, {
    organizationId: f.owner.team,
    channel,
    name: "Page broadcast",
    content: { text: "Hello {{{name}}}" },
  })
  await f.owner.client.mutation(api.templates.publish, { id: templateId })
  const messaging = {
    accountId,
    templateId,
    variables: { name: { contact: "firstName" as const, fallback: "friend" } },
  }
  const id = await f.owner.client.mutation(api.broadcasts.create, {
    organizationId: f.owner.team,
    channel,
    messaging,
    name: "Page campaign",
  })
  const scope = { organizationId: f.owner.team, id }
  const recipients = () =>
    f.owner.client.query(api.broadcastWhatsApp.recipients, {
      ...scope,
      paginationOpts: { numItems: 50, cursor: null },
    })
  const fanout = async () => {
    await f.owner.client.mutation(api.broadcasts.send, { id })
    await f.t.run((ctx) =>
      patchRow(ctx, "broadcasts", id, { audienceBefore: Date.now() + 1000 })
    )
    const row = (await f.t.run((ctx) => ctx.db.get("broadcasts", id)))!
    await f.t.mutation(internal.broadcastSend.batch, {
      id,
      generation: row.generation,
    })
    return row
  }
  return { ...f, ...people, missing, messaging, scope, id, recipients, fanout }
}
for (const channel of PAGE_CHANNELS) {
  test(`${channel} reviews reachable count, sends open windows, skips closed/missing identities and retries idempotently`, async () => {
    const f = await setup(channel)
    expect(
      await f.owner.client.action(api.broadcastWhatsApp.review, f.scope)
    ).toEqual({ recipients: 1, skipped: 2, noPhone: 0 })
    const row = await f.fanout()
    const page = await f.recipients()
    expect(page.page).toHaveLength(3)
    const open = page.page.find((r) => r.contactId === f.open.contactId)!
    expect(open).toMatchObject({
      messageStatus: "queued",
      settled: false,
      failed: false,
    })
    expect(
      page.page.find((r) => r.contactId === f.closed.contactId)
    ).toMatchObject({
      skipReason: "window_closed",
      settled: true,
      failed: false,
    })
    expect(page.page.find((r) => r.contactId === f.missing)).toMatchObject({
      skipReason: "no_channel_identity",
      settled: true,
      failed: false,
    })
    expect(skipReasonLabel("window_closed")).toBe("Messaging window closed")
    expect(skipReasonLabel("no_channel_identity")).toBe("No channel identity")
    await f.t.run(async (ctx) => {
      const broadcast = (await ctx.db.get("broadcasts", f.id))!
      const contact = (await ctx.db.get("contacts", f.open.contactId!))!
      await sendWhatsAppRecipient(
        ctx,
        broadcast,
        contact,
        null,
        await resolvePageBroadcast(ctx, f.owner.team, channel, f.messaging)
      )
    })
    expect(
      await f.t.mutation(internal.broadcastSend.batch, {
        id: f.id,
        generation: row.generation,
      })
    ).toBe(true)
    expect((await f.recipients()).page).toHaveLength(3)
    const message = (await f.t.run((ctx) =>
      ctx.db.get("channelMessages", open.messageId!)
    ))!
    const claim = await f.t.mutation(internal.channels.messages.claim, {
      id: message._id,
      generation: message.generation,
    })
    expect(JSON.parse(claim!.payload)).toMatchObject({
      recipient: { id: "101" },
      messaging_type: "RESPONSE",
      message: { text: "Hello Open" },
    })
    expect(JSON.parse(claim!.payload)).not.toHaveProperty("tag")
    expect(
      await f.t.mutation(internal.channels.messages.claim, {
        id: message._id,
        generation: message.generation,
      })
    ).toBeNull()
    await f.t.run(async (ctx) => {
      const current = await patchRow(ctx, "channelMessages", message._id, {
        status: "delivered",
        sentAt: Date.now(),
      })
      const { broadcastMessageMetric } = await import("./broadcastMetrics")
      await broadcastMessageMetric(ctx, current)
    })
    expect(
      await f.owner.client.query(api.broadcastMetrics.channelStats, f.scope)
    ).toEqual({
      channel,
      stats: {
        recipients: 1,
        sent: 1,
        delivered: 1,
        read: 0,
        failed: 0,
        skipped: 2,
      },
    })
    expect(
      (await f.recipients()).page.find((r) => r.contactId === f.open.contactId)
    ).toMatchObject({ settled: true, failed: false })
  })
  test(`${channel} delivers through fake Graph once and reuses channel event shapes`, async () => {
    const f = await setup(channel)
    await f.fanout()
    const recipient = (await f.recipients()).page.find(
      (r) => r.contactId === f.open.contactId
    )!
    const message = (await f.t.run((ctx) =>
      ctx.db.get("channelMessages", recipient.messageId!)
    ))!
    const args = { id: message._id, generation: message.generation }
    await f.t.action(internal.channels.deliver.deliver, args)
    await f.t.action(internal.channels.deliver.deliver, args)
    expect(graph.to(`/${PAGE_ID}/messages`, "POST")).toHaveLength(1)
    expect(graph.to(`/${PAGE_ID}/messages`, "POST")[0].body).toMatchObject({
      recipient: { id: "101" },
      messaging_type: "RESPONSE",
      message: { text: "Hello Open" },
    })
    expect(graph.to(`/${PAGE_ID}/messages`, "POST")[0].body).not.toHaveProperty(
      "tag"
    )
    const sent = (await f.t.run((ctx) =>
      ctx.db.get("channelMessages", message._id)
    ))!
    expect(sent).toMatchObject({
      status: "sent",
      source: "broadcast",
      broadcastId: f.id,
    })
    expect(
      await f.owner.client.query(api.broadcastMetrics.channelStats, f.scope)
    ).toEqual({
      channel,
      stats: {
        recipients: 1,
        sent: 1,
        delivered: 0,
        read: 0,
        failed: 0,
        skipped: 2,
      },
    })
    const events = await f.t.run((ctx) =>
      ctx.db
        .query("channelMessageEvents")
        .withIndex("by_messageId_and_at", (q) => q.eq("messageId", message._id))
        .take(20)
    )
    expect(events.filter((event) => event.type === "sent")).toHaveLength(1)
  })
  test(`${channel} rechecks an expired window after review and while queued`, async () => {
    const f = await setup(channel)
    expect(
      (await f.owner.client.action(api.broadcastWhatsApp.review, f.scope))
        .recipients
    ).toBe(1)
    await f.fanout()
    const recipient = (await f.recipients()).page.find(
      (r) => r.contactId === f.open.contactId
    )!
    await f.t.run((ctx) =>
      patchRow(ctx, "conversations", f.open.conversationId, {
        windowExpiresAt: Date.now(),
      })
    )
    const message = (await f.t.run((ctx) =>
      ctx.db.get("channelMessages", recipient.messageId!)
    ))!
    expect(
      await f.t.mutation(internal.channels.messages.claim, {
        id: message._id,
        generation: message.generation,
      })
    ).toBeNull()
    expect(
      (await f.recipients()).page.find((r) => r.contactId === f.open.contactId)
    ).toMatchObject({
      skipReason: "window_closed",
      settled: true,
      failed: false,
    })
    expect(
      await f.owner.client.query(api.broadcastMetrics.channelStats, f.scope)
    ).toEqual({
      channel,
      stats: {
        recipients: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        skipped: 3,
      },
    })
  })
  test(`${channel} skips a window that closes between review and fanout`, async () => {
    const f = await setup(channel)
    expect(
      (await f.owner.client.action(api.broadcastWhatsApp.review, f.scope))
        .recipients
    ).toBe(1)
    await f.t.run((ctx) =>
      patchRow(ctx, "conversations", f.open.conversationId, {
        windowExpiresAt: Date.now(),
      })
    )
    await f.fanout()
    expect(
      (await f.recipients()).page.every((recipient) => !recipient.messageId)
    ).toBe(true)
    expect(
      (await f.recipients()).page.find((r) => r.contactId === f.open.contactId)
    ).toMatchObject({ skipReason: "window_closed" })
  })
  test(`${channel} identity is scoped to the chosen account and published template`, async () => {
    const f = await setup(channel)
    await f.t.run((ctx) =>
      ctx.db.patch("channelContacts", f.open.channelContactId, {
        scopeId: "another-account",
      })
    )
    expect(
      await f.owner.client.action(api.broadcastWhatsApp.review, f.scope)
    ).toEqual({ recipients: 0, skipped: 3, noPhone: 0 })
    const duplicate = await f.owner.client.mutation(api.broadcasts.duplicate, {
      id: f.id,
    })
    expect(
      (await f.owner.client.query(api.broadcasts.get, {
        organizationId: f.owner.team,
        id: duplicate,
      }))!.row.messaging
    ).toEqual(f.messaging)
    await f.owner.client.mutation(api.templates.unpublish, {
      id: f.messaging.templateId,
    })
    await expect(
      f.owner.client.mutation(api.broadcasts.send, { id: f.id })
    ).rejects.toThrow(/Publish/)
  })
}
