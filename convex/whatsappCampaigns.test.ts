import { beforeEach, afterEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import {
  inboundFixture,
  fakeGraph,
  signedWebhook,
  APP_SECRET,
  incoming,
  envelope,
  PHONE_ID,
  SENDER,
  WABA_ID,
} from "./testHelpers/meta.fixture"
import { patchRow, deleteRow } from "./counts"
import { startRun } from "./automationRuntime"
import { readGraph } from "./automationDefinition"
import { automationGraph, parseAutomationGraph } from "./api/automationGraph"
import type { AutomationStep } from "../lib/dashboard/types"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "campaign-key-".repeat(8))
  vi.stubEnv("BETTER_AUTH_SECRET", "campaign-secret-".repeat(4))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const mappings = {
  "1": { contact: "firstName" as const, fallback: "there" },
  "2": { property: "company", fallback: "Acme" },
  "3": { value: "ready" },
}
async function setup() {
  const f = await inboundFixture()
  workpoolTest.register(f.t, "webhookPool")
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
    await patchRow(ctx, "channelAccounts", f.account, {
      registeredAt: Date.now(),
    })
  })
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    organizationId: f.owner.team,
    wabaId: WABA_ID,
    syncedAt: Date.now(),
    templates: [
      {
        id: "12345",
        name: "campaign",
        language: "en_US",
        category: "MARKETING",
        status: "APPROVED",
        parameterFormat: "positional",
        components: [{ type: "BODY", text: "Hi {{1}}, {{2}} is {{3}}." }],
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
  const segment = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.owner.team,
    name: "Campaign",
  })
  const contacts = async (
    values: {
      phone?: string
      email?: string
      firstName?: string
      unsubscribed?: boolean
    }[],
    segmentIds = [segment]
  ) =>
    (
      await f.owner.client.mutation(api.contacts.upsert, {
        organizationId: f.owner.team,
        contacts: values,
        segmentIds,
      })
    ).createdIds
  const create = (extra = {}) =>
    f.owner.client.mutation(api.broadcasts.create, {
      organizationId: f.owner.team,
      name: "Campaign",
      channel: "whatsapp",
      segmentId: segment,
      whatsapp: {
        accountId: f.account,
        templateId: template._id,
        variables: mappings,
      },
      ...extra,
    })
  const read = (id: Id<"broadcasts">) =>
    f.t.run((ctx) => ctx.db.get("broadcasts", id))
  const stats = (id: Id<"broadcasts">) =>
    f.owner.client.query(api.broadcastMetrics.whatsappStats, {
      organizationId: f.owner.team,
      id,
    })
  const fanout = async (id: Id<"broadcasts">) => {
    vi.setSystemTime(Date.now() + 1000)
    await f.owner.client.mutation(api.broadcasts.send, { id })
    const row = (await read(id))!
    await f.t.run((ctx) =>
      patchRow(ctx, "broadcasts", id, { audienceBefore: Date.now() })
    )
    let pages = 0
    do {
      pages++
    } while (
      !(await f.t.mutation(internal.broadcastSend.batch, {
        id,
        generation: row.generation,
      }))
    )
    return pages
  }
  const recipients = (id: Id<"broadcasts">) =>
    f.t.run((ctx) =>
      ctx.db
        .query("broadcastRecipients")
        .withIndex("by_broadcastId_and_contactId", (q) =>
          q.eq("broadcastId", id)
        )
        .collect()
    )
  const graph = fakeGraph([
    {
      method: "POST",
      path: `/${PHONE_ID}/messages`,
      respond: () => ({
        messages: [{ id: `wamid.campaign.${Date.now()}.${Math.random()}` }],
      }),
    },
  ])
  return {
    ...f,
    template,
    segment,
    contacts,
    create,
    fanout,
    read,
    stats,
    recipients,
    graph,
  }
}
type Fixture = Awaited<ReturnType<typeof setup>>
async function project(f: Fixture, value: unknown) {
  expect(
    (await f.t.fetch("/meta/webhook", await signedWebhook(APP_SECRET, value)))
      .status
  ).toBe(200)
  const event = (await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  ))!
  await f.t.mutation(internal.meta.projection.project, { id: event._id })
}
async function deliver(f: Fixture, id: Id<"channelMessages">) {
  await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
  return (await f.t.run((ctx) => ctx.db.get("channelMessages", id)))!
}

