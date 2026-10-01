import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow, patchRow } from "./counts"
import { type MessageMetricStatus } from "../lib/channel-metrics"
import {
  MESSAGING_CHANNELS,
  CHANNEL_MESSAGE_STATUSES,
  type MessagingChannel,
} from "../lib/channels"

const DAY = 86_400_000
const FROM = Date.UTC(2026, 8, 28)
const spans = [0, 1].map((i) => ({
  from: FROM + i * DAY,
  to: FROM + (i + 1) * DAY - 1,
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FROM - DAY)
})
afterEach(() => vi.useRealTimers())

async function seedChannel(
  f: Awaited<ReturnType<typeof fixture>>,
  organizationId: string,
  channel: MessagingChannel
) {
  const endpoint = await f.t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("metaConnections", {
      organizationId,
      businessId: `${organizationId}-${channel}`,
      businessName: "Metrics",
      method: "manual_token",
      encryptedToken: "test",
      tokenLast4: "test",
      scopes: [],
      status: "active",
    })
    const accountId = await insertRow(ctx, "channelAccounts", {
      organizationId,
      channel,
      connectionId,
      externalId: `${organizationId}-${channel}`,
      displayName: "Metrics",
      handle: "Metrics",
      status: "active",
      throughputMps: 80,
    })
    const channelContactId = await ctx.db.insert("channelContacts", {
      organizationId,
      channel,
      scopeId: String(accountId),
      externalId: "customer",
      marketingOptOut: false,
    })
    const conversationId = await insertRow(ctx, "conversations", {
      organizationId,
      channel,
      accountId,
      channelContactId,
      status: "open",
      lastMessageAt: FROM,
      lastPreview: "Metrics",
      lastDirection: "inbound",
      unread: true,
      search: "metrics",
    })
    return { accountId, channelContactId, conversationId }
  })
  return (status: MessageMetricStatus) =>
    f.t.run((ctx) =>
      insertRow(ctx, "channelMessages", {
        ...endpoint,
        organizationId,
        channel,
        direction: status === "received" ? "inbound" : "outbound",
        from: "sender",
        to: "customer",
        type: "text",
        status,
        preview: "Metrics",
        generation: 0,
        attempts: 0,
      })
    )
}

test("channelSummary counts current statuses, rollups and day boundaries for every Meta channel", async () => {
  const f = await fixture()
  const inserts: Awaited<ReturnType<typeof seedChannel>>[] = []
  for (const channel of MESSAGING_CHANNELS)
    inserts.push(await seedChannel(f, f.owner.team, channel))
  vi.setSystemTime(FROM - 1)
  for (const insert of inserts) await insert("failed") // outside the requested days
  vi.setSystemTime(FROM)
  for (const [i, channel] of MESSAGING_CHANNELS.entries()) {
    for (const status of CHANNEL_MESSAGE_STATUSES) {
      if (
        (channel === "instagram" && status === "delivered") ||
        (channel !== "whatsapp" && status === "played")
      )
        continue
      await inserts[i](status)
    }
  }
  vi.setSystemTime(FROM + DAY - 1)
  for (const insert of inserts) await insert("read") // inclusive end of the first span
  vi.setSystemTime(FROM + DAY)
  for (const [i, insert] of inserts.entries()) {
    for (let j = 0; j <= i; j++) await insert("sent")
    await insert("received")
  }
  vi.setSystemTime(FROM + 2 * DAY)
  for (const insert of inserts) await insert("failed") // exclusive end of the second span
  vi.setSystemTime(FROM - DAY) // Keep the fixture sessions valid for reads.
  const all = await f.owner.client.query(api.metrics.channelSummary, {
    organizationId: f.owner.team,
    spans,
  })
  expect(all).toHaveLength(2)
  expect(all[0].map((row) => row.channel)).toEqual([
    "email",
    ...MESSAGING_CHANNELS,
  ])
  for (const [i, channel] of MESSAGING_CHANNELS.entries()) {
    const selected = await f.owner.client.query(api.metrics.channelSummary, {
      organizationId: f.owner.team,
      channel,
      spans,
    })
    expect(selected).toEqual(
      all.map((rows) => rows.filter((row) => row.channel === channel))
    )
    expect(selected[0][0].counts).toEqual({
      sent: channel === "instagram" ? 5 : channel === "whatsapp" ? 7 : 6,
      delivered: channel === "instagram" ? 2 : channel === "whatsapp" ? 4 : 3,
      read: channel === "whatsapp" ? 3 : 2,
      failed: 1,
      received: 1,
    })
    expect(selected[0][0].status).toEqual({
      queued: 1,
      sent: 1,
      delivered: channel === "instagram" ? 0 : 1,
      played: channel === "whatsapp" ? 1 : 0,
      read: 2,
      failed: 1,
      received: 1,
    })
    expect(selected[1][0].counts).toEqual({
      sent: i + 1,
      delivered: 0,
      read: 0,
      failed: 0,
      received: 1,
    })
  }
  expect(all[0][0].counts).toEqual({
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    received: 0,
  })
})

