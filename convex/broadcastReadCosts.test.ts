import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { FunctionArgs, FunctionReference } from "convex/server"
import { api } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { authFixture } from "./testHelpers/ses.fixture"
import { counters } from "./counts"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-06T00:00:00Z"))
})
afterEach(() => {
  vi.useRealTimers()
})

async function busyTeam() {
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
    const size = broadcast.channel === "whatsapp" ? 5000 : 100
    for (let start = 0; start < size; start += 100) {
      await f.t.run(async (ctx) => {
        for (let i = start; i < Math.min(start + 100, size); i++) {
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
    for (let i = 0; i < 300; i++) {
      const channel = channels[i % 3]
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
        ...(Object.fromEntries(
          Object.entries(message).filter(([key]) => !key.startsWith("_"))
        ) as Omit<Doc<"channelMessages">, "_id" | "_creationTime">),
        broadcastId,
        channel,
      })
      await ctx.db.insert("broadcastRecipients", {
        organizationId,
        broadcastId,
        contactId: contactId!,
        email: original.email,
        messageId,
        sent: true,
        settled: true,
        failed: false,
      })
    }
  })
  async function measure<Q extends FunctionReference<"query">>(
    ref: Q,
    args: FunctionArgs<Q>
  ) {
    return owner.client.query(async (ctx) => {
      const result = await ctx.runQuery(ref, args)
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
    const recipients = await f.measure(api.broadcastWhatsApp.recipients, {
      ...scope,
      paginationOpts: { numItems: 100, cursor: null },
    })
    expect(recipients.result.page).toHaveLength(100)
    costs.push({
      query: `recipients:${broadcast.channel}`,
      documents: recipients.documents,
      bytes: recipients.bytes,
    })
    const metrics = await f.measure(api.broadcastMetrics.channelStats, scope)
    expect(metrics.result.stats.recipients).toBe(
      broadcast.channel === "whatsapp" ? 5000 : 100
    )
    costs.push({
      query: `metrics:${broadcast.channel}`,
      documents: metrics.documents,
      bytes: metrics.bytes,
    })
  }
  const history = await f.measure(api.broadcasts.history, {
    organizationId: f.organizationId,
    contactId: f.contactId,
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(history.result.page).toHaveLength(100)
  costs.push({
    query: "history:mixed",
    documents: history.documents,
    bytes: history.bytes,
  })
  expect(
    costs.find((cost) => cost.query === "recipients:whatsapp")?.documents
  ).toBe(405)
  expect(history.documents).toBe(305)
  console.table(costs)
}, 120_000)