test("broadcast pages enqueue once per phone contact, record all skip reasons and map variables", async () => {
  const f = await setup()
  const ids = await f.contacts([
    { phone: "+15550000001", firstName: "Alex" },
    { phone: "+15550000002" },
    { email: "email@example.test" },
    { phone: "+15550000004", unsubscribed: true },
    { phone: "+15550000005" },
    { phone: "+15550000006" },
  ])
  await f.t.run((ctx) =>
    patchRow(ctx, "contacts", ids[0], { properties: { company: "Custom" } })
  )
  await project(
    f,
    envelope({
      metadata: { phone_number_id: PHONE_ID },
      messages: [
        {
          id: "wamid.optout",
          from: "15550000005",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "stop" },
        },
      ],
    })
  )
  await f.t.run(async (ctx) => {
    const identity = (await ctx.db
      .query("channelContacts")
      .withIndex("by_contactId", (q) => q.eq("contactId", ids[4]))
      .unique())!
    await ctx.db.patch("channelContacts", identity._id, {
      marketingOptOut: true,
    })
  })
  const topicId = await f.owner.client.mutation(api.topics.create, {
    organizationId: f.owner.team,
    name: "News",
    description: "",
    defaultSubscription: "opt_out",
    visibility: "public",
  })
  await f.t.run((ctx) =>
    ctx.db.insert("topicSubscriptions", {
      organizationId: f.owner.team,
      contactId: ids[5],
      topicId,
      subscription: "unsubscribed",
    })
  )
  const id = await f.create({ topicId })
  expect(
    await f.owner.client.action(api.broadcastWhatsApp.review, {
      organizationId: f.owner.team,
      id,
    })
  ).toEqual({ recipients: 2, skipped: 4, noPhone: 1 })
  await f.fanout(id)
  const recipients = await f.recipients(id)
  expect(
    recipients
      .map((row) => row.skipReason)
      .filter(Boolean)
      .sort()
  ).toEqual(["marketing_opt_out", "no_phone", "topic_opt_out", "unsubscribed"])
  for (const recipient of recipients.filter((row) => row.messageId)) {
    const detail = await f.owner.client.query(api.messages.get, {
      id: recipient.messageId!,
    })
    const body =
      recipient.contactId === ids[0]
        ? "Hi Alex, Custom is ready."
        : "Hi there, Acme is ready."
    expect(detail).toMatchObject({
      rendered: { body, buttons: [] },
      message: { preview: body, source: "broadcast" },
    })
    const snapshot = await f.t.run((ctx) =>
      ctx.db
        .query("channelMessageContents")
        .withIndex("by_messageId", (q) =>
          q.eq("messageId", recipient.messageId!)
        )
        .unique()
    )
    expect(snapshot?.rendered).toEqual({ body, buttons: [] })
    const conversation = await f.t.run((ctx) =>
      ctx.db.get("conversations", detail!.message.conversationId)
    )
    expect(conversation?.lastPreview).toBe(body)
    await deliver(f, recipient.messageId!)
  }
  const parameters = f.graph
    .to(`/${PHONE_ID}/messages`)
    .map(
      (call) =>
        (call.body as { template: { components: unknown } }).template.components
    )
  expect(parameters).toEqual(
    expect.arrayContaining([
      [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Alex" },
            { type: "text", text: "Custom" },
            { type: "text", text: "ready" },
          ],
        },
      ],
      [
        {
          type: "body",
          parameters: [
            { type: "text", text: "there" },
            { type: "text", text: "Acme" },
            { type: "text", text: "ready" },
          ],
        },
      ],
    ])
  )
  expect(await f.stats(id)).toEqual({
    recipients: 2,
    sent: 2,
    delivered: 0,
    read: 0,
    failed: 0,
    skipped: 4,
  })
  expect(
    await f.t.mutation(internal.broadcastSend.batch, {
      id,
      generation: (await f.read(id))!.generation,
    })
  ).toBe(true)
  expect(await f.recipients(id)).toHaveLength(6)
})

