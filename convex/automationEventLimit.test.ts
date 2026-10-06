import { afterEach, expect, test, vi } from "vitest"
import { runToCompletion } from "@convex-dev/migrations"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { counters } from "./counts"
import { defineEvent } from "./automationEvents"
import {
  CUSTOM_EVENT_LIMIT_MESSAGE,
  deleteAutomationEvent,
} from "./automationEventRows"

afterEach(() => vi.restoreAllMocks())

test("definition create, edit, delete and auto-registration maintain the team counter", async () => {
  const f = await fixture()
  const org = f.owner.team
  const id = await f.t.run((ctx) =>
    defineEvent(ctx, org, { name: "paid", schema: [] })
  )
  expect(
    await f.t.run((ctx) => counters.automationEvents.total(ctx, org))
  ).toBe(1)
  await f.owner.client.mutation(api.automationEvents.ensure, {
    organizationId: org,
    names: ["paid", "signup", "signup"],
  })
  expect(
    await f.t.run((ctx) => counters.automationEvents.total(ctx, org))
  ).toBe(2)
  await f.t.run((ctx) => deleteAutomationEvent(ctx, id))
  expect(
    await f.t.run((ctx) => counters.automationEvents.total(ctx, org))
  ).toBe(1)
  expect(
    await f.t.run((ctx) =>
      counters.automationEvents.total(ctx, f.outsider.team)
    )
  ).toBe(0)
})

test("the 10,000th is allowed and the 10,001st is refused using the counter", async () => {
  const f = await fixture()
  const total = vi.spyOn(counters.automationEvents, "total")
  total.mockResolvedValue(9999)
  await f.t.run((ctx) =>
    defineEvent(ctx, f.owner.team, { name: "last", schema: [] })
  )
  total.mockResolvedValue(10000)
  await expect(
    f.t.run((ctx) =>
      defineEvent(ctx, f.owner.team, { name: "overflow", schema: [] })
    )
  ).rejects.toThrow(CUSTOM_EVENT_LIMIT_MESSAGE)
  await expect(
    f.owner.client.mutation(api.automationEvents.ensure, {
      organizationId: f.owner.team,
      names: ["auto.registered"],
    })
  ).rejects.toThrow(CUSTOM_EVENT_LIMIT_MESSAGE)
  total.mockResolvedValue(12000)
  await expect(
    f.t.run((ctx) =>
      defineEvent(ctx, f.owner.team, { name: "overflow", schema: [] })
    )
  ).rejects.toThrow(CUSTOM_EVENT_LIMIT_MESSAGE)
  expect(total).toHaveBeenCalled()
  expect(
    await f.t.run((ctx) => ctx.db.query("automationEvents").take(2))
  ).toHaveLength(1)
})

test("backfill is idempotent across live creation and deletion", async () => {
  const f = await fixture()
  const org = f.owner.team
  const legacy = await f.t.run((ctx) =>
    ctx.db.insert("automationEvents", {
      organizationId: org,
      name: "legacy",
      schema: [],
      searchText: "legacy",
      updatedAt: 0,
    })
  )
  await f.t.run((ctx) => defineEvent(ctx, org, { name: "live", schema: [] }))
  const backfill = async () =>
    f.t.action(async (ctx) => {
      await runToCompletion(
        ctx,
        components.migrations,
        internal.migrations.countAutomationEvents,
        { cursor: null }
      )
    })
  await backfill()
  expect(
    await f.t.run((ctx) => counters.automationEvents.total(ctx, org))
  ).toBe(2)
  await f.t.run((ctx) => deleteAutomationEvent(ctx, legacy))
  await backfill()
  expect(
    await f.t.run((ctx) => counters.automationEvents.total(ctx, org))
  ).toBe(1)
})
