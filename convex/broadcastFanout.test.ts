import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { inboundFixture, WABA_ID } from "./testHelpers/meta.fixture"
import { insertRow, patchRow } from "./counts"
import { MAX_STEP_RECIPIENTS, sendStep } from "./broadcastSend"
import { extrapolate, REVIEW_PAGES, REVIEW_PAGE_SIZE } from "./broadcasts"
import { SENT_MARK_MS } from "./broadcastMetrics"
import { broadcastActions } from "../lib/dashboard/broadcast"

/* WhatsApp fan-out on the paced, self-scheduling chain: steps sized to the
   number's throughput, idempotent per recipient, bounded audience review. */

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "fanout-key-".repeat(8))
  vi.stubEnv("BETTER_AUTH_SECRET", "fanout-secret-".repeat(4))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function setup({
  audience,
  throughputMps = 80,
  unsubscribedEvery = 0,
}: {
  audience: number
  throughputMps?: number
  unsubscribedEvery?: number
}) {
  const f = await inboundFixture()
  workpoolTest.register(f.t, "webhookPool")
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
    await patchRow(ctx, "channelAccounts", f.account, {
      registeredAt: Date.now(),
      throughputMps,
    })
  })
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    organizationId: f.owner.team,
    wabaId: WABA_ID,
    syncedAt: Date.now(),
    templates: [
      {
        id: "777",
        name: "fanout",
        language: "en",
        category: "MARKETING",
        status: "APPROVED",
        parameterFormat: "positional",
        components: [{ type: "BODY", text: "On Saturday." }],
      },
    ],
  })
  const template = (await f.t.run((ctx) =>
    ctx.db
      .query("templates")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.owner.team)
      )
      .first()
  ))!
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.owner.team,
    name: "Fan-out",
  })
  await addContacts(f, segmentId, 0, audience, (i) => ({
    phone: `+1555${String(i).padStart(7, "0")}`,
    unsubscribed: unsubscribedEvery > 0 && i % unsubscribedEvery === 0,
  }))
  vi.setSystemTime(Date.now() + 30_000)
  const id = await f.owner.client.mutation(api.broadcasts.create, {
    organizationId: f.owner.team,
    name: "Saturday",
    channel: "whatsapp",
    segmentId,
    whatsapp: { accountId: f.account, templateId: template._id, variables: {} },
  })
  const read = async () =>
    (await f.t.run((ctx) => ctx.db.get("broadcasts", id)))!
  const recipients = () =>
    f.t.run((ctx) =>
      ctx.db
        .query("broadcastRecipients")
        .withIndex("by_broadcastId_and_contactId", (q) =>
          q.eq("broadcastId", id)
        )
        .collect()
    )
  const messages = () =>
    f.t.run(async (ctx) =>
      (await ctx.db.query("channelMessages").collect()).filter(
        (row) => row.broadcastId === id
      )
    )
  /** Pending next-step jobs of the chain. */
  const pumps = () =>
    f.t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) =>
          job.name.endsWith(":pump") &&
          job.state.kind === "pending" &&
          job.args[0].id === id
      )
    )
  /** Sends and starts the fan-out, leaving its first step scheduled. */
  const start = async () => {
    await f.owner.client.mutation(api.broadcasts.send, { id })
    const row = await read()
    await f.t.mutation(internal.broadcastSend.start, {
      id,
      generation: row.generation,
    })
    return row.generation
  }
  /** Runs the next scheduled step at its time; false once none is left. */
  const step = async () => {
    const [job] = await pumps()
    if (!job) return false
    vi.setSystemTime(Math.max(Date.now(), job.scheduledTime))
    await f.t.run((ctx) => ctx.scheduler.cancel(job._id))
    await f.t.mutation(internal.broadcastSend.pump, job.args[0])
    return true
  }
  return {
    ...f,
    id,
    segmentId,
    read,
    recipients,
    messages,
    pumps,
    start,
    step,
  }
}

/** Audience rows through the counted writers, so the aggregates the
    review's estimate reads are current. */
async function addContacts(
  f: Awaited<ReturnType<typeof inboundFixture>>,
  segmentId: Id<"segments">,
  from: number,
  to: number,
  values: (i: number) => {
    phone?: string
    email?: string
    unsubscribed?: boolean
  }
) {
  for (let offset = from; offset < to; offset += 500)
    await f.t.run(async (ctx) => {
      for (let i = offset; i < Math.min(to, offset + 500); i++) {
        const { unsubscribed = false, ...value } = values(i)
        const contactId = (await insertRow(ctx, "contacts", {
          organizationId: f.owner.team,
          firstName: "",
          lastName: "",
          properties: {},
          unsubscribed,
          updatedAt: Date.now(),
          search: `contact ${i}`,
          ...value,
        })) as Id<"contacts">
        await insertRow(ctx, "segmentMembers", {
          organizationId: f.owner.team,
          segmentId,
          contactId,
        })
      }
    })
}