test("status webhooks settle recipients, rank receipts, retain counts after message retention", async () => {
  const f = await setup()
  await f.contacts([{ phone: "+15550000001" }, { phone: "+15550000002" }])
  const id = await f.create()
  await f.fanout(id)
  const recipients = await f.recipients(id)
  const messages = await Promise.all(
    recipients.map((row) => deliver(f, row.messageId!))
  )
  expect((await f.read(id))?.status).toBe("queued")
  const statuses = (states: { id: string; status: string }[]) =>
    envelope({
      metadata: { phone_number_id: PHONE_ID },
      statuses: states.map((state) => ({
        ...state,
        recipient_id: messages.find(
          (message) => message.externalId === state.id
        )!.to,
        timestamp: String(Math.floor(Date.now() / 1000)),
      })),
    })
  await project(
    f,
    statuses(
      messages.map((message) => ({
        id: message.externalId!,
        status: "delivered",
      }))
    )
  )
  expect((await f.read(id))?.status).toBe("sent")
  await project(f, statuses([{ id: messages[0].externalId!, status: "read" }]))
  await project(
    f,
    statuses([{ id: messages[0].externalId!, status: "delivered" }])
  )
  expect(await f.stats(id)).toEqual({
    recipients: 2,
    sent: 2,
    delivered: 2,
    read: 1,
    failed: 0,
    skipped: 0,
  })
  await f.t.run(async (ctx) => {
    for (const message of messages)
      await deleteRow(ctx, "channelMessages", message._id)
  })
  expect((await f.stats(id)).delivered).toBe(2)
})

test("sent-without-receipt settles after 24h and final delivery failures settle the broadcast", async () => {
  const f = await setup()
  await f.contacts([{ phone: "+15550000001" }, { phone: "+15550000002" }])
  const id = await f.create()
  await f.fanout(id)
  const rows = await f.recipients(id)
  const sent = await deliver(f, rows[0].messageId!)
  await f.t.mutation(internal.channels.messages.record, {
    id: rows[1].messageId!,
    generation: 0,
    outcome: {
      kind: "failed",
      error: "Not deliverable",
      code: 131026,
      action: "final",
    },
  })
  expect((await f.read(id))?.status).toBe("queued")
  await f.t.mutation(internal.broadcastMetrics.settleMessage, { id: sent._id })
  expect((await f.read(id))?.status).toBe("queued")
  const settledClock = Date.now()
  vi.setSystemTime(Date.now() + 24 * 3600_000)
  await f.t.mutation(internal.broadcastMetrics.settleMessage, { id: sent._id })
  expect((await f.read(id))?.status).toBe("failed")
  vi.setSystemTime(settledClock)
  expect((await f.stats(id)).failed).toBe(1)
})

test("scheduled sends cancel safely, duplicate configuration and enforce team isolation", async () => {
  const f = await setup()
  await f.contacts([{ phone: "+15550000001" }])
  const id = await f.create()
  await f.owner.client.mutation(api.broadcasts.send, {
    id,
    scheduledAt: Date.now() + 3600_000,
  })
  const before = (await f.read(id))!
  await f.owner.client.mutation(api.broadcasts.cancel, { id })
  await f.t.mutation(internal.broadcastSend.start, {
    id,
    generation: before.generation,
  })
  expect((await f.read(id))?.status).toBe("canceled")
  expect(await f.recipients(id)).toEqual([])
  const copy = await f.owner.client.mutation(api.broadcasts.duplicate, { id })
  expect((await f.read(copy))?.whatsapp).toEqual(before.whatsapp)
  await expect(
    f.outsider.client.mutation(api.broadcasts.send, { id })
  ).rejects.toBeDefined()
  await expect(
    f.outsider.client.mutation(api.broadcasts.create, {
      organizationId: f.outsider.team,
      channel: "whatsapp",
      whatsapp: before.whatsapp,
    })
  ).rejects.toBeDefined()
  expect(
    await f.outsider.client.query(api.broadcasts.get, {
      organizationId: f.outsider.team,
      id,
    })
  ).toBeNull()
  expect(
    (
      await f.outsider.client.query(api.broadcastMetrics.whatsappStats, {
        organizationId: f.outsider.team,
        id,
      })
    ).sent
  ).toBe(0)
  await f.fanout(id)
  expect(await f.recipients(id)).toHaveLength(1)
})

