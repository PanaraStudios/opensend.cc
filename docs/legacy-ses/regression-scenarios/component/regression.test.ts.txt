import { afterEach, describe, expect, it, vi } from "vitest"
import {
  SESv2Client,
  SendBulkEmailCommand,
  SendEmailCommand,
  TooManyRequestsException,
} from "@aws-sdk/client-sesv2"
import { mockClient } from "aws-sdk-client-mock"
import { createFunctionHandle, makeFunctionReference } from "convex/server"
import { v } from "convex/values"
import { internalMutation } from "./_generated/server.js"
import { api, internal } from "./_generated/api.js"
import {
  createTestEventOfType,
  createTestRuntimeConfig,
  getEmail,
  insertTestSentEmail,
  setupTest,
} from "./setup.test.js"

const options = createTestRuntimeConfig({ maxSendRate: 1000 })
const config = {
  region: options.region,
  credentials: options.credentials,
  maxSendRate: options.maxSendRate,
}
const sendArgs = {
  options,
  from: "sender@example.com",
  to: ["success@simulator.amazonses.com"],
  subject: "Hi",
  text: "hello",
}

// Test-only callbacks, resolved by the actual workpool via function handles.
export const callbackA = internalMutation({
  args: { id: v.id("emails"), event: v.any() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch("emails", id, { subject: "callback A" })
    return null
  },
})
export const callbackB = internalMutation({
  args: { id: v.id("emails"), event: v.any() },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch("emails", id, { subject: "callback B" })
    return null
  },
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("review regressions", () => {
  it("runs enqueue -> scheduler -> workpool -> SDK -> completion with nested components", async () => {
    vi.useFakeTimers()
    const sdk = mockClient(SESv2Client)
    sdk.on(SendEmailCommand).resolves({ MessageId: "complete-1" })
    const t = setupTest()
    const id = await t.mutation(api.lib.sendEmail, sendArgs)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await getEmail(t, id)).status).toBe("sent")
    expect(sdk.commandCalls(SendEmailCommand)).toHaveLength(1)
    expect(
      await t.run((ctx) => ctx.db.query("nextBatchRun").collect())
    ).toEqual([])
    sdk.restore()
  })
  it("retries throttling through the actual workpool and eventually completes", async () => {
    vi.useFakeTimers()
    const sdk = mockClient(SESv2Client)
    sdk
      .on(SendEmailCommand)
      .rejectsOnce(
        new TooManyRequestsException({ message: "throttled", $metadata: {} })
      )
      .resolves({ MessageId: "retried" })
    const t = setupTest()
    const id = await t.mutation(api.lib.sendEmail, sendArgs)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await getEmail(t, id)).sesMessageId).toBe("retried")
    expect(sdk.commandCalls(SendEmailCommand)).toHaveLength(2)
    sdk.restore()
  })
  it("retries only transient bulk entries after persisting partial outcomes", async () => {
    const t = setupTest()
    const sdk = mockClient(SESv2Client)
    const emails = await Promise.all(
      [0, 1, 2].map(() =>
        insertTestSentEmail(t, {
          status: "queued",
          sesMessageId: undefined,
          template: { name: "Welcome", data: {} },
        })
      )
    )
    sdk.on(SendBulkEmailCommand).resolves({
      BulkEmailEntryResults: [
        { Status: "SUCCESS", MessageId: "accepted" },
        { Status: "MESSAGE_REJECTED", Error: "bad recipient" },
        { Status: "ACCOUNT_THROTTLED", Error: "try later" },
      ],
    })
    const args = { config, emailIds: emails.map((e) => e._id) }
    await expect(t.action(internal.lib.sendBatch, args)).rejects.toThrow(
      "transient"
    )
    expect((await getEmail(t, emails[0]!._id)).status).toBe("sent")
    expect((await getEmail(t, emails[1]!._id)).status).toBe("failed")
    sdk.on(SendEmailCommand).resolves({ MessageId: "retried" })
    await t.action(internal.lib.sendBatch, args)
    expect(sdk.commandCalls(SendEmailCommand)).toHaveLength(1)
    expect((await getEmail(t, emails[2]!._id)).sesMessageId).toBe("retried")
    sdk.restore()
  })
  it("preserves region per enqueue and never returns credentials from get", async () => {
    vi.useFakeTimers()
    const sdk = mockClient(SESv2Client)
    const regions: string[] = []
    sdk.on(SendEmailCommand).callsFake(async (_input, getClient) => {
      regions.push(await getClient().config.region())
      return { MessageId: `id-${regions.length}` }
    })
    const t = setupTest()
    const a = await t.mutation(api.lib.sendEmail, sendArgs)
    await t.mutation(api.lib.sendEmail, {
      ...sendArgs,
      options: { ...options, region: "eu-west-1" },
    })
    const details = await t.query(api.lib.get, { emailId: a })
    expect(JSON.stringify(details)).not.toContain("secretAccessKey")
    expect(details).not.toHaveProperty("options")
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(regions.sort()).toEqual(["eu-west-1", "us-east-1"])
    sdk.restore()
  })
  it("rejects cancellation once sending is claimed", async () => {
    const t = setupTest()
    const sdk = mockClient(SESv2Client)
    const id = (
      await insertTestSentEmail(t, {
        status: "queued",
        sesMessageId: undefined,
      })
    )._id
    sdk.on(SendEmailCommand).callsFake(async () => {
      await expect(
        t.mutation(api.lib.cancelEmail, { emailId: id })
      ).rejects.toThrow("sending has started")
      return { MessageId: "race-winner" }
    })
    await t.action(internal.lib.sendBatch, { config, emailIds: [id] })
    expect((await getEmail(t, id)).sesMessageId).toBe("race-winner")
    sdk.restore()
  })
  it("skips a cancellation that wins before claim", async () => {
    const t = setupTest()
    const id = (
      await insertTestSentEmail(t, {
        status: "queued",
        sesMessageId: undefined,
      })
    )._id
    await t.mutation(api.lib.cancelEmail, { emailId: id })
    expect(
      await t.mutation(internal.lib.claimSend, { emailIds: [id] })
    ).toEqual([])
  })
  it("uses a reserved tag to recover acceptance before the SDK response is saved", async () => {
    const t = setupTest()
    const email = await insertTestSentEmail(t, {
      status: "queued",
      sesMessageId: undefined,
      sendStarted: true,
    })
    await t.mutation(api.lib.handleEmailEvent, {
      event: createTestEventOfType("Delivery", {
        mail: { tags: { "convex-email-id": [email._id] } },
      }),
      notificationId: "tagged",
    })
    expect((await getEmail(t, email._id)).status).toBe("delivered")
    expect(
      await t.query(internal.lib.getBatchPayload, { emailIds: [email._id] })
    ).toEqual([])
  })
  it("does not correlate an unclaimed email by a forged or stale tag", async () => {
    const t = setupTest()
    const email = await insertTestSentEmail(t, {
      status: "waiting",
      sesMessageId: undefined,
    })
    expect(
      await t.mutation(api.lib.handleEmailEvent, {
        event: createTestEventOfType("Delivery", {
          mail: { tags: { "convex-email-id": [email._id] } },
        }),
      })
    ).toBe(false)
    expect((await getEmail(t, email._id)).status).toBe("waiting")
  })
  it("requests retry for an event arriving before its send result is saved", async () => {
    const t = setupTest()
    const event = createTestEventOfType("Delivery")
    const id = (
      await insertTestSentEmail(t, {
        status: "queued",
        sesMessageId: undefined,
      })
    )._id
    expect(
      await t.mutation(api.lib.handleEmailEvent, {
        event,
        notificationId: "early",
      })
    ).toBe(false)
    await t.mutation(internal.lib.recordSendOutcome, {
      sent: [{ emailId: id, messageId: event.mail.messageId }],
      failed: [],
    })
    await t.mutation(api.lib.handleEmailEvent, {
      event,
      notificationId: "early",
    })
    expect((await getEmail(t, id)).status).toBe("delivered")
  })
  it("deduplicates SNS retries and preserves separate open events", async () => {
    const t = setupTest()
    await insertTestSentEmail(t)
    const event = createTestEventOfType("Open")
    await t.mutation(api.lib.handleEmailEvent, {
      event,
      notificationId: "sns-1",
    })
    await t.mutation(api.lib.handleEmailEvent, {
      event,
      notificationId: "sns-1",
    })
    await t.mutation(api.lib.handleEmailEvent, {
      event,
      notificationId: "sns-2",
    })
    expect(
      await t.run((ctx) => ctx.db.query("deliveryEvents").collect())
    ).toHaveLength(2)
  })
  it("dispatches the original manual callback, regardless of lastOptions", async () => {
    vi.useFakeTimers()
    const t = setupTest()
    const fnHandle = await t.run(() =>
      createFunctionHandle(makeFunctionReference("regression.test:callbackA"))
    )
    const otherHandle = await t.run(() =>
      createFunctionHandle(makeFunctionReference("regression.test:callbackB"))
    )
    const id = await t.mutation(api.lib.createManualEmail, {
      from: sendArgs.from,
      to: sendArgs.to,
      subject: "Manual",
      onEmailEvent: { fnHandle },
    })
    await t.mutation(api.lib.updateManualEmail, {
      emailId: id,
      status: "sent",
      sesMessageId: "manual",
    })
    await t.run((ctx) =>
      ctx.db.insert("lastOptions", {
        options: { ...options, onEmailEvent: { fnHandle: otherHandle } },
      })
    )
    await t.mutation(api.lib.handleEmailEvent, {
      event: createTestEventOfType("Delivery", {
        mail: { messageId: "manual" },
      }),
      notificationId: "callback",
    })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await getEmail(t, id)).subject).toBe("callback A")
  })
  it("shares recipient reservations between workers", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const t = setupTest()
    expect(
      await t.mutation(internal.lib.reserveSend, { maxSendRate: 1, count: 1 })
    ).toBe(0)
    expect(
      await t.mutation(internal.lib.reserveSend, { maxSendRate: 1, count: 3 })
    ).toBeGreaterThanOrEqual(3000)
    expect(
      await t.mutation(internal.lib.reserveSend, { maxSendRate: 1, count: 1 })
    ).toBeGreaterThanOrEqual(4000)
  })
  it.each([Infinity, NaN, 0, -1])(
    "rejects invalid send rate %s at the component boundary",
    async (maxSendRate) => {
      const t = setupTest()
      await expect(
        t.mutation(api.lib.sendEmail, {
          ...sendArgs,
          options: { ...options, maxSendRate },
        })
      ).rejects.toThrow("maxSendRate")
    }
  )
  it("validates recipients and oversized bodies before enqueue", async () => {
    const t = setupTest()
    await expect(
      t.mutation(api.lib.sendEmail, {
        ...sendArgs,
        to: Array(51).fill(sendArgs.to[0]),
      })
    ).rejects.toThrow("50 recipients")
    await expect(
      t.mutation(api.lib.sendEmail, {
        ...sendArgs,
        text: "x".repeat(128 * 1024),
      })
    ).rejects.toThrow("128 KiB")
    await expect(
      t.mutation(api.lib.sendEmail, { ...sendArgs, to: [], bcc: sendArgs.to })
    ).resolves.toBeTruthy()
    await expect(
      t.mutation(api.lib.sendEmail, {
        ...sendArgs,
        to: ["victim@example.com, Name <success@simulator.amazonses.com>"],
      })
    ).rejects.toThrow()
    await expect(
      t.mutation(api.lib.createManualEmail, {
        from: sendArgs.from,
        to: "real@example.com",
        subject: "x",
      })
    ).rejects.toThrow("Test mode")
  })
  it("cleans large event histories over bounded scheduled passes", async () => {
    vi.useFakeTimers()
    const t = setupTest()
    const email = await insertTestSentEmail(t, {
      status: "delivered",
      finalizedAt: 1,
    })
    await t.run(async (ctx) => {
      for (let i = 0; i < 220; i++)
        await ctx.db.insert("deliveryEvents", {
          emailId: email._id,
          sesMessageId: "many",
          eventType: "Open",
          createdAt: "t",
        })
    })
    await t.mutation(api.lib.cleanupOldEmails, { olderThan: 0 })
    expect(
      await t.run((ctx) => ctx.db.query("deliveryEvents").collect())
    ).toHaveLength(120)
    expect(
      await t.query(api.lib.getStatus, { emailId: email._id })
    ).not.toBeNull()
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await t.query(api.lib.getStatus, { emailId: email._id })).toBeNull()
    expect(
      await t.run((ctx) => ctx.db.query("deliveryEvents").collect())
    ).toEqual([])
  })
})