test("pacing follows the number's throughput, reserves each step's sends once, and finishes", async () => {
  const rate = 10
  const f = await setup({
    audience: 45,
    throughputMps: rate,
    unsubscribedEvery: 9,
  })
  await f.start()
  const steps: { at: number; written: number; queued: number }[] = []
  let written = 0
  let queued = 0
  while (await f.step()) {
    const recipients = await f.recipients()
    const sent = recipients.filter((row) => row.messageId).length
    steps.push({
      at: Date.now(),
      written: recipients.length - written,
      queued: sent - queued,
    })
    written = recipients.length
    queued = sent
  }
  // A number gets at most a second of its throughput per step...
  expect(steps.length).toBe(Math.ceil(45 / rate))
  for (const s of steps) expect(s.written).toBeLessThanOrEqual(rate)
  // ...and the next step waits for the time those sends take at its rate.
  for (let i = 1; i < steps.length; i++)
    expect(steps[i].at - steps[i - 1].at).toBe(
      Math.ceil((steps[i - 1].queued * 1000) / rate)
    )
  const row = await f.read()
  expect(row.audienceDone).toBe(true)
  expect(await f.pumps()).toEqual([])
  // Every 9th contact is unsubscribed: recorded, never messaged.
  const recipients = await f.recipients()
  expect(recipients).toHaveLength(45)
  expect(new Set(recipients.map((r) => r.contactId)).size).toBe(45)
  expect(
    recipients.filter((r) => r.skipReason === "unsubscribed")
  ).toHaveLength(5)
  // Each message carries the slot its step reserved, so claim skips the
  // limiter. The slots keep the number's token bucket: at most a full
  // bucket plus `rate` a second over any stretch of time.
  const slots = (await f.messages())
    .map((message) => message.rateReadyAt!)
    .sort((a, b) => a - b)
  expect(slots).toHaveLength(40)
  expect(slots.every((at) => typeof at === "number")).toBe(true)
  for (let i = 0; i < slots.length; i++)
    for (let j = i; j < slots.length; j++)
      expect(j - i + 1).toBeLessThanOrEqual(
        rate + Math.floor((rate * (slots[j] - slots[i])) / 1000)
      )
})

test("a crash or retry mid fan-out neither skips nor double-sends a recipient", async () => {
  const f = await setup({ audience: 70 })
  const generation = await f.start()
  expect(await f.step()).toBe(true)
  expect(await f.recipients()).toHaveLength(MAX_STEP_RECIPIENTS)
  // A step that dies before committing leaves nothing behind.
  await expect(
    f.t.run(async (ctx) => {
      await sendStep(ctx, (await ctx.db.get("broadcasts", f.id))!)
      throw new Error("crash")
    })
  ).rejects.toThrow("crash")
  expect(await f.recipients()).toHaveLength(MAX_STEP_RECIPIENTS)
  expect(await f.messages()).toHaveLength(MAX_STEP_RECIPIENTS)
  // The same step delivered twice, and a replayed cursor, add nothing twice.
  const [next] = await f.pumps()
  await f.t.mutation(internal.broadcastSend.pump, { id: f.id, generation })
  await f.t.run((ctx) =>
    patchRow(ctx, "broadcasts", f.id, { cursor: undefined })
  )
  await f.t.mutation(internal.broadcastSend.pump, { id: f.id, generation })
  await f.t.run((ctx) => ctx.scheduler.cancel(next._id))
  while (await f.step()) {
    /* drain */
  }
  const recipients = await f.recipients()
  const messages = await f.messages()
  expect(recipients).toHaveLength(70)
  expect(new Set(recipients.map((r) => r.contactId)).size).toBe(70)
  expect(messages).toHaveLength(70)
  expect(new Set(messages.map((m) => m.to)).size).toBe(70)
  expect((await f.read()).audienceDone).toBe(true)
})

test("a step that throws fails the broadcast and writes none of its recipients", async () => {
  const f = await setup({ audience: 40 })
  await f.start()
  await f.step()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { status: "disconnected" })
  )
  expect(await f.step()).toBe(true)
  expect(await f.recipients()).toHaveLength(MAX_STEP_RECIPIENTS)
  expect(await f.read()).toMatchObject({ status: "failed" })
  expect(await f.pumps()).toEqual([])
})