function whatsappStep(
  f: Fixture,
  mode: "template" | "text" = "template"
): Extract<AutomationStep, { type: "send_whatsapp" }> {
  return {
    key: "send_whatsapp",
    type: "send_whatsapp",
    accountId: f.account,
    mode,
    templateId: f.template._id,
    variables: mappings,
    text: "Thanks for your reply",
  }
}
async function automation(f: Fixture, steps: AutomationStep[]) {
  const id = await f.owner.client.mutation(api.automations.create, {
    organizationId: f.owner.team,
  })
  await f.owner.client.mutation(api.automations.update, {
    organizationId: f.owner.team,
    id,
    trigger: "opensend:whatsapp.message.received",
    graph: JSON.stringify(steps),
  })
  expect(
    await f.owner.client.mutation(api.automations.setStatus, {
      organizationId: f.owner.team,
      id,
      status: "enabled",
    })
  ).toEqual([])
  return id
}
async function tick(f: Fixture) {
  for (let i = 0; i < 30; i++) {
    vi.advanceTimersByTime(100)
    await f.t.finishInProgressScheduledFunctions()
  }
}

test("inbound system event starts phone-only run, sends a template, and next reply resumes its wait", async () => {
  const f = await setup()
  const id = await automation(f, [
    whatsappStep(f),
    {
      key: "wait",
      type: "wait_for_event",
      eventName: "opensend:whatsapp.message.received",
      timeout: "1 day",
      received: [
        {
          key: "replied",
          type: "contact_update",
          fields: [
            { property: "last_name", action: "change", value: "Replied" },
          ],
        },
      ],
      timedOut: [],
    },
  ])
  // The email step needs an email template to activate; exercise phone-only
  // skipping independently below. This run's snapshot contains only WhatsApp.
  await project(f, incoming("wamid.trigger"))
  await tick(f)
  const runs = await f.t.run((ctx) =>
    ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId", (q) =>
        q.eq("organizationId", f.owner.team).eq("automationId", id)
      )
      .collect()
  )
  expect(runs).toHaveLength(1)
  const first = runs[0]
  expect(first.contactEmail).toBeUndefined()
  expect(first.waitingName).toBe("opensend:whatsapp.message.received")
  expect(f.graph.to(`/${PHONE_ID}/messages`)).toHaveLength(1)
  await project(f, incoming("wamid.reply"))
  await tick(f)
  const run = (await f.t.run((ctx) => ctx.db.get("automationRuns", first._id)))!
  expect(run.status).toBe("completed")
  expect(
    (await f.t.run((ctx) => ctx.db.get("contacts", first.contactId)))?.lastName
  ).toBe("Replied")
})

