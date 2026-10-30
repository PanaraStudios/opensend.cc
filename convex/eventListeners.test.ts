import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { listenToEvents } from "./testHelpers/eventListener"
import { emitEvent, emitEventAlways } from "./events"
import { upsertContact } from "./audience"
import { upsertChannelThread } from "./channels/identity"
import {
  emitMessageEvent,
  hydratedChannelMessage,
  type PageLookups,
} from "./channels/payload"
import { insertRow } from "./counts"
import type { MutationCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import type { AutomationStep } from "../lib/dashboard/types"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("BETTER_AUTH_SECRET", "event-listeners-test-secret-32-chars")
  vi.stubEnv("SITE_URL", "https://opensend.test")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const RECEIVED = "whatsapp.message.received"
const HOLD: AutomationStep[] = [{ key: "hold", type: "delay", duration: "1m" }]

async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "webhookPool")
  // The fixture's own setup work is not what these tests measure.
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
  })
  const org = f.owner.team
  const { contactId, message, stranger } = await f.t.run(async (ctx) => {
    const contactId = (
      await upsertContact(
        ctx,
        org,
        { email: "ada@example.test", firstName: "Ada" },
        { properties: [], segmentIds: [] }
      )
    ).id
    const connectionId = await ctx.db.insert("metaConnections", {
      organizationId: org,
      businessId: "listener-business",
      businessName: "Listener",
      method: "manual_token",
      encryptedToken: "fixture-ciphertext",
      tokenLast4: "text",
      scopes: [],
      status: "active",
    })
    const account = await insertRow(
      ctx,
      "channelAccounts",
      {
        organizationId: org,
        channel: "whatsapp",
        externalId: "listener-account",
        connectionId,
        displayName: "Listener",
        handle: "+15550008061",
        status: "active",
        throughputMps: 80,
      },
      true
    )
    const inbound = async (phone: string) => {
      const thread = await upsertChannelThread(ctx, account, {
        externalId: phone.slice(1),
        phone,
        at: Date.now(),
        direction: "inbound",
        opensWindow: true,
        preview: "price",
      })
      return insertRow(
        ctx,
        "channelMessages",
        {
          organizationId: org,
          channel: "whatsapp",
          accountId: account._id,
          conversationId: thread.conversationId,
          channelContactId: thread.channelContactId,
          direction: "inbound",
          from: phone.slice(1),
          to: "15550008061",
          type: "text",
          status: "received",
          preview: "price",
          generation: 1,
          attempts: 0,
        },
        true
      )
    }
    const message = await inbound("+15550008062")
    // Ada wrote this one.
    await ctx.db.patch("channelContacts", message.channelContactId, {
      contactId,
    })
    return { contactId, message, stranger: await inbound("+15550008063") }
  })
  const define = async (trigger: string, steps: AutomationStep[]) => {
    const id = await f.owner.client.mutation(api.automations.create, {
      organizationId: org,
    })
    await f.owner.client.mutation(api.automations.update, {
      organizationId: org,
      id,
      trigger,
      triggerFilters: [],
      graph: JSON.stringify(steps),
    })
    expect(
      await f.owner.client.mutation(api.automations.setStatus, {
        organizationId: org,
        id,
        status: "enabled",
      })
    ).toEqual([])
    return id
  }
  return { ...f, org, contactId, message, stranger, define }
}

/** What one emit stores and schedules, from inside its transaction. */
async function outbox(ctx: MutationCtx, id: Id<"events"> | null) {
  const jobs = await ctx.db.system.query("_scheduled_functions").take(100)
  return {
    stored: (await ctx.db.query("events").take(10)).length,
    jobs: jobs
      .filter((job) => job.state.kind === "pending")
      .map((job) => job.name)
      .sort(),
    id,
  }
}

/** Counts the documents and index ranges a callback reads. */
function countReads(ctx: MutationCtx) {
  let reads = 0
  const db = new Proxy(ctx.db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== "function") return value
      return (...args: unknown[]) => {
        if (prop === "get" || prop === "query") reads++
        return value.apply(target, args)
      }
    },
  })
  return { ctx: { ...ctx, db } as MutationCtx, reads: () => reads }
}

/** v2 before this change: every system event is stored and handed to both
    consumers. Run them all and count what that cost. */