test("Stop is refused once the paced send is going, and works before it starts", async () => {
  const f = await setup({ audience: 40 })
  await f.start()
  await f.step()
  const row = await f.read()
  expect(
    broadcastActions(row.status, row.audienceBefore !== undefined).canCancel
  ).toBe(false)
  await expect(
    f.owner.client.mutation(api.broadcasts.cancel, { id: f.id })
  ).rejects.toThrow(/Only scheduled broadcasts can be canceled/)
  while (await f.step()) {
    /* the send carries on */
  }
  expect(await f.recipients()).toHaveLength(40)

  // Queued but not yet resolving its audience: Stop cancels, and a step
  // of the old generation does nothing.
  const other = await f.owner.client.mutation(api.broadcasts.duplicate, {
    id: f.id,
  })
  await f.owner.client.mutation(api.broadcasts.send, { id: other })
  const generation = (await f.t.run((ctx) => ctx.db.get("broadcasts", other)))!
    .generation
  await f.owner.client.mutation(api.broadcasts.cancel, { id: other })
  await f.t.mutation(internal.broadcastSend.start, { id: other, generation })
  await f.t.mutation(internal.broadcastSend.pump, { id: other, generation })
  const canceled = (await f.t.run((ctx) => ctx.db.get("broadcasts", other)))!
  expect(canceled.status).toBe("canceled")
  expect(canceled.audienceBefore).toBeUndefined()
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("broadcastRecipients")
        .withIndex("by_broadcastId_and_contactId", (q) =>
          q.eq("broadcastId", other)
        )
        .first()
    )
  ).toBeNull()
})

test("lastMessageSentAt is kept to the minute, never before the last send", async () => {
  const f = await setup({ audience: 3 })
  await f.start()
  while (await f.step()) {
    /* drain */
  }
  const [first, second, third] = await f.messages()
  const accept = (id: Id<"channelMessages">, externalId: string) =>
    f.t.mutation(internal.channels.messages.record, {
      id,
      generation: 0,
      outcome: { kind: "sent", externalId },
    })
  vi.setSystemTime(Math.floor(Date.now() / SENT_MARK_MS) * SENT_MARK_MS + 5000)
  await accept(first._id, "wamid.1")
  const mark = (await f.read()).lastMessageSentAt!
  expect(mark % SENT_MARK_MS).toBe(0)
  expect(mark).toBeGreaterThan(Date.now())
  vi.setSystemTime(Date.now() + 20_000)
  await accept(second._id, "wamid.2")
  expect((await f.read()).lastMessageSentAt).toBe(mark)
  vi.setSystemTime(mark + 1)
  await accept(third._id, "wamid.3")
  expect((await f.read()).lastMessageSentAt).toBe(mark + SENT_MARK_MS)
  // Settling 24 hours after the mark is never early for the last send.
  const settle = (
    await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    )
  ).find((job) => job.name.includes("settleBroadcast"))
  expect(settle!.scheduledTime).toBeGreaterThanOrEqual(mark + 1 + 86_400_000)
})

test("review reads at most REVIEW_PAGES pages, then estimates the rest", async () => {
  const sampled = REVIEW_PAGES * REVIEW_PAGE_SIZE
  const audience = sampled + 500
  const f = await setup({ audience: 0 })
  // Every 5th contact has no phone, every 4th is unsubscribed.
  await addContacts(f, f.segmentId, 0, audience, (i) => ({
    ...(i % 5 ? { phone: `+1555${String(i).padStart(7, "0")}` } : {}),
    email: `person${i}@example.test`,
    unsubscribed: i % 4 === 0,
  }))
  const whatsapp = await f.owner.client.action(api.broadcastWhatsApp.review, {
    organizationId: f.owner.team,
    id: f.id,
  })
  const reachable = (n: number) =>
    Array.from({ length: n }, (_, i) => i).filter((i) => i % 5 && i % 4).length
  // The first pages are counted exactly, the rest scaled from them.
  expect(whatsapp.estimated).toBe(true)
  expect(whatsapp.recipients).toBe(
    reachable(sampled) +
      Math.round((reachable(sampled) / sampled) * (audience - sampled))
  )
  expect(whatsapp.recipients).toBeCloseTo(reachable(audience), -1)
  expect(whatsapp.recipients + whatsapp.skipped).toBe(audience)
  expect(whatsapp.noPhone).toBe(audience / 5)
  const email = await f.owner.client.action(api.broadcasts.review, {
    organizationId: f.owner.team,
    segmentId: f.segmentId,
    topicId: null,
  })
  expect(email).toEqual({ count: (audience * 3) / 4, estimated: true })
  // A smaller audience is still counted exactly.
  expect(extrapolate({ count: 7 }, 10, 10)).toEqual({ count: 7 })
  expect(extrapolate({ count: 7 }, 10, null)).toEqual({ count: 7 })
  expect(extrapolate({ count: 5 }, 10, 30)).toEqual({ count: 15 })
}, 120_000)
