import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { emitEvent } from "./events"
import { defineEvent } from "./automationEvents"
import { upsertContact, contactEventData } from "./audience"
import { createNote } from "./contactNotes"
import { startRun } from "./automationRuntime"
import { emailEventData } from "./emails"
import { emitDomain } from "./domains"
import { suppressionData, upsertSuppression } from "./suppressions"
import { payload as callPayload } from "./calling/rows"
import { channelMessagePayload } from "./channels/payload"
import { upsertChannelThread } from "./channels/identity"
import { insertRow } from "./counts"
import { whatsappInboundExamples } from "../lib/meta/whatsapp-fixtures"
import { schemaField, type EventField } from "../lib/event-catalog"
import { SYSTEM_EVENT_CATALOG, type CatalogEvent } from "../lib/event-catalog"
import type { AutomationStep } from "../lib/dashboard/types"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("BETTER_AUTH_SECRET", "event-catalog-test-secret-32-characters")
  vi.stubEnv("SITE_URL", "https://opensend.test")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
  })
  const contactId = await f.t.run(
    async (ctx) =>
      (
        await upsertContact(
          ctx,
          f.owner.team,
          { email: "ada@example.test", firstName: "Ada" },
          { properties: [], segmentIds: [] }
        )
      ).id
  )
  const define = async (
    trigger: string,
    steps: AutomationStep[],
    filters: { field: string; operator: "contains"; value: string }[] = []
  ) => {
    const id = await f.owner.client.mutation(api.automations.create, {
      organizationId: f.owner.team,
    })
    await f.owner.client.mutation(api.automations.update, {
      organizationId: f.owner.team,
      id,
      trigger,
      triggerFilters: filters,
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
  return { ...f, contactId, define }
}

test("saving and enabling an automation does not scan unrelated event definitions", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 200; i++)
      await defineEvent(ctx, f.owner.team, {
        name: `unrelated.${i}`,
        schema: [],
      })
    await defineEvent(ctx, f.owner.team, {
      name: "lead.signup",
      schema: [{ key: "name", type: "string" }],
    })
    await defineEvent(ctx, f.owner.team, {
      name: "lead.confirmed",
      schema: [{ key: "name", type: "string" }],
    })
  })
  const id = await f.owner.client.mutation(api.automations.create, {
    organizationId: f.owner.team,
  })
  const graph = JSON.stringify([
    {
      key: "wait",
      type: "wait_for_event",
      eventName: "lead.confirmed",
      timeout: "1 minute",
      received: [
        {
          key: "profile",
          type: "contact_update",
          fields: [
            {
              property: "first_name",
              action: "change",
              value: "{{trigger.name}} {{steps.wait.payload.name}}",
            },
          ],
        },
      ],
      timedOut: [],
    },
  ])
  await f.owner.client.run((ctx) =>
    ctx.runMutation(
      api.automations.update,
      {
        organizationId: f.owner.team,
        id,
        trigger: "lead.signup",
        graph,
      },
      { transactionLimits: { documentsRead: 100 } }
    )
  )
  const result = await f.owner.client.run((ctx) =>
    ctx.runMutation(
      api.automations.setStatus,
      {
        organizationId: f.owner.team,
        id,
        status: "enabled",
      },
      { transactionLimits: { documentsRead: 100 } }
    )
  )
  expect(result).toEqual([])
})

test("contact.deleted automations do not recreate the deleted contact", async () => {
  const f = await setup()
  const automationId = await f.define("opensend:contact.deleted", [
    { key: "hold", type: "delay", duration: "1m" },
  ])
  await f.owner.client.mutation(api.contacts.remove, {
    organizationId: f.owner.team,
    ids: [f.contactId],
  })
  const event = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_organizationId_and_type", (q) =>
        q.eq("organizationId", f.owner.team).eq("type", "contact.deleted")
      )
      .first()
  )
  expect(event).not.toBeNull()
  await f.t.mutation(internal.automationRuntime.dispatch, {
    id: event!._id,
    phase: "start",
    cursor: null,
  })
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("contacts")
        .withIndex("by_organizationId_and_email", (q) =>
          q.eq("organizationId", f.owner.team).eq("email", "ada@example.test")
        )
        .unique()
    )
  ).toBeNull()
  const run = await f.t.run((ctx) =>
    ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId", (q) =>
        q.eq("organizationId", f.owner.team).eq("automationId", automationId)
      )
      .unique()
  )
  expect(run).toMatchObject({
    payload: { id: f.contactId, email: "ada@example.test" },
  })
  expect(run?.contactId).toBeUndefined()
})