test("automation text sends inside the window, skips outside it and without a phone; email-only steps skip", async () => {
  const f = await setup()
  await project(f, incoming("wamid.window"))
  const contact = (await f.t.run((ctx) =>
    ctx.db
      .query("contacts")
      .withIndex("by_organizationId_and_phone", (q) =>
        q.eq("organizationId", f.owner.team).eq("phone", `+${SENDER}`)
      )
      .unique()
  ))!
  const id = await automation(f, [whatsappStep(f, "text")])
  const row = (await f.t.run((ctx) => ctx.db.get("automations", id)))!
  const runId = await f.t.run((ctx) => startRun(ctx, row, contact, {}))
  const run = (await f.t.run((ctx) => ctx.db.get("automationRuns", runId)))!
  const node = whatsappStep(f, "text")
  const result = await f.t.mutation(internal.automationRuntime.effect, {
    run,
    node: JSON.stringify(node),
  })
  expect(result.skipped).toBeUndefined()
  expect(result.output.message_id).toBeDefined()
  const messageId = result.output.message_id as Id<"channelMessages">
  const message = await deliver(f, messageId)
  expect(message.source).toBe("automation")
  expect(message.automationRunId).toBe(runId)
  const windowStart = Date.now()
  vi.setSystemTime(Date.now() + 25 * 3600_000)
  expect(
    await f.t.mutation(internal.automationRuntime.effect, {
      run,
      node: JSON.stringify(node),
    })
  ).toEqual({ skipped: true, output: { reason: "window_closed" } })
  vi.setSystemTime(windowStart)
  const [noPhoneId] = await f.contacts([{ email: "only-email@example.test" }])
  const noPhone = (await f.t.run((ctx) => ctx.db.get("contacts", noPhoneId)))!
  const noPhoneRunId = await f.t.run((ctx) => startRun(ctx, row, noPhone, {}))
  const noPhoneRun = (await f.t.run((ctx) =>
    ctx.db.get("automationRuns", noPhoneRunId)
  ))!
  expect(
    await f.t.mutation(internal.automationRuntime.effect, {
      run: noPhoneRun,
      node: JSON.stringify(node),
    })
  ).toEqual({ skipped: true, output: { reason: "no_phone" } })
  expect(
    await f.t.mutation(internal.automationRuntime.effect, {
      run,
      node: JSON.stringify({
        key: "email",
        type: "send_email",
        templateId: "",
        from: "",
        replyTo: "",
        variables: {},
      }),
    })
  ).toMatchObject({
    skipped: true,
    output: { reason: "no_email" },
  })
  const other = await f.actor("another")
  const foreign = await f.t.run(async (ctx) => {
    const account = (await ctx.db.get("channelAccounts", f.account))!
    const { _id: _id, _creationTime: _time, ...fields } = account
    void _id
    void _time
    return ctx.db.insert("channelAccounts", {
      ...fields,
      organizationId: other.team,
    })
  })
  await expect(
    f.t.mutation(internal.automationRuntime.effect, {
      run,
      node: JSON.stringify({ ...node, accountId: foreign }),
    })
  ).rejects.toBeDefined()
})

