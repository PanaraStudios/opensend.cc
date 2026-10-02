import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { emitEvent } from "./events"
import { upsertContact } from "./audience"
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
for (const name of [
  "whatsapp.message.received",
  "instagram.message.received",
  "messenger.message.received",
  "email.opened",
  "whatsapp.call.completed",
] as const) {
  test(`${name} dispatch is tenant scoped, filterable and deduplicates the shared outbox`, async () => {
    const f = await setup()
    const trigger = `opensend:${name}`
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