test("an event for a deleted contact cannot attach to a new contact at the same address", async () => {
  const f = await setup()
  const automationId = await f.define("opensend:email.opened", [
    { key: "hold", type: "delay", duration: "1m" },
  ])
  const eventId = await f.t.run((ctx) =>
    emitEvent(ctx, f.owner.team, "email.opened", {
      id: "email-before-deletion",
      contact_id: f.contactId,
      email: "ada@example.test",
    })
  )
  await f.owner.client.mutation(api.contacts.remove, {
    organizationId: f.owner.team,
    ids: [f.contactId],
  })
  const replacement = await f.t.run(
    async (ctx) =>
      (
        await upsertContact(
          ctx,
          f.owner.team,
          { email: "ada@example.test", firstName: "Replacement" },
          { properties: [], segmentIds: [] }
        )
      ).id
  )
  await f.t.mutation(internal.automationRuntime.dispatch, {
    id: eventId,
    phase: "start",
    cursor: null,
  })
  const run = await f.t.run((ctx) =>
    ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId", (q) =>
        q.eq("organizationId", f.owner.team).eq("automationId", automationId)
      )
      .unique()
  )
  expect(run).not.toBeNull()
  expect(run?.contactId).toBeUndefined()
  expect(
    (await f.t.run((ctx) => ctx.db.get("contacts", replacement)))?.firstName
  ).toBe("Replacement")
})
for (const name of [
  "whatsapp.message.received",
  "instagram.message.received",
  "messenger.message.received",
  "email.opened",
  "whatsapp.call.completed",
  "contact.note_created",
] as const) {
  test(`${name} dispatch is tenant scoped, filterable and deduplicates the shared outbox`, async () => {
    const f = await setup()
    const trigger = SYSTEM_EVENT_CATALOG.find(
      (event) => event.name === name
    )!.trigger
    const path = name === "email.opened" ? "subject" : "id"
    const id = await f.define(
      trigger,
      [
        {
          key: "update",
          type: "contact_update",
          fields: [
            {
              property: "last_name",
              action: "change",
              value: `{{trigger.${path}}}/{{contact.first_name}}`,
            },
          ],
        },
      ],
      [{ field: `trigger.${path}`, operator: "contains", value: "price" }]
    )
    const eventId = await f.t.run((ctx) =>
      emitEvent(ctx, f.owner.team, name, {
        id: "price-request",
        subject: "price-request",
        contact_id: f.contactId,
        text: "price?",
      })
    )
    await f.t.mutation(internal.automationRuntime.dispatch, {
      id: eventId,
      phase: "start",
      cursor: null,
    })
    await f.t.mutation(internal.automationRuntime.dispatch, {
      id: eventId,
      phase: "start",
      cursor: null,
    })
    const runs = await f.t.run((ctx) =>
      ctx.db
        .query("automationRuns")
        .withIndex("by_organizationId_and_automationId", (q) =>
          q.eq("organizationId", f.owner.team).eq("automationId", id)
        )
        .take(10)
    )
    expect(runs).toHaveLength(1)
    expect(runs[0].payload).toMatchObject({
      id: "price-request",
      subject: "price-request",
      contact: { first_name: "Ada" },
    })
    await f.t.mutation(internal.automationRuntime.perform, {
      id: runs[0]._id,
      key: "update",
    })
    expect(
      (await f.t.run((ctx) => ctx.db.get("contacts", f.contactId)))?.lastName
    ).toBe("price-request/Ada")
    const history = await f.t.run((ctx) =>
      ctx.db
        .query("automationRunSteps")
        .withIndex("by_organizationId_and_runId_and_key", (q) =>
          q.eq("organizationId", f.owner.team).eq("runId", runs[0]._id)
        )
        .take(10)
    )
    expect(history.find((s) => s.key === "update")).toMatchObject({
      inputs: { fields: [{ value: "price-request/Ada" }] },
      output: { contact: { last_name: "price-request/Ada" } },
    })
    const ignored = await f.t.run((ctx) =>
      emitEvent(ctx, f.owner.team, name, {
        id: "different",
        subject: "different",
        contact_id: f.contactId,
      })
    )
    await f.t.mutation(internal.automationRuntime.dispatch, {
      id: ignored,
      phase: "start",
      cursor: null,
    })
    const foreign = await f.t.run((ctx) =>
      emitEvent(ctx, f.outsider.team, name, {
        id: "price-request",
        subject: "price-request",
        contact_id: f.contactId,
      })
    )
    await f.t.mutation(internal.automationRuntime.dispatch, {
      id: foreign,
      phase: "start",
      cursor: null,
    })
    expect(
      await f.t.run((ctx) =>
        ctx.db
          .query("automationRuns")
          .withIndex("by_organizationId_and_automationId", (q) =>
            q.eq("organizationId", f.owner.team).eq("automationId", id)
          )
          .take(10)
      )
    ).toHaveLength(1)
  })
}
test("contactless events execute conditions and persist every output for later steps", async () => {
  const f = await setup()
  const id = await f.define("opensend:domain.updated", [
    {
      key: "c",
      type: "condition",
      match: "and",
      rules: [{ field: "trigger.status", operator: "eq", value: "verified" }],
      met: [
        {
          key: "pause",
          type: "delay",
          duration: "",
          until: "{{trigger.created_at}}",
        },
      ],
      notMet: [],
    },
  ])
  const eventId = await f.t.run((ctx) =>
    emitEvent(ctx, f.owner.team, "domain.updated", {
      id: f.domain,
      status: "verified",
      created_at: new Date(Date.now() + 60000).toISOString(),
    })
  )
  await f.t.mutation(internal.automationRuntime.dispatch, {
    id: eventId,
    phase: "start",
    cursor: null,
  })
  const run = (await f.t.run((ctx) =>
    ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId", (q) =>
        q.eq("organizationId", f.owner.team).eq("automationId", id)
      )
      .first()
  ))!
  expect(run.contactId).toBeUndefined()
  expect(
    await f.t.mutation(internal.automationRuntime.perform, {
      id: run._id,
      key: "c",
    })
  ).toEqual({ stopped: false, met: true })
  expect(
    await f.t.mutation(internal.automationRuntime.perform, {
      id: run._id,
      key: "pause",
    })
  ).toEqual({ stopped: false, sleepMs: 60000 })
})
test("catalog API and save errors include team schemas and reject unknown, future and mismatched references with 422", async () => {
  const f = await setup()
  await f.owner.client.mutation(api.automationEvents.create, {
    organizationId: f.owner.team,
    name: "paid",
    schema: [{ key: "total", type: "number" }],
  })
  await f.outsider.client.mutation(api.automationEvents.create, {
    organizationId: f.outsider.team,
    name: "secret",
    schema: [],
  })
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Catalog", permission: "full_access", domainId: null },
  })
  const call = async (path: string, body?: unknown) => {
    vi.setSystemTime(Date.now() + 1000)
    return f.t.fetch(path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }
  const response = await call("/events/catalog")
  expect(response.status).toBe(200)
  const catalog: { data: CatalogEvent[] } = await response.json()
  expect(catalog.data.map((e) => e.name)).toEqual([
    ...SYSTEM_EVENT_CATALOG.map((e) => e.name),
    "paid",
  ])
  await expect(
    f.outsider.client.query(api.automationEvents.catalog, {
      organizationId: f.owner.team,
    })
  ).rejects.toThrow("permission")
  for (const rules of [
    [
      {
        type: "rule",
        field: "trigger.total",
        operator: "contains",
        value: "no",
      },
    ],
    [
      {
        type: "rule",
        field: "trigger.total",
        operator: "eq",
        value: "{{steps.future.message_id}}",
      },
    ],
    [{ type: "rule", field: "trigger.unknown", operator: "eq", value: "no" }],
  ]) {
    const response = await call("/automations", {
      name: "Bad",
      steps: [
        { key: "start", type: "trigger", config: { event_name: "paid" } },
        { key: "check", type: "condition", config: { type: "and", rules } },
      ],
      connections: [{ from: "start", to: "check" }],
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ name: "validation_error" })
  }
})