test("WhatsApp graph validation, REST round-trip and enabling validate references across teams", async () => {
  const f = await setup()
  const step = whatsappStep(f)
  expect(readGraph(JSON.stringify([step]))).toEqual([step])
  const { accountId: _account, ...noAccount } = step as Extract<
    AutomationStep,
    { type: "send_whatsapp" }
  >
  void _account
  expect(() => readGraph(JSON.stringify([noAccount]))).toThrow(
    "Invalid automation definition"
  )
  expect(() =>
    readGraph(JSON.stringify([{ ...step, templateId: undefined }]))
  ).toThrow("Invalid automation definition")
  expect(() =>
    readGraph(
      JSON.stringify([{ ...step, variables: { "1": { contact: "id" } } }])
    )
  ).toThrow("Invalid automation definition")
  const wire = automationGraph({
    trigger: "opensend:whatsapp.message.received",
    graph: JSON.stringify([step]),
  })
  expect(
    JSON.parse(parseAutomationGraph(wire.steps, wire.connections).graph)
  ).toEqual(
    [step].map((node) => {
      const { text: _text, ...value } = node as Extract<
        AutomationStep,
        { type: "send_whatsapp" }
      >
      void _text
      return value
    })
  )
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "campaign", permission: "full_access", domainId: null },
  })
  const response = await f.t.fetch("/automations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "WhatsApp", status: "enabled", ...wire }),
  })
  expect(response.status, await response.clone().text()).toBe(201)
  const made = await response.json()
  const fetched = await f.t.fetch(`/automations/${made.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await fetched.json()
  expect(data.steps).toEqual(wire.steps)
  expect(data.connections).toEqual(wire.connections)
  const id = await f.outsider.client.mutation(api.automations.create, {
    organizationId: f.outsider.team,
  })
  await f.outsider.client.mutation(api.automations.update, {
    organizationId: f.outsider.team,
    id,
    trigger: "opensend:whatsapp.message.received",
    graph: JSON.stringify([step]),
  })
  await expect(
    f.outsider.client.mutation(api.automations.setStatus, {
      organizationId: f.outsider.team,
      id,
      status: "enabled",
    })
  ).rejects.toBeDefined()
})

test("a large audience advances in bounded ten-contact batches", async () => {
  const f = await setup()
  for (let offset = 0; offset < 101; offset += 25)
    await f.contacts(
      Array.from({ length: Math.min(25, 101 - offset) }, (_, index) => ({
        phone: `+1555${String(offset + index).padStart(7, "0")}`,
      }))
    )
  const id = await f.create()
  expect(await f.fanout(id)).toBe(11)
  expect(await f.recipients(id)).toHaveLength(101)
  expect((await f.stats(id)).recipients).toBe(101)
})

test("a 10,000-contact imported audience never fans out in one mutation", async () => {
  const f = await setup()
  // Model an imported audience; these fixture rows intentionally avoid
  // aggregate work unrelated to the sender under test.
  for (let offset = 0; offset < 10000; offset += 500)
    await f.t.run(async (ctx) => {
      for (let i = offset; i < offset + 500; i++) {
        const contactId = await ctx.db.insert("contacts", {
          organizationId: f.owner.team,
          phone: `+1555${String(i).padStart(7, "0")}`,
          firstName: "",
          lastName: "",
          properties: {},
          unsubscribed: false,
          updatedAt: Date.now(),
          search: `contact ${i}`,
        })
        await ctx.db.insert("segmentMembers", {
          organizationId: f.owner.team,
          segmentId: f.segment,
          contactId,
        })
      }
    })
  vi.setSystemTime(Date.now() + 30000)
  const id = await f.create()
  await f.owner.client.mutation(api.broadcasts.send, { id })
  const row = (await f.read(id))!
  await f.t.run((ctx) =>
    patchRow(ctx, "broadcasts", id, { audienceBefore: Date.now() })
  )
  expect(
    await f.t.mutation(internal.broadcastSend.batch, {
      id,
      generation: row.generation,
    })
  ).toBe(false)
  expect(await f.recipients(id)).toHaveLength(10)
  const cursor = (await f.read(id))!.cursor
  expect(
    await f.t.mutation(internal.broadcastSend.batch, {
      id,
      generation: row.generation,
    })
  ).toBe(false)
  expect(await f.recipients(id)).toHaveLength(20)
  expect((await f.read(id))!.cursor).not.toBe(cursor)
})

test("broadcast REST creates WhatsApp drafts idempotently and returns the same variable mapping", async () => {
  const f = await setup()
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "broadcasts", permission: "full_access", domainId: null },
  })
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": "whatsapp-campaign",
  }
  const body = JSON.stringify({
    name: "API WhatsApp",
    channel: "whatsapp",
    whatsapp: {
      account_id: f.account,
      template_id: f.template._id,
      variables: mappings,
    },
    segment_id: f.segment,
  })
  const first = await f.t.fetch("/broadcasts", {
    method: "POST",
    headers,
    body,
  })
  expect(first.status, await first.clone().text()).toBe(201)
  const result = await first.json()
  const replay = await f.t.fetch("/broadcasts", {
    method: "POST",
    headers,
    body,
  })
  expect(await replay.json()).toEqual(result)
  const get = await f.t.fetch(`/broadcasts/${result.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(await get.json()).toMatchObject({
    id: result.id,
    channel: "whatsapp",
    whatsapp: {
      account_id: f.account,
      template_id: f.template._id,
      variables: mappings,
    },
  })
})

