/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest"
import { convexTest } from "convex-test"
import aggregateTest from "@convex-dev/aggregate/test"
import migrationsTest from "@convex-dev/migrations/test"
import schema from "./schema"
import { components, internal } from "./_generated/api"
import { counters } from "./counts"
import { defineEvent } from "./automationEvents"
import { deleteAutomationEvent } from "./automationEventRows"

const modules = import.meta.glob("./**/*.ts")
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test("one deploy starts bounded count batches, resumes interrupted upgrades and releases the creation guard automatically", async () => {
  vi.useFakeTimers()
  const t = convexTest(schema, modules)
  aggregateTest.register(t, "automationEventCounts")
  migrationsTest.register(t)
  const org = "legacy-team"
  const ids = await t.run(async (ctx) => {
    const ids = []
    for (let i = 0; i < 250; i++)
      ids.push(
        await ctx.db.insert("automationEvents", {
          organizationId: org,
          name: `legacy${i}`,
          schema: [],
          searchText: `legacy${i}`,
          updatedAt: 0,
        })
      )
    return ids
  })
  // This is the function the migrate image invokes after its single deploy.
  await t.mutation(internal.migrations.initializeEventCounts, {})
  expect(await t.run((ctx) => counters.automationEvents.total(ctx, org))).toBe(
    100
  )
  await expect(
    t.run((ctx) => defineEvent(ctx, org, { name: "too.early", schema: [] }))
  ).rejects.toThrow("Custom event counts are being initialized")
  // A restart must resume the durable cursor, and deletion during the
  // backfill must remove an already-counted row without double counting.
  await t.mutation(components.migrations.lib.cancel, {
    name: "migrations:countAutomationEvents",
  })
  await t.run((ctx) => deleteAutomationEvent(ctx, ids[0]))
  await t.mutation(internal.migrations.initializeEventCounts, {})
  expect(await t.run((ctx) => counters.automationEvents.total(ctx, org))).toBe(
    199
  )
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run((ctx) => counters.automationEvents.total(ctx, org))).toBe(
    249
  )
  await t.run((ctx) =>
    defineEvent(ctx, org, { name: "after.upgrade", schema: [] })
  )
  expect(await t.run((ctx) => counters.automationEvents.total(ctx, org))).toBe(
    250
  )
  // Subsequent installer runs are a no-op; there is no second activation deploy.
  await t.mutation(internal.migrations.initializeEventCounts, {})
  expect(await t.run((ctx) => counters.automationEvents.total(ctx, org))).toBe(
    250
  )
})
