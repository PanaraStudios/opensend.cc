import { afterEach, expect, test, vi } from "vitest"
import { internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import {
  SIGNED_NOTIFICATION_V2,
  SIGNED_SUBSCRIPTION_CONFIRMATION,
  TEST_CERT_PEM,
} from "./testHelpers/snsFixture"
import {
  INBOUND_NOTIFICATION,
  INBOUND_CERT_PEM,
} from "./testHelpers/inboundSns.fixture"
import {
  SNS_DEDUPE_RETENTION_MS,
  SNS_MAX_MESSAGE_AGE_MS,
} from "./ses/contracts"
import { verifySns } from "./ses/sns"
import * as publicHttp from "../lib/net/public-fetch"

const signedAt = Date.parse(SIGNED_NOTIFICATION_V2.Timestamp)
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test("signed SNS age limit preserves the dedupe margin and rejects invalid timestamps (S10)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(signedAt + SNS_MAX_MESSAGE_AGE_MS)
  vi.spyOn(publicHttp, "publicFetch").mockResolvedValue(
    new Response(TEST_CERT_PEM)
  )
  const log = vi.spyOn(console, "warn").mockImplementation(() => {})
  expect(SNS_DEDUPE_RETENTION_MS - SNS_MAX_MESSAGE_AGE_MS).toBe(5 * 86_400_000)
  expect(await verifySns(SIGNED_NOTIFICATION_V2)).toBe(true)
  vi.setSystemTime(signedAt + SNS_MAX_MESSAGE_AGE_MS + 1)
  expect(await verifySns(SIGNED_NOTIFICATION_V2)).toBe(false)
  expect(log).toHaveBeenCalledWith("Skipping expired SNS message")
  // Changing a signed timestamp cannot bypass the age check.
  await expect(
    verifySns({ ...SIGNED_NOTIFICATION_V2, Timestamp: "invalid" })
  ).rejects.toThrow("signature")
})

test("an expired signed notification cannot reenter after its dedupe row is pruned (S10)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(signedAt + 1000)
  const f = await fixture()
  await f.t.mutation(internal.ses.state.patchRegion, {
    id: f.region._id,
    changes: { topicArn: SIGNED_NOTIFICATION_V2.TopicArn },
  })
  vi.spyOn(publicHttp, "publicFetch").mockResolvedValue(
    new Response(TEST_CERT_PEM)
  )
  const log = vi.spyOn(console, "warn").mockImplementation(() => {})
  const receive = () =>
    f.t.fetch("/ses/events", {
      method: "POST",
      body: JSON.stringify(SIGNED_NOTIFICATION_V2),
    })
  expect((await receive()).status).toBe(204)
  expect(
    await f.t.run((ctx) => ctx.db.query("sesEvents").take(10))
  ).toHaveLength(1)
  vi.setSystemTime(signedAt + SNS_DEDUPE_RETENTION_MS + 2000)
  await f.t.mutation(internal.retention.ses, {})
  expect(await f.t.run((ctx) => ctx.db.query("sesEvents").take(10))).toEqual([])
  const before = await f.t.run(async (ctx) => ({
    scheduled: await ctx.db.system.query("_scheduled_functions").take(100),
    region: await ctx.db.get("sesRegions", f.region._id),
  }))
  expect((await receive()).status).toBe(204)
  // Expired confirmations must not call AWS or modify readiness either.
  const confirmation = await f.t.fetch("/ses/events", {
    method: "POST",
    body: JSON.stringify(SIGNED_SUBSCRIPTION_CONFIRMATION),
  })
  expect(confirmation.status).toBe(204)
  expect(await f.t.run((ctx) => ctx.db.query("sesEvents").take(10))).toEqual([])
  expect(
    await f.t.run(async (ctx) => ({
      scheduled: await ctx.db.system.query("_scheduled_functions").take(100),
      region: await ctx.db.get("sesRegions", f.region._id),
    }))
  ).toEqual(before)
  expect(log).toHaveBeenCalledTimes(2)
})

test("expired inbound SNS notifications are acknowledged without ingestion or scheduling (S10)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(
    Date.parse(INBOUND_NOTIFICATION.Timestamp) + SNS_MAX_MESSAGE_AGE_MS + 1
  )
  const f = await fixture()
  await f.t.run((ctx) =>
    ctx.db.insert("inboundRegions", {
      region: "us-east-1",
      operation: "provision",
      phase: "ready",
      generation: 1,
      topicArn: INBOUND_NOTIFICATION.TopicArn,
      callbackConfirmed: true,
    })
  )
  vi.spyOn(publicHttp, "publicFetch").mockResolvedValue(
    new Response(INBOUND_CERT_PEM)
  )
  const log = vi.spyOn(console, "warn").mockImplementation(() => {})
  const before = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").take(100)
  )
  const response = await f.t.fetch("/ses/inbound", {
    method: "POST",
    body: JSON.stringify(INBOUND_NOTIFICATION),
  })
  expect(response.status).toBe(204)
  expect(
    await f.t.run((ctx) => ctx.db.query("inboundMessages").take(10))
  ).toEqual([])
  expect(
    await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(100))
  ).toEqual(before)
  expect(log).toHaveBeenCalledWith("Skipping expired SNS message")
})