test("WhatsApp history retention snapshots stats before clearing recipients and aggregate entries", async () => {
  const f = await setup()
  await f.contacts([
    { phone: "+15550000001" },
    { email: "skipped@example.test" },
  ])
  const id = await f.create()
  await f.fanout(id)
  const recipient = (await f.recipients(id)).find((row) => row.messageId)!
  const message = await deliver(f, recipient.messageId!)
  await project(
    f,
    envelope({
      metadata: { phone_number_id: PHONE_ID },
      statuses: [
        {
          id: message.externalId,
          status: "read",
          recipient_id: message.to,
          timestamp: String(Math.floor(Date.now() / 1000)),
        },
      ],
    })
  )
  const before = await f.stats(id)
  const originalClock = Date.now()
  vi.setSystemTime(Date.now() + 31 * 86400_000)
  await f.t.mutation(internal.retention.broadcasts, {})
  expect((await f.read(id))!.retainedWhatsAppStats).toEqual(before)
  expect(await f.recipients(id)).toEqual([])
  vi.setSystemTime(originalClock)
  expect(await f.stats(id)).toEqual(before)
})

test("campaign pickers expose approved templates only on the selected live number's WABA", async () => {
  const f = await setup()
  const id = await f.create()
  const options = await f.owner.client.query(api.broadcastWhatsApp.options, {
    organizationId: f.owner.team,
    accountId: f.account,
    templateId: f.template._id,
  })
  expect(options.accounts).toHaveLength(1)
  expect(options.templates).toEqual([{ id: f.template._id, name: "campaign" }])
  expect(options.selected?.variables).toEqual(["1", "2", "3"])
  expect(
    await f.outsider.client.query(api.broadcastWhatsApp.options, {
      organizationId: f.outsider.team,
      accountId: f.account,
      templateId: f.template._id,
    })
  ).toEqual({ accounts: [], templates: [], selected: null })
  await f.t.run((ctx) =>
    patchRow(ctx, "templates", f.template._id, {
      whatsapp: { ...f.template.whatsapp!, metaStatus: "PENDING" },
    })
  )
  expect(
    (
      await f.owner.client.query(api.broadcastWhatsApp.options, {
        organizationId: f.owner.team,
        accountId: f.account,
      })
    ).templates
  ).toEqual([])
  await expect(
    f.owner.client.mutation(api.broadcasts.send, { id })
  ).rejects.toBeDefined()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { status: "restricted" })
  )
  expect(
    (
      await f.owner.client.query(api.broadcastWhatsApp.options, {
        organizationId: f.owner.team,
      })
    ).accounts
  ).toEqual([])
})

test("one settlement job follows the last send and pages recipients without receipts", async () => {
  const f = await setup()
  const audience = Array.from({ length: 105 }, (_, n) => ({
    phone: `+1555010${String(n).padStart(4, "0")}`,
  }))
  await f.contacts(audience.slice(0, 100))
  await f.contacts(audience.slice(100))
  const id = await f.create()
  await f.fanout(id)
  const recipients = await f.recipients(id)
  for (let n = 0; n < recipients.length; n++) {
    vi.setSystemTime(Date.now() + 1000)
    await deliver(f, recipients[n].messageId!)
    if (n === 0) expect((await f.read(id))?.settleJob).toBeUndefined()
  }
  const row = (await f.read(id))!
  const jobs = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect()
  )
  const settle = jobs.filter((job) =>
    job.name.includes("broadcastMetrics:settleBroadcast")
  )
  expect(settle).toHaveLength(1)
  expect(settle[0].scheduledTime).toBe(row.lastMessageSentAt! + 24 * 3600_000)
  expect(
    jobs.some((job) => job.name.includes("broadcastMetrics:settleMessage"))
  ).toBe(false)
  vi.setSystemTime(row.lastMessageSentAt! + 24 * 3600_000)
  await f.t.mutation(internal.broadcastMetrics.settleBroadcast, {
    id,
    cursor: null,
  })
  expect(
    (await f.recipients(id)).filter((recipient) => recipient.settled)
  ).toHaveLength(100)
  const continuation = (
    await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    )
  ).find(
    (job) =>
      job.name.includes("broadcastMetrics:settleBroadcast") &&
      (job.args[0] as { cursor?: string }).cursor
  )
  expect(continuation).toBeDefined()
  await f.t.mutation(
    internal.broadcastMetrics.settleBroadcast,
    continuation!.args[0] as { id: Id<"broadcasts">; cursor: string }
  )
  expect((await f.recipients(id)).every((recipient) => recipient.settled)).toBe(
    true
  )
  expect((await f.read(id))?.status).toBe("sent")
})

