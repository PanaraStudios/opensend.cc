import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { FunctionArgs, FunctionReference } from "convex/server"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { authFixture } from "./testHelpers/ses.fixture"
import { counters, patchRow, deleteRow } from "./counts"
import { primaryContactIdentity } from "./audience"
import { withoutSystemFields } from "convex-helpers"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-06T00:00:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

async function busyTeam({
  modern = true,
  size = 5000,
  historySize = 300,
} = {}) {
  const f = await authFixture()
  const owner = await f.actor("read-cost-owner", true)
  const organizationId = owner.team
  const channels = ["whatsapp", "messenger", "instagram", "email"] as const
  const broadcasts = await f.t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("metaConnections", {
      organizationId,
      method: "embedded_signup",
      businessId: "read-cost-business",
      businessName: "Read cost business",
      encryptedToken: "fixture-ciphertext",
      tokenLast4: "test",
      scopes: [],
      status: "active",
    })
    const result = []
    for (const channel of channels) {
      const id = await ctx.db.insert("broadcasts", {
        organizationId,
        name: `${channel} campaign`,
        channel,
        subject: "Campaign subject",
        preview: "Campaign preview",
        segmentId: null,
        topicId: null,
        status: "sent",
        updatedAt: Date.now(),
        generation: 0,
        audienceDone: true,
      })
      const accountId =
        channel === "email"
          ? null
          : await ctx.db.insert("channelAccounts", {
              organizationId,
              channel,
              externalId: `endpoint-${channel}`,
              connectionId,
              displayName: channel,
              handle: channel,
              status: "active",
              throughputMps: 80,
            })
      result.push({ id, channel, accountId })
    }
    return result
  })
  let contactId: Id<"contacts"> | undefined
  // A 5k-recipient WhatsApp campaign, plus 100 recipients on each other
  // channel. A broadcast itself has exactly one channel.
  for (const broadcast of broadcasts) {
    const recipientCount =
      broadcast.channel === "whatsapp" ? size : Math.min(size, 100)
    for (let start = 0; start < recipientCount; start += 100) {
      await f.t.run(async (ctx) => {
        for (let i = start; i < Math.min(start + 100, recipientCount); i++) {
          const email = `${broadcast.channel}-${i}@example.test`
          const person = await ctx.db.insert("contacts", {
            organizationId,
            email,
            phone: `+1555${String(i).padStart(7, "0")}`,
            firstName: "Campaign",
            lastName: `Person ${i}`,
            unsubscribed: false,
            properties: { company: "Example team" },
            search: email,
            updatedAt: Date.now(),
          })
          if (broadcast.channel === "whatsapp" && i === 0) contactId = person
          const identityId = await ctx.db.insert("channelContacts", {
            organizationId,
            channel:
              broadcast.channel === "email" ? "whatsapp" : broadcast.channel,
            contactId: person,
            scopeId: broadcast.channel,
            externalId: `person-${i}`,
            profileName: `Campaign Person ${i}`,
            marketingOptOut: false,
          })
          const thread = await ctx.db.insert("conversations", {
            organizationId,
            channel: broadcast.channel,
            accountId: broadcast.accountId ?? undefined,
            channelContactId: identityId,
            contactId: person,
            status: "open",
            lastMessageAt: Date.now(),
            lastPreview: "Campaign message",
            lastDirection: "outbound",
            unread: false,
            search: email,
          })
          const messageId = broadcast.accountId
            ? await ctx.db.insert("channelMessages", {
                organizationId,
                channel: broadcast.channel as
                  "whatsapp" | "messenger" | "instagram",
                accountId: broadcast.accountId,
                conversationId: thread,
                channelContactId: identityId,
                broadcastId: broadcast.id,
                direction: "outbound",
                from: "team",
                to: `person-${i}`,
                type: "template",
                status: "delivered",
                preview: "Campaign message",
                generation: 0,
                attempts: 1,
                sentAt: Date.now(),
              })
            : undefined
          const recipient = await ctx.db.insert("broadcastRecipients", {
            organizationId,
            broadcastId: broadcast.id,
            contactId: person,
            email,
            messageId,
            ...(modern
              ? {
                  displayIdentity: {
                    channel:
                      broadcast.channel === "email"
                        ? ("whatsapp" as const)
                        : broadcast.channel,
                    externalId: `person-${i}`,
                    profileName: `Campaign Person ${i}`,
                  },
                  displayMessageStatus: messageId
                    ? ("delivered" as const)
                    : null,
                }
              : {}),
            sent: true,
            settled: true,
            failed: false,
          })
          // Only the aggregates these queries read are needed in this bulk
          // fixture. Keep them in the same transaction as their source rows.
          await counters.broadcastRecipients.insert(
            ctx,
            (await ctx.db.get("broadcastRecipients", recipient))!
          )
          if (messageId)
            await counters.broadcastMessages.insert(
              ctx,
              (await ctx.db.get("channelMessages", messageId))!
            )
        }
      })
    }
  }
  await f.t.run(async (ctx) => {
    const original = (await ctx.db.get(
      "broadcastRecipients",
      (await ctx.db.query("broadcastRecipients").first())!._id
    ))!
    const message = (await ctx.db.get("channelMessages", original.messageId!))!
    const historyIdentity = await primaryContactIdentity(
      ctx,
      (await ctx.db.get("contacts", contactId!))!
    )
    for (let i = 0; i < historySize; i++) {
      const channel = (["whatsapp", "messenger", "instagram"] as const)[i % 3]
      const broadcastId = await ctx.db.insert("broadcasts", {
        organizationId,
        name: `History campaign ${i}`,
        channel,
        subject: "History subject",
        preview: "History preview",
        segmentId: null,
        topicId: null,
        status: "sent",
        updatedAt: Date.now(),
        generation: 0,
        audienceDone: true,
      })
      const messageId = await ctx.db.insert("channelMessages", {
        ...withoutSystemFields(message),
        broadcastId,
        channel,
      })
      await ctx.db.insert("broadcastRecipients", {
        organizationId,
        broadcastId,
        contactId: contactId!,
        email: original.email,
        messageId,
        ...(modern
          ? {
              displayIdentity: historyIdentity,
              displayMessageStatus: "delivered" as const,
            }
          : {}),
        sent: true,
        settled: true,
        failed: false,
      })
    }
  })
  async function measure<Q extends FunctionReference<"query">>(
    ref: Q,
    args: FunctionArgs<Q>,
    limits?: { documentsRead: number; bytesRead: number }
  ) {
    return owner.client.query(async (ctx) => {
      const result = await ctx.runQuery(
        ref,
        args,
        limits ? { transactionLimits: limits } : undefined
      )
      const metrics = await ctx.meta.getTransactionMetrics()
      return {
        result,
        documents: metrics.documentsRead.used,
        bytes: metrics.bytesRead.used,
      }
    })
  }
  return {
    ...f,
    owner,
    organizationId,
    broadcasts,
    contactId: contactId!,
    measure,
  }
}