/** Validate present fields recursively so a new payload property must be
 * exposed in the catalog; provider extension objects accept arbitrary JSON. */
function payloadContract(
  schema: EventField,
  value: unknown,
  path = "payload"
): string[] {
  if (value === null) return schema.nullable ? [] : [`${path}: unexpected null`]
  const type = Array.isArray(value) ? "array" : typeof value
  if (
    !schema.dynamic &&
    !(schema.valueTypes ?? [schema.type]).some(
      (expected) =>
        expected === type ||
        (["enum", "date"].includes(expected) && type === "string")
    )
  )
    return [`${path}: ${type} does not match ${schema.type}`]
  if (
    schema.type === "enum" &&
    typeof value === "string" &&
    !schema.values?.includes(value)
  )
    return [`${path}: unknown enum ${value}`]
  if (
    schema.type === "date" &&
    typeof value === "string" &&
    Number.isNaN(Date.parse(value))
  )
    return [`${path}: invalid date`]
  if (Array.isArray(value))
    return schema.items
      ? value.flatMap((item, index) =>
          payloadContract(schema.items!, item, `${path}.${index}`)
        )
      : schema.dynamic
        ? []
        : [`${path}: missing array item schema`]
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) => {
      const child = schemaField(schema, key)
      return child
        ? payloadContract(child, item, `${path}.${key}`)
        : [`${path}.${key}: missing catalog field`]
    })
  return []
}

