/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest"
import { convexTest } from "convex-test"
import aggregateTest from "@convex-dev/aggregate/test"
import migrationsTest from "@convex-dev/migrations/test"
import schema from "./schema"
import authSchema from "./betterAuth/schema"
import { createAuth } from "./auth"
import { components, internal } from "./_generated/api"
import { counters } from "./counts"
import { defineEvent } from "./automationEvents"
import { deleteAutomationEvent } from "./automationEventRows"

const modules = import.meta.glob("./**/*.ts")
const authModules = import.meta.glob("./betterAuth/**/*.ts")
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
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

test("a fresh deployment completes the empty backfill and immediately accepts custom events", async () => {
  const t = convexTest(schema, modules)
  aggregateTest.register(t, "automationEventCounts")
  migrationsTest.register(t)
  await t.mutation(internal.migrations.initializeEventCounts, {})
  const [status] = await t.query(components.migrations.lib.getStatus, {
    names: ["migrations:countAutomationEvents"],
  })
  expect(status).toMatchObject({ state: "success", processed: 0 })
  await t.run((ctx) =>
    defineEvent(ctx, "first-team", { name: "first.custom", schema: [] })
  )
  await t.run((ctx) =>
    defineEvent(ctx, "first-team", { name: "second.custom", schema: [] })
  )
  expect(
    await t.run((ctx) => counters.automationEvents.total(ctx, "first-team"))
  ).toBe(2)
})

test("first-account signup still logs its verification link after empty event-count initialization", async () => {
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubEnv("CONVEX_SITE_URL", "https://backend.opensend.test")
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "fresh-install-test-secret-at-least-thirty-two"
  )
  const t = convexTest(schema, modules)
  t.registerComponent("betterAuth", authSchema, authModules)
  aggregateTest.register(t, "automationEventCounts")
  migrationsTest.register(t)
  await t.mutation(internal.migrations.initializeEventCounts, {})
  const log = vi.spyOn(console, "log").mockImplementation(() => {})
  const email = "installer@example.test"
  await t.action((ctx) =>
    createAuth(ctx).api.signUpEmail({
      body: {
        name: "Installer Admin",
        email,
        password: "Installer-smoke-password-123",
      },
    })
  )
  const message = log.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(String(line))
      } catch {
        return null
      }
    })
    .find((entry) => entry?.event === "auth.email")
  expect(message).toMatchObject({ to: email, subject: "Verify your email" })
  expect(message.actionLink).toContain("/verify-email?")
})