test("a later read receipt stays in the creation day and replaces rather than duplicates the aggregate count", async () => {
  const f = await fixture()
  const insert = await seedChannel(f, f.owner.team, "whatsapp")
  vi.setSystemTime(FROM)
  const id = await insert("delivered")
  vi.setSystemTime(FROM + 2 * DAY)
  await f.t.run((ctx) =>
    patchRow(ctx, "channelMessages", id, { status: "read" })
  )
  vi.setSystemTime(FROM - DAY)
  const rows = await f.owner.client.query(api.metrics.channelSummary, {
    organizationId: f.owner.team,
    channel: "whatsapp",
    spans,
  })
  expect(rows[0][0].counts).toEqual({
    sent: 1,
    delivered: 1,
    read: 1,
    failed: 0,
    received: 0,
  })
  expect(rows[0][0].status.delivered).toBe(0)
  expect(rows[1][0].counts.sent).toBe(0)
})

test("channelSummary isolates teams and rejects unauthenticated and cross-team reads", async () => {
  const f = await fixture()
  const inserts: Awaited<ReturnType<typeof seedChannel>>[] = []
  for (const channel of MESSAGING_CHANNELS)
    inserts.push(await seedChannel(f, f.outsider.team, channel))
  vi.setSystemTime(FROM)
  for (const insert of inserts) {
    await insert("read")
    await insert("received")
  }
  vi.setSystemTime(FROM + 2 * DAY)
  vi.setSystemTime(FROM - DAY)
  const args = { organizationId: f.owner.team, spans }
  const own = await f.owner.client.query(api.metrics.channelSummary, args)
  expect(
    own
      .flat()
      .every((row) => Object.values(row.counts).every((count) => count === 0))
  ).toBe(true)
  await expect(
    f.outsider.client.query(api.metrics.channelSummary, args)
  ).rejects.toThrow()
  await expect(f.t.query(api.metrics.channelSummary, args)).rejects.toThrow()
  const other = await f.outsider.client.query(api.metrics.channelSummary, {
    ...args,
    organizationId: f.outsider.team,
  })
  expect(
    other[0]
      .filter((row) => row.channel !== "email")
      .map((row) => row.counts.sent)
  ).toEqual([1, 1, 1])
})