test("every event contract covers payload builders, including all WhatsApp content variants and note author/source fields", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    const contact = (await ctx.db.get("contacts", f.contactId))!
    const connectionId = await ctx.db.insert("metaConnections", {
      organizationId: f.owner.team,
      businessId: "catalog-business",
      businessName: "Catalog",
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
        organizationId: f.owner.team,
        channel: "whatsapp",
        externalId: "catalog-account",
        connectionId,
        displayName: "Catalog",
        handle: "+15550008061",
        status: "active",
        throughputMps: 80,
      },
      true
    )
    const thread = await upsertChannelThread(ctx, account, {
      externalId: "15550008062",
      phone: "+15550008062",
      at: Date.now(),
      direction: "inbound",
      opensWindow: true,
      preview: "price",
    })
    const message = await insertRow(
      ctx,
      "channelMessages",
      {
        organizationId: f.owner.team,
        channel: "whatsapp",
        accountId: account._id,
        conversationId: thread.conversationId,
        channelContactId: thread.channelContactId,
        direction: "inbound",
        from: "15550008062",
        to: "15550008061",
        type: "text",
        status: "received",
        preview: "price",
        generation: 1,
        attempts: 0,
      },
      true
    )
    const emailId = await ctx.db.insert("emails", {
      organizationId: f.owner.team,
      domainId: f.domain,
      from: "support@mail.example.test",
      to: [contact.email!],
      subject: "Price",
      status: "sent",
      source: "api",
      generation: 1,
      attempts: 0,
      search: "price",
      messageId: "provider-message",
      broadcastId: "broadcast-example",
    })
    const email = await emailEventData(
      ctx,
      (await ctx.db.get("emails", emailId))!
    )
    const callId = await ctx.db.insert("calls", {
      organizationId: f.owner.team,
      accountId: account._id,
      contactId: contact._id,
      direction: "inbound",
      status: "completed",
      mode: "api",
      observedAt: Date.now(),
      botUsage: {
        inputTokens: 5,
        outputTokens: 2,
        audioSeconds: 20,
        ttsCharacters: 40,
      },
      remoteSession: { sdp: "session", sdp_type: "offer" },
    })
    const call = await callPayload(ctx, (await ctx.db.get("calls", callId))!)
    const suppressionId = await upsertSuppression(
      ctx,
      f.owner.team,
      "suppressed@example.test",
      "manual"
    )
    const suppression = suppressionData(
      (await ctx.db.get("suppressions", suppressionId))!
    )
    const note = await createNote(ctx, contact, {
      body: "Follow up",
      author: { kind: "bot", id: "bot-example", name: "Support" },
      source: {
        callId,
        conversationId: thread.conversationId,
        messageId: message._id,
      },
    })
    const noteEvent = await ctx.db
      .query("events")
      .withIndex("by_organizationId_and_type", (q) =>
        q.eq("organizationId", f.owner.team).eq("type", "contact.note_created")
      )
      .order("desc")
      .first()
    expect(noteEvent?.data).toMatchObject({
      id: note._id,
      contact: { first_name: "Ada" },
    })
    const tested = new Set<string>()
    const violations: string[] = []
    for (const event of SYSTEM_EVENT_CATALOG) {
      if (event.name.startsWith("domain.")) {
        await emitDomain(ctx, f.domain, event.name as "domain.created")
        const row = await ctx.db
          .query("events")
          .withIndex("by_organizationId_and_type", (q) =>
            q.eq("organizationId", f.owner.team).eq("type", event.name)
          )
          .order("desc")
          .first()
        expect(payloadContract(event.schema, row!.data), event.name).toEqual([])
      } else if (event.name === "contact.note_created") {
        violations.push(
          ...payloadContract(event.schema, noteEvent!.data, event.name)
        )
      } else if (
        event.name.includes(".message.") &&
        !/read_receipt|typing_failed/.test(event.name)
      ) {
        for (const [variant, raw] of Object.entries(
          event.name.startsWith("whatsapp.")
            ? whatsappInboundExamples
            : { text: { message: { text: "price" } } }
        )) {
          const wire = channelMessagePayload(
            {
              ...message,
              channel: event.name.split(".")[0] as typeof message.channel,
              type: (raw.type ?? "text") as typeof message.type,
            },
            raw
          )
          violations.push(
            ...payloadContract(event.schema, wire, `${event.name}: ${variant}`)
          )
        }
      } else {
        const data = event.name.startsWith("email.")
          ? {
              ...email,
              ...(event.name === "email.received"
                ? {
                    received_for: ["support@mail.example.test"],
                    attachments: [
                      {
                        id: "attachment",
                        filename: "quote.pdf",
                        content_type: "application/pdf",
                        content_disposition: "attachment",
                        content_id: null,
                      },
                    ],
                  }
                : {}),
            }
          : event.name === "call.data_collected"
            ? {
                call_id: callId,
                contact_id: contact._id,
                collected: { participants: { value: 2, inferred: false } },
                missing: ["date"],
              }
            : event.name.endsWith("permission_updated") ||
                event.name.startsWith("call.permission_")
              ? {
                  account_id: account._id,
                  user_id: "caller",
                  permission: {
                    status: "temporary",
                    expiration_time: 1790000000,
                  },
                  response_source: null,
                  context_id: null,
                }
              : event.name.endsWith("ivr_completed")
                ? {
                    id: callId,
                    account_id: account._id,
                    ivr_id: "ivr-example",
                    path: [
                      {
                        menuId: "main",
                        digits: "1",
                        at: Date.now(),
                        action: { kind: "hangup" },
                      },
                    ],
                    final_action: { kind: "hangup" },
                  }
                : event.name.includes(".call.") ||
                    event.name.startsWith("call.outbound_")
                  ? call
                  : event.name.startsWith("contact.")
                    ? contactEventData(contact, [])
                    : event.name.startsWith("suppression.")
                      ? suppression
                      : /read_receipt|typing_failed/.test(event.name)
                        ? {
                            id: message._id,
                            conversation_id: message.conversationId,
                            ...(event.name.endsWith("sent")
                              ? {
                                  read_receipt_sent_at:
                                    new Date().toISOString(),
                                }
                              : { error: "Provider unavailable" }),
                          }
                        : event.name.includes("template.")
                          ? {
                              account_id: account._id,
                              waba_id: "business",
                              field: "message_template_status_update",
                              event: "APPROVED",
                              message_template_id: 123,
                              message_template_name: "greeting",
                              message_template_language: "en",
                            }
                          : {
                              id: account._id,
                              account_id: account._id,
                              channel: "whatsapp",
                              field: "account_settings_update",
                              calling: { status: "ENABLED" },
                              handling_mode: "api",
                            }
        violations.push(...payloadContract(event.schema, data, event.name))
      }
      tested.add(event.name)
    }
    expect(tested.size).toBe(SYSTEM_EVENT_CATALOG.length)
    expect(violations).toEqual([])
  })
})