test("broadcast page read costs on a busy team", async () => {
  const f = await busyTeam()
  const costs = []
  for (const broadcast of f.broadcasts) {
    const scope = { organizationId: f.organizationId, id: broadcast.id }
    const recipients = await f.measure(
      api.broadcastWhatsApp.recipients,
      {
        ...scope,
        paginationOpts: { numItems: 100, cursor: null },
      },
      { documentsRead: 205, bytesRead: 80_000 }
    )
    expect(recipients.result.page).toHaveLength(100)
    expect(recipients.documents).toBe(205)
    expect(recipients.bytes).toBeLessThan(80_000)
    expect(
      recipients.result.page.every(
        (row) => !("displayIdentity" in row) && !("displayMessageStatus" in row)
      )
    ).toBe(true)
    costs.push({
      query: `recipients:${broadcast.channel}`,
      documents: recipients.documents,
      bytes: recipients.bytes,
    })
    const metrics = await f.measure(api.broadcastMetrics.channelStats, scope, {
      documentsRead: broadcast.channel === "whatsapp" ? 140 : 65,
      bytesRead: 180_000,
    })
    expect(metrics.result.stats.recipients).toBe(
      broadcast.channel === "whatsapp" ? 5000 : 100
    )
    expect(metrics.documents).toBeLessThanOrEqual(
      broadcast.channel === "whatsapp" ? 140 : 65
    )
    expect(metrics.bytes).toBeLessThan(180_000)
    costs.push({
      query: `metrics:${broadcast.channel}`,
      documents: metrics.documents,
      bytes: metrics.bytes,
    })
  }
  const history = await f.measure(
    api.broadcasts.history,
    {
      organizationId: f.organizationId,
      contactId: f.contactId,
      paginationOpts: { numItems: 100, cursor: null },
    },
    { documentsRead: 205, bytesRead: 80_000 }
  )
  expect(history.result.page).toHaveLength(100)
  costs.push({
    query: "history:mixed",
    documents: history.documents,
    bytes: history.bytes,
  })
  expect(
    costs.find((cost) => cost.query === "recipients:whatsapp")?.documents
  ).toBe(205)
  expect(history.documents).toBe(205)
  expect(history.bytes).toBeLessThan(80_000)
  expect(
    history.result.page.every(
      (row) =>
        row.messageStatus === "delivered" &&
        !("displayMessageStatus" in row.recipient)
    )
  ).toBe(true)
  const nextRecipients = await f.measure(api.broadcastWhatsApp.recipients, {
    organizationId: f.organizationId,
    id: f.broadcasts[0].id,
    paginationOpts: {
      numItems: 100,
      cursor: (
        await f.owner.client.query(api.broadcastWhatsApp.recipients, {
          organizationId: f.organizationId,
          id: f.broadcasts[0].id,
          paginationOpts: { numItems: 100, cursor: null },
        })
      ).continueCursor,
    },
  })
  expect(nextRecipients.result.page).toHaveLength(100)
  expect(nextRecipients.documents).toBe(205)
  const nextHistory = await f.measure(api.broadcasts.history, {
    organizationId: f.organizationId,
    contactId: f.contactId,
    paginationOpts: { numItems: 100, cursor: history.result.continueCursor },
  })
  expect(nextHistory.result.page).toHaveLength(100)
  expect(nextHistory.documents).toBe(205)
  const seen = new Set(
    [...history.result.page, ...nextHistory.result.page].map(
      (row) => row.recipient._id
    )
  )
  expect(seen.size).toBe(200)
  let remaining = nextHistory.result
  while (!remaining.isDone) {
    const next = await f.measure(
      api.broadcasts.history,
      {
        organizationId: f.organizationId,
        contactId: f.contactId,
        paginationOpts: { numItems: 100, cursor: remaining.continueCursor },
      },
      { documentsRead: 205, bytesRead: 80_000 }
    )
    expect(next.documents).toBe(2 * next.result.page.length + 5)
    for (const row of next.result.page) {
      expect(seen.has(row.recipient._id)).toBe(false)
      seen.add(row.recipient._id)
    }
    remaining = next.result
  }
  expect(seen.size).toBe(301)
  const limited = await f.measure(
    api.broadcastWhatsApp.recipients,
    {
      organizationId: f.organizationId,
      id: f.broadcasts[0].id,
      paginationOpts: {
        numItems: 100,
        cursor: null,
        maximumRowsRead: 5,
        maximumBytesRead: 4096,
      },
    },
    { documentsRead: 15, bytesRead: 10_000 }
  )
  expect(limited.result.page.length).toBeLessThanOrEqual(5)
  expect(limited.result.isDone).toBe(false)
  console.table(costs)
}, 120_000)