test("channel metrics preserve old shapes and recipient outcomes follow message receipts", async () => {
  const f = await setup()
  await f.contacts([{ phone: "+15550000001" }, { email: "only@example.test" }])
  const id = await f.create()
  await f.fanout(id)
  const recipient = (await f.recipients(id)).find((row) => row.messageId)!
  await deliver(f, recipient.messageId!)
  const page = await f.owner.client.query(api.broadcastWhatsApp.recipients, {
    organizationId: f.owner.team,
    id,
    paginationOpts: { numItems: 20, cursor: null },
  })
  expect(page.page.find((row) => row.messageId)?.messageStatus).toBe("sent")
  expect(page.page.find((row) => row.skipReason)?.skipReason).toBe("no_phone")
  const tagged = await f.owner.client.query(api.broadcastMetrics.channelStats, {
    organizationId: f.owner.team,
    id,
  })
  expect(tagged).toEqual({ channel: "whatsapp", stats: await f.stats(id) })
})

test("campaign picker shares sending restrictions and finds approved templates past draft rows", async () => {
  const f = await setup()
  for (let n = 0; n < 25; n++)
    await f.owner.client.mutation(api.templates.create, {
      organizationId: f.owner.team,
      channel: "whatsapp",
      name: `draft_${n}`,
    })
  const options = await f.owner.client.query(api.broadcastWhatsApp.options, {
    organizationId: f.owner.team,
    accountId: f.account,
  })
  expect(options.templates.map((row) => row.id)).toContain(f.template._id)
  const approved = await f.owner.client.query(api.templates.options, {
    organizationId: f.owner.team,
    channel: "whatsapp",
    wabaId: WABA_ID,
    approvedOnly: true,
  })
  expect(approved.map((row) => row._id)).toEqual([f.template._id])
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: undefined })
  )
  expect(
    (
      await f.owner.client.query(api.broadcastWhatsApp.options, {
        organizationId: f.owner.team,
        accountId: f.account,
      })
    ).accounts
  ).toEqual([])
})

test("review, broadcast sending and automation sending share missing-variable eligibility", async () => {
  const f = await setup()
  const [contactId] = await f.contacts([{ phone: "+15550000001" }])
  const variables = { ...mappings, "1": { contact: "firstName" as const } }
  const id = await f.create({
    whatsapp: { accountId: f.account, templateId: f.template._id, variables },
  })
  expect(
    await f.owner.client.action(api.broadcastWhatsApp.review, {
      organizationId: f.owner.team,
      id,
    })
  ).toEqual({ recipients: 0, skipped: 1, noPhone: 0 })
  await f.fanout(id)
  expect((await f.recipients(id))[0]).toMatchObject({
    skipReason: "missing_variables",
    settled: true,
  })
  const node = { ...whatsappStep(f), variables }
  const automationId = await automation(f, [node])
  const row = (await f.t.run((ctx) => ctx.db.get("automations", automationId)))!
  const contact = (await f.t.run((ctx) => ctx.db.get("contacts", contactId)))!
  const runId = await f.t.run((ctx) => startRun(ctx, row, contact, {}))
  const run = (await f.t.run((ctx) => ctx.db.get("automationRuns", runId)))!
  expect(
    await f.t.mutation(internal.automationRuntime.effect, {
      run,
      node: JSON.stringify(node),
    })
  ).toEqual({ skipped: true, output: { reason: "missing_variables" } })
})