test("contactless event waits resume once and expose the received payload to later steps", async () => {
  const f = await setup()
  const id = await f.define("opensend:domain.updated", [
    {
      key: "wait",
      type: "wait_for_event",
      eventName: "opensend:domain.deleted",
      timeout: "1h",
      received: [
        {
          key: "check",
          type: "condition",
          match: "and",
          rules: [
            {
              field: "steps.wait.name",
              operator: "eq",
              value: "mail.example.test",
            },
          ],
          met: [],
          notMet: [],
        },
      ],
      timedOut: [],
    },
  ])
  const event = await f.t.run((ctx) =>
    emitEvent(ctx, f.owner.team, "domain.updated", {
      id: f.domain,
      name: "mail.example.test",
    })
  )
  await f.t.mutation(internal.automationRuntime.dispatch, {
    id: event,
    phase: "start",
    cursor: null,
  })
  const run = (await f.t.run((ctx) =>
    ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_automationId", (q) =>
        q.eq("organizationId", f.owner.team).eq("automationId", id)
      )
      .first()
  ))!
  await f.t.mutation(internal.automationRuntime.perform, {
    id: run._id,
    key: "wait",
  })
  const received = await f.t.run((ctx) =>
    emitEvent(ctx, f.owner.team, "domain.deleted", {
      id: f.domain,
      name: "mail.example.test",
    })
  )
  for (let attempt = 0; attempt < 2; attempt++)
    await f.t.mutation(internal.automationRuntime.dispatch, {
      id: received,
      phase: "wait",
      cursor: null,
    })
  const resumed = await f.t.run((ctx) => ctx.db.get("automationRuns", run._id))
  expect(resumed?.waitingName).toBeUndefined()
  expect(resumed?.lastSignalEventId).toBe(received)
  await f.t.mutation(internal.automationRuntime.finishWait, {
    id: run._id,
    key: "wait",
    received: true,
    payload: { id: f.domain, name: "mail.example.test" },
  })
  expect(
    await f.t.mutation(internal.automationRuntime.perform, {
      id: run._id,
      key: "check",
    })
  ).toMatchObject({ met: true })
})
test("skipped step outputs remain available to conditions", async () => {
  const f = await setup()
  const id = await f.owner.client.mutation(api.automations.create, {
    organizationId: f.owner.team,
  })
  await f.owner.client.mutation(api.automations.update, {
    organizationId: f.owner.team,
    id,
    trigger: "opensend:domain.updated",
    graph: JSON.stringify([
      {
        key: "send",
        type: "send_email",
        templateId: "",
        from: "",
        replyTo: "",
        variables: {},
      },
      {
        key: "check",
        type: "condition",
        match: "and",
        rules: [
          { field: "steps.send.status", operator: "eq", value: "skipped" },
        ],
        met: [],
        notMet: [],
      },
    ]),
  })
  const run = await f.t.run(async (ctx) =>
    startRun(ctx, (await ctx.db.get("automations", id))!, null, {
      id: f.domain,
    })
  )
  expect(
    await f.t.mutation(internal.automationRuntime.perform, {
      id: run,
      key: "send",
    })
  ).toEqual({ stopped: false })
  expect(
    await f.t.mutation(internal.automationRuntime.perform, {
      id: run,
      key: "check",
    })
  ).toMatchObject({ met: true })
})