test("legacy rows fall back to current contacts, primary identities and message statuses", async () => {
  const f = await busyTeam({ modern: false, size: 100, historySize: 300 })
  const scope = { organizationId: f.organizationId, id: f.broadcasts[0].id }
  const first = await f.measure(api.broadcastWhatsApp.recipients, {
    ...scope,
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(first.documents).toBe(405)
  expect(
    first.result.page.every(
      (row) =>
        row.messageStatus === "delivered" &&
        row.contact?.channelIdentity?.channel === "whatsapp"
    )
  ).toBe(true)
  const history = await f.measure(api.broadcasts.history, {
    organizationId: f.organizationId,
    contactId: f.contactId,
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(history.documents).toBe(305)
  const target = first.result.page[0]
  await f.t.run(async (ctx) => {
    const identity = (await ctx.db
      .query("channelContacts")
      .withIndex("by_contactId", (q) => q.eq("contactId", target.contactId))
      .first())!
    await ctx.db.patch("channelContacts", identity._id, {
      profileName: "Current profile",
    })
    await ctx.db.patch("contacts", target.contactId, {
      firstName: "Current contact",
    })
    // A legacy fixture can predate all display fields and aggregate writers.
    await ctx.db.patch("channelMessages", target.messageId!, { status: "read" })
  })
  const updated = await f.owner.client.query(api.broadcastWhatsApp.recipients, {
    ...scope,
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(updated.page.find((row) => row._id === target._id)).toMatchObject({
    messageStatus: "read",
    contact: {
      firstName: "Current contact",
      channelIdentity: { profileName: "Current profile" },
    },
  })
  await f.t.run(async (ctx) => {
    await ctx.db.delete("contacts", target.contactId)
    await ctx.db.delete("channelMessages", target.messageId!)
  })
  const missing = (
    await f.owner.client.query(api.broadcastWhatsApp.recipients, {
      ...scope,
      paginationOpts: { numItems: 100, cursor: null },
    })
  ).page.find((row) => row._id === target._id)!
  expect(missing.contact).toBeNull()
  expect(missing.phone).toBeUndefined()
  expect(missing.messageStatus).toBeUndefined()
})

test("repeated legacy foreign keys are read once per page", async () => {
  const f = await busyTeam({ modern: false, size: 100, historySize: 0 })
  const id = f.broadcasts[0].id
  await f.t.run(async (ctx) => {
    const rows = await ctx.db
      .query("broadcastRecipients")
      .withIndex("by_broadcastId_and_contactId", (q) => q.eq("broadcastId", id))
      .take(100)
    for (const row of rows)
      await ctx.db.patch("broadcastRecipients", row._id, {
        contactId: f.contactId,
        messageId: rows[0].messageId,
      })
  })
  const recipients = await f.measure(api.broadcastWhatsApp.recipients, {
    organizationId: f.organizationId,
    id,
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(recipients.result.page).toHaveLength(100)
  expect(recipients.documents).toBe(108) // page + auth/broadcast + one contact/message/identity
  const history = await f.measure(api.broadcasts.history, {
    organizationId: f.organizationId,
    contactId: f.contactId,
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(history.result.page).toHaveLength(100)
  expect(history.documents).toBe(107) // page + auth/contact + one broadcast/message
})

test("message writers mirror statuses atomically and hide storage fields", async () => {
  const f = await busyTeam({ size: 1, historySize: 0 })
  const scope = { organizationId: f.organizationId, id: f.broadcasts[0].id }
  const args = { ...scope, paginationOpts: { numItems: 10, cursor: null } }
  const recipient = (
    await f.owner.client.query(api.broadcastWhatsApp.recipients, args)
  ).page[0]
  for (const status of [
    "queued",
    "sent",
    "delivered",
    "read",
    "played",
    "failed",
  ] as const) {
    await f.t.run(async (ctx) => {
      await patchRow(ctx, "channelMessages", recipient.messageId!, { status })
      expect(
        (await ctx.db.get("broadcastRecipients", recipient._id))
          ?.displayMessageStatus
      ).toBe(status)
    })
    const result = await f.owner.client.query(
      api.broadcastWhatsApp.recipients,
      args
    )
    expect(result.page[0].messageStatus).toBe(status)
    expect(result.page[0]).not.toHaveProperty("displayIdentity")
    expect(result.page[0]).not.toHaveProperty("displayMessageStatus")
    expect(
      (
        await f.owner.client.query(api.broadcasts.history, {
          organizationId: f.organizationId,
          contactId: f.contactId,
          paginationOpts: args.paginationOpts,
        })
      ).page[0].messageStatus
    ).toBe(status)
  }
  await f.t.run(async (ctx) => {
    await deleteRow(ctx, "channelMessages", recipient.messageId!)
    expect(
      (await ctx.db.get("broadcastRecipients", recipient._id))
        ?.displayMessageStatus
    ).toBeNull()
  })
  const removed = await f.measure(api.broadcastWhatsApp.recipients, args)
  expect(removed.result.page[0].messageStatus).toBeUndefined()
  expect(removed.documents).toBe(7) // auth/broadcast + recipient/contact, no missing-message fallback
})

test("new identity display snapshots keep contacts live and known absences avoid lookups", async () => {
  const f = await busyTeam({ size: 1, historySize: 0 })
  const args = {
    organizationId: f.organizationId,
    id: f.broadcasts[0].id,
    paginationOpts: { numItems: 10, cursor: null },
  }
  const recipient = (
    await f.owner.client.query(api.broadcastWhatsApp.recipients, args)
  ).page[0]
  await f.t.run(async (ctx) => {
    const identity = (await ctx.db
      .query("channelContacts")
      .withIndex("by_contactId", (q) => q.eq("contactId", f.contactId))
      .first())!
    await ctx.db.patch("channelContacts", identity._id, {
      profileName: "Later profile",
    })
    await ctx.db.patch("contacts", f.contactId, {
      firstName: "Live contact",
      unsubscribed: true,
    })
  })
  const result = await f.measure(api.broadcastWhatsApp.recipients, args)
  expect(result.documents).toBe(7)
  expect(result.result.page[0].contact).toMatchObject({
    firstName: "Live contact",
    unsubscribed: true,
    channelIdentity: { profileName: "Campaign Person 0" },
  })
  await f.t.run((ctx) =>
    ctx.db.patch("broadcastRecipients", recipient._id, {
      displayIdentity: null,
    })
  )
  const absent = await f.measure(api.broadcastWhatsApp.recipients, args)
  expect(absent.result.page[0].contact?.channelIdentity).toBeNull()
  expect(absent.documents).toBe(7)
  await f.t.run((ctx) => ctx.db.delete("contacts", f.contactId))
  const deleted = await f.owner.client.query(
    api.broadcastWhatsApp.recipients,
    args
  )
  expect(deleted.page[0].contact).toBeNull()
  expect(deleted.page[0].phone).toBeUndefined()
})

test("mixed new and legacy pages keep fallback costs proportional to old rows", async () => {
  const f = await busyTeam({ size: 100, historySize: 100 })
  await f.t.run(async (ctx) => {
    const rows = await ctx.db
      .query("broadcastRecipients")
      .withIndex("by_broadcastId_and_contactId", (q) =>
        q.eq("broadcastId", f.broadcasts[0].id)
      )
      .take(100)
    for (const row of rows.slice(0, 50))
      await ctx.db.patch("broadcastRecipients", row._id, {
        displayIdentity: undefined,
        displayMessageStatus: undefined,
      })
    const history = await ctx.db
      .query("broadcastRecipients")
      .withIndex("by_organizationId_and_contactId", (q) =>
        q.eq("organizationId", f.organizationId).eq("contactId", f.contactId)
      )
      .order("desc")
      .take(100)
    for (const row of history.slice(0, 50))
      await ctx.db.patch("broadcastRecipients", row._id, {
        displayMessageStatus: undefined,
      })
  })
  const recipients = await f.measure(api.broadcastWhatsApp.recipients, {
    organizationId: f.organizationId,
    id: f.broadcasts[0].id,
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(recipients.documents).toBe(305)
  expect(
    recipients.result.page.every(
      (row) =>
        row.messageStatus === "delivered" &&
        row.contact?.channelIdentity?.channel === "whatsapp"
    )
  ).toBe(true)
  const history = await f.measure(api.broadcasts.history, {
    organizationId: f.organizationId,
    contactId: f.contactId,
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(history.documents).toBe(255)
  expect(
    history.result.page.every((row) => row.messageStatus === "delivered")
  ).toBe(true)
})