test("channelSummary uses exactly the email span validation and accepts 31 spans and long single spans", async () => {
  const f = await fixture()
  const ranges = (days: number) =>
    Array.from({ length: days }, (_, i) => ({
      from: FROM + i * DAY,
      to: FROM + (i + 1) * DAY - 1,
    }))
  for (const query of [api.metrics.summary, api.metrics.channelSummary]) {
    const args = { organizationId: f.owner.team, spans: ranges(31) }
    expect(await f.owner.client.query(query, args)).toHaveLength(31)
    expect(
      await f.owner.client.query(query, {
        ...args,
        spans: [{ from: FROM, to: FROM + 90 * DAY - 1 }],
      })
    ).toHaveLength(1)
    for (const [invalid, error] of [
      [[], "31 days"],
      [ranges(32), "31 days"],
      [[{ from: FROM, to: FROM + 400 * DAY - 1 }], "a year"],
      [[{ from: FROM + 1, to: FROM + DAY - 1 }], "Invalid metrics"],
      [[{ from: FROM, to: FROM + DAY - 2 }], "Invalid metrics"],
      [[{ from: FROM, to: FROM - 1 }], "Invalid metrics"],
      [[spans[0], spans[0]], "Invalid metrics"],
      [[spans[1], spans[0]], "Invalid metrics"],
    ] as const) {
      await expect(
        f.owner.client.query(query, { ...args, spans: [...invalid] })
      ).rejects.toThrow(error)
    }
  }
})

test("all-channel email totals keep milestone semantics and count inbound emails by receivedAt", async () => {
  const f = await fixture()
  vi.setSystemTime(FROM)
  await f.t.run(async (ctx) => {
    const emailId = await insertRow(ctx, "emails", {
      organizationId: f.owner.team,
      domainId: f.domain,
      from: "sender@example.test",
      to: ["recipient@example.test"],
      subject: "Metrics",
      status: "opened",
      source: "api",
      generation: 0,
      attempts: 1,
      search: "metrics",
    })
    for (const type of ["sent", "delivered", "opened"] as const)
      await insertRow(ctx, "emailMetrics", {
        organizationId: f.owner.team,
        emailId,
        domainId: f.domain,
        type,
        createdAt: FROM,
        at: FROM,
        recipients: ["recipient@example.test"],
      })
    await insertRow(ctx, "emails", {
      organizationId: f.owner.team,
      domainId: f.domain,
      from: "sender@example.test",
      to: ["recipient@example.test"],
      subject: "Failed",
      status: "failed",
      source: "api",
      generation: 0,
      attempts: 1,
      search: "failed",
    })
  })
  vi.setSystemTime(FROM + DAY)
  await f.t.run(async (ctx) => {
    const inboundId = await ctx.db.insert("inboundMessages", {
      organizationId: f.owner.team,
      domainId: f.domain,
      region: "us-east-1",
      topicArn: "metrics",
      messageId: "metrics",
      sesMessageId: "metrics",
      bucket: "metrics",
      objectKey: "metrics",
      notification: "{}",
    })
    const rawId = await ctx.storage.store(new Blob(["Metrics"]))
    await insertRow(ctx, "receivedEmails", {
      organizationId: f.owner.team,
      inboundId,
      domainId: f.domain,
      rawId,
      from: "customer@example.test",
      sender: "customer@example.test",
      to: ["sender@example.test"],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "Metrics reply",
      messageId: "metrics",
      receivedFor: ["sender@example.test"],
      authentication: {},
      receivedAt: FROM,
      expiresAt: FROM + 30 * DAY,
    })
  })
  vi.setSystemTime(FROM - DAY)
  const args = { organizationId: f.owner.team, spans }
  const email = await f.owner.client.query(api.metrics.channelSummary, {
    ...args,
    channel: "email",
  })
  const all = await f.owner.client.query(api.metrics.channelSummary, args)
  const original = await f.owner.client.query(api.metrics.summary, args)
  expect(email).toEqual(
    all.map((rows) => rows.filter((row) => row.channel === "email"))
  )
  expect(email[0][0].counts).toEqual({
    sent: 1,
    delivered: 1,
    read: 0,
    failed: 1,
    received: 1,
  })
  expect(email[1][0].counts).toEqual({
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    received: 0,
  })
  expect(email[0][0].counts.sent).toBe(original[0].sent)
  expect(email[0][0].counts.delivered).toBe(original[0].delivered)
  expect(email[0][0].status).toEqual(original[0].status)
})