async function drain(f: Awaited<ReturnType<typeof setup>>) {
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  return f.t.run(async (ctx) => ({
    calls: (await ctx.db.system.query("_scheduled_functions").take(100))
      .filter((job) => job.state.kind === "success")
      .map((job) => job.name)
      .sort(),
    events: await ctx.db.query("events").take(10),
  }))
}

test("an event nobody listens to is neither stored nor scheduled (v2 paid 4 calls and 2 writes for it)", async () => {
  const before = await setup()
  await before.t.run((ctx) =>
    emitEventAlways(ctx, before.org, RECEIVED, {
      id: before.message._id,
      contact_id: before.contactId,
    })
  )
  const v2 = await drain(before)
  // deliverEvent found no subscriber, consume handed off to dispatch, whose
  // wait and start phases found no run and no automation.
  expect(v2.calls).toEqual([
    "automationRuntime:consume",
    "automationRuntime:dispatch",
    "automationRuntime:dispatch",
    "webhooks:deliverEvent",
  ])
  // Insert, then deliverEvent's patch marking it delivered.
  expect(v2.events).toHaveLength(1)
  expect(v2.events[0].webhooksDeliveredAt).toBeDefined()

  const f = await setup()
  // An automation on another trigger, and a webhook for another type, do
  // not listen to this one.
  await f.define("opensend:whatsapp.call.completed", HOLD)
  await listenToEvents(f.t, f.org, ["whatsapp.message.sent"])
  expect(
    await f.t.run(async (ctx) =>
      outbox(
        ctx,
        await emitEvent(ctx, f.org, RECEIVED, {
          id: f.message._id,
          contact_id: f.contactId,
        })
      )
    )
  ).toEqual({ id: null, stored: 0, jobs: [] })
  expect(
    await f.t.run(async (ctx) =>
      outbox(ctx, await emitMessageEvent(ctx, f.org, RECEIVED, f.message))
    )
  ).toEqual({ id: null, stored: 0, jobs: [] })
  expect(await drain(f)).toEqual({ calls: [], events: [] })
})

test("an unlistened message event skips the hydrated payload's reads", async () => {
  const f = await setup()
  const reads = await f.t.run(async (ctx) => {
    const eager = countReads(ctx)
    // v2: hydrate, then store and schedule with no listener check.
    await emitEventAlways(
      eager.ctx,
      f.org,
      RECEIVED,
      await hydratedChannelMessage(eager.ctx, f.message, Date.now())
    )
    const lazy = countReads(ctx)
    await emitMessageEvent(lazy.ctx, f.org, RECEIVED, f.message)
    return { eager: eager.reads(), lazy: lazy.reads() }
  })
  // The team, its webhook subscriptions, automations on the trigger, the
  // identity, its contact and runs waiting for that contact.
  expect(reads.lazy).toBeLessThanOrEqual(6)
  expect(reads.eager).toBeGreaterThan(reads.lazy)
  console.info("reads for an unlistened inbound message", reads)
})

test("a subscribed webhook gets the same payload and delivery as before", async () => {
  const f = await setup()
  // v2's stored payload for the same message.
  const expected = await f.t.run(async (ctx) => {
    const id = await emitEventAlways(
      ctx,
      f.org,
      RECEIVED,
      await hydratedChannelMessage(ctx, f.message, Date.now())
    )
    const row = (await ctx.db.get("events", id))!
    await ctx.db.delete("events", id)
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(10))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
    return row.data
  })
  const webhookId = await listenToEvents(f.t, f.org, [RECEIVED])
  const result = await f.t.run(async (ctx) =>
    outbox(ctx, await emitMessageEvent(ctx, f.org, RECEIVED, f.message))
  )
  // Delivery only: no automation listens.
  expect(result).toMatchObject({ stored: 1, jobs: ["webhooks:deliverEvent"] })
  const event = (await f.t.run((ctx) => ctx.db.get("events", result.id!)))!
  expect(event.data).toEqual(expected)
  expect(event.data).toMatchObject({
    contact_id: f.contactId,
    contact: { first_name: "Ada" },
    message: { id: f.message._id },
  })
  await f.t.mutation(internal.webhooks.deliverEvent, { id: result.id! })
  const deliveries = await f.t.run((ctx) =>
    ctx.db.query("webhookDeliveries").take(10)
  )
  expect(deliveries).toHaveLength(1)
  expect(deliveries[0]).toMatchObject({
    webhookId,
    event: RECEIVED,
    messageId: `msg_${result.id}`,
    payload: { type: RECEIVED, data: expected },
  })
})

test("an enabled automation on the trigger starts a run as before", async () => {
  const f = await setup()
  const automationId = await f.define(`opensend:${RECEIVED}`, HOLD)
  const result = await f.t.run(async (ctx) =>
    outbox(ctx, await emitMessageEvent(ctx, f.org, RECEIVED, f.message))
  )
  // No webhook: no delivery.
  expect(result).toMatchObject({
    stored: 1,
    jobs: ["automationRuntime:consume"],
  })
  await f.t.mutation(internal.automationRuntime.dispatch, {
    id: result.id!,
    phase: "start",
    cursor: null,
  })
  const run = await f.t.run((ctx) =>
    ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId", (q) =>
        q.eq("organizationId", f.org).eq("automationId", automationId)
      )
      .unique()
  )
  expect(run).toMatchObject({ contactId: f.contactId, eventId: result.id })
})

test("a run waiting for the contact's message is the only listener it needs, and resumes", async () => {
  const f = await setup()
  const automationId = await f.define("opensend:email.opened", [
    {
      key: "wait",
      type: "wait_for_event",
      eventName: `opensend:${RECEIVED}`,
      timeout: "1h",
      received: [],
      timedOut: [],
    },
  ])
  const start = await f.t.run((ctx) =>
    emitEventAlways(ctx, f.org, "email.opened", {
      id: "email-1",
      contact_id: f.contactId,
    })
  )
  await f.t.mutation(internal.automationRuntime.dispatch, {
    id: start,
    phase: "start",
    cursor: null,
  })
  const run = (await f.t.run((ctx) =>
    ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId", (q) =>
        q.eq("organizationId", f.org).eq("automationId", automationId)
      )
      .unique()
  ))! as Doc<"automationRuns">
  await f.t.mutation(internal.automationRuntime.perform, {
    id: run._id,
    key: "wait",
  })
  expect(
    (await f.t.run((ctx) => ctx.db.get("automationRuns", run._id)))?.waitingName
  ).toBe(`opensend:${RECEIVED}`)
  await f.t.run(async (ctx) => {
    for (const row of await ctx.db.query("events").take(10))
      await ctx.db.delete("events", row._id)
  })
  // Someone else's message: nothing waits for it.
  expect(
    await f.t.run(async (ctx) =>
      outbox(ctx, await emitMessageEvent(ctx, f.org, RECEIVED, f.stranger))
    )
  ).toMatchObject({ id: null, stored: 0 })
  vi.advanceTimersByTime(1000)
  const received = await f.t.run((ctx) =>
    emitMessageEvent(ctx, f.org, RECEIVED, f.message)
  )
  expect(received).not.toBeNull()
  await f.t.mutation(internal.automationRuntime.dispatch, {
    id: received!,
    phase: "wait",
    cursor: null,
  })
  const resumed = await f.t.run((ctx) => ctx.db.get("automationRuns", run._id))
  expect(resumed?.waitingName).toBeUndefined()
  expect(resumed?.lastSignalEventId).toBe(received)
})

test("custom events are always stored for the automation dispatcher", async () => {
  const f = await setup()
  const result = await f.t.run(async (ctx) =>
    outbox(
      ctx,
      await emitEvent(ctx, f.org, "custom:signup", { payload: { plan: "a" } })
    )
  )
  expect(result).toMatchObject({
    stored: 1,
    jobs: ["automationRuntime:consume"],
  })
})

test("a page of one thread's messages reads its identity, account, connection, alias and installation once", async () => {
  const f = await setup()
  const reads = await f.t.run(async (ctx) => {
    const page = [f.message, f.message, f.message]
    const alone = countReads(ctx)
    for (const message of page)
      await hydratedChannelMessage(alone.ctx, message, Date.now())
    const shared = countReads(ctx)
    const lookups: PageLookups = new Map()
    const rows = []
    for (const message of page)
      rows.push(
        await hydratedChannelMessage(
          shared.ctx,
          message,
          Date.now(),
          undefined,
          lookups
        )
      )
    expect(rows).toEqual(
      await Promise.all(
        page.map((message) => hydratedChannelMessage(ctx, message, Date.now()))
      )
    )
    return { alone: alone.reads(), shared: shared.reads() }
  })
  // Five lookups per message become five per page.
  expect(reads.alone - reads.shared).toBe(10)
})
