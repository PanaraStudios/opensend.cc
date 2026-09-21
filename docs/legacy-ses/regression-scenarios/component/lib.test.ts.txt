import { beforeEach, describe, expect, it } from "vitest"
import {
  MessageRejected,
  SESv2Client,
  SendBulkEmailCommand,
  SendEmailCommand,
  TooManyRequestsException,
} from "@aws-sdk/client-sesv2"
import { mockClient } from "aws-sdk-client-mock"
import { api, internal } from "./_generated/api.js"
import type { Doc, Id } from "./_generated/dataModel.js"
import {
  batchSizeFor,
  computeEmailUpdateFromEvent,
  normalizeSesEvent,
  paceDelayMs,
} from "./lib.js"
import type { EmailEvent } from "./shared.js"
import {
  createTestEventOfType,
  createTestRuntimeConfig,
  getEmail,
  insertTestSentEmail,
  setupTest,
  setupTestLastOptions,
  TEST_SES_MESSAGE_ID,
  type Tester,
} from "./setup.test.js"

const FINALIZED_EPOCH = Number.MAX_SAFE_INTEGER

describe("handleEmailEvent", () => {
  let t: Tester
  let email: Doc<"emails">

  beforeEach(async () => {
    t = setupTest()
    await setupTestLastOptions(t)
    email = await insertTestSentEmail(t)
  })

  const exec = (event: unknown) =>
    t.mutation(api.lib.handleEmailEvent, { event })

  const deliveryEvents = () =>
    t.run((ctx) =>
      ctx.db
        .query("deliveryEvents")
        .withIndex("by_emailId_eventType", (q) => q.eq("emailId", email._id))
        .collect()
    )

  it("marks the email delivered and records the event", async () => {
    await exec(createTestEventOfType("Delivery"))
    const updated = await getEmail(t, email._id)
    expect(updated.status).toBe("delivered")
    expect(updated.finalizedAt).toBeLessThan(FINALIZED_EPOCH)
    const events = await deliveryEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: "Delivery",
      sesMessageId: TEST_SES_MESSAGE_ID,
      createdAt: "2024-01-01T00:00:12.000Z",
      message: "250 2.6.0 Message received",
    })
  })

  it("marks the email bounced with the diagnostic code", async () => {
    await exec(createTestEventOfType("Bounce"))
    const updated = await getEmail(t, email._id)
    expect(updated.status).toBe("bounced")
    expect(updated.bounced).toBe(true)
    expect(updated.errorMessage).toBe(
      "Permanent/General: smtp; 550 5.1.1 user unknown"
    )
    expect(updated.finalizedAt).toBeLessThan(FINALIZED_EPOCH)
  })

  it("flags complaints without changing status", async () => {
    await exec(createTestEventOfType("Complaint"))
    const updated = await getEmail(t, email._id)
    expect(updated.status).toBe("sent")
    expect(updated.complained).toBe(true)
    expect(updated.finalizedAt).toBeLessThan(FINALIZED_EPOCH)
    expect((await deliveryEvents())[0]?.message).toBe("abuse")
  })

  it("treats Reject and Rendering Failure as failures", async () => {
    await exec(createTestEventOfType("Reject"))
    let updated = await getEmail(t, email._id)
    expect(updated.status).toBe("failed")
    expect(updated.failed).toBe(true)
    expect(updated.errorMessage).toBe("Bad content")

    const other = await insertTestSentEmail(t, { sesMessageId: "other-id" })
    await exec(
      createTestEventOfType("Rendering Failure", {
        mail: { messageId: "other-id" },
      })
    )
    updated = await getEmail(t, other._id)
    expect(updated.status).toBe("failed")
    expect(updated.errorMessage).toBe(
      "MyTemplate: Attribute 'name' is not present in the rendering data."
    )
  })

  it("marks delivery delays and lets a later delivery win", async () => {
    await exec(createTestEventOfType("DeliveryDelay"))
    let updated = await getEmail(t, email._id)
    expect(updated.status).toBe("delivery_delayed")
    expect(updated.deliveryDelayed).toBe(true)
    expect(updated.finalizedAt).toBe(FINALIZED_EPOCH)

    await exec(createTestEventOfType("Delivery"))
    updated = await getEmail(t, email._id)
    expect(updated.status).toBe("delivered")
    expect(updated.deliveryDelayed).toBe(true)
  })

  it("never downgrades a delivered email", async () => {
    await exec(createTestEventOfType("Delivery"))
    await exec(createTestEventOfType("DeliveryDelay"))
    const updated = await getEmail(t, email._id)
    expect(updated.status).toBe("delivered")
    expect(updated.deliveryDelayed).toBe(true)
  })

  it("records opens and clicks once", async () => {
    await exec(createTestEventOfType("Open"))
    await exec(createTestEventOfType("Open"))
    await exec(createTestEventOfType("Click"))
    const updated = await getEmail(t, email._id)
    expect(updated.opened).toBe(true)
    expect(updated.clicked).toBe(true)
    expect(updated.status).toBe("sent")
    expect(await deliveryEvents()).toHaveLength(3)
  })

  it("records Send and Subscription events without changing state", async () => {
    await exec(createTestEventOfType("Send"))
    await exec(createTestEventOfType("Subscription"))
    const updated = await getEmail(t, email._id)
    expect(updated.status).toBe("sent")
    expect(await deliveryEvents()).toHaveLength(2)
  })

  it("accepts feedback notifications that use notificationType", async () => {
    const { eventType, ...rest } = createTestEventOfType("Delivery")
    await exec({ ...rest, notificationType: eventType })
    expect((await getEmail(t, email._id)).status).toBe("delivered")
  })

  it("keeps cancelled emails cancelled", async () => {
    const cancelled = await insertTestSentEmail(t, {
      status: "cancelled",
      sesMessageId: "cancelled-id",
      finalizedAt: 1,
    })
    await exec(
      createTestEventOfType("Delivery", { mail: { messageId: "cancelled-id" } })
    )
    expect((await getEmail(t, cancelled._id)).status).toBe("cancelled")
  })

  it("ignores events for unknown message ids", async () => {
    await exec(
      createTestEventOfType("Delivery", { mail: { messageId: "unknown" } })
    )
    expect((await getEmail(t, email._id)).status).toBe("sent")
    expect(await deliveryEvents()).toHaveLength(0)
  })

  it.each([
    [
      "unknown type",
      { eventType: "Nope", mail: { messageId: "x", timestamp: "t" } },
    ],
    ["missing mail", { eventType: "Delivery" }],
    ["string", "not an object"],
    ["null", null],
    ["empty object", {}],
  ])("gracefully ignores invalid events (%s)", async (_label, invalid) => {
    await exec(invalid)
    const updated = await getEmail(t, email._id)
    expect(updated.status).toBe("sent")
    expect(updated.finalizedAt).toBe(FINALIZED_EPOCH)
  })
})

describe("computeEmailUpdateFromEvent", () => {
  const base: Doc<"emails"> = {
    _id: "emails:1" as Id<"emails">,
    _creationTime: 0,
    from: "a@example.com",
    to: ["b@example.com"],
    replyTo: [],
    status: "sent",
    bounced: false,
    complained: false,
    failed: false,
    deliveryDelayed: false,
    opened: false,
    clicked: false,
    segment: 0,
    finalizedAt: FINALIZED_EPOCH,
  }

  it("returns null when nothing changes", () => {
    expect(
      computeEmailUpdateFromEvent(base, createTestEventOfType("Send"))
    ).toBeNull()
    expect(
      computeEmailUpdateFromEvent(
        { ...base, opened: true },
        createTestEventOfType("Open")
      )
    ).toBeNull()
    expect(
      computeEmailUpdateFromEvent(
        { ...base, status: "bounced", bounced: true, finalizedAt: 5 },
        createTestEventOfType("Bounce")
      )
    ).toBeNull()
  })

  it("normalizes notificationType payloads", () => {
    expect(normalizeSesEvent({ notificationType: "Bounce" })).toEqual({
      notificationType: "Bounce",
      eventType: "Bounce",
    })
    expect(normalizeSesEvent({ eventType: "Send" })).toEqual({
      eventType: "Send",
    })
    expect(normalizeSesEvent("x")).toBe("x")
  })
})

describe("sendEmail", () => {
  let t: Tester
  const options = createTestRuntimeConfig()

  beforeEach(() => {
    t = setupTest()
  })

  const send = (
    overrides: Partial<
      Parameters<typeof t.mutation<typeof api.lib.sendEmail>>[1]
    >
  ) =>
    t.mutation(api.lib.sendEmail, {
      options,
      from: "sender@example.com",
      to: ["success@simulator.amazonses.com"],
      subject: "Test",
      html: "<p>Test</p>",
      ...overrides,
    })

  it("stores the email, its bodies, and schedules exactly one batch worker", async () => {
    const id = await send({ text: "Test", replyTo: ["reply@example.com"] })
    const email = await getEmail(t, id)
    expect(email.status).toBe("waiting")
    expect(email.replyTo).toEqual(["reply@example.com"])
    expect(email.finalizedAt).toBe(FINALIZED_EPOCH)

    const full = await t.query(api.lib.get, { emailId: id })
    expect(full?.html).toBe("<p>Test</p>")
    expect(full?.text).toBe("Test")
    expect(full?.createdAt).toBe(email._creationTime)

    await send({})
    const [runs, lastOptions] = await t.run(async (ctx) => [
      await ctx.db.query("nextBatchRun").collect(),
      await ctx.db.query("lastOptions").collect(),
    ])
    expect(runs).toHaveLength(1)
    expect(lastOptions).toHaveLength(1)
    expect(lastOptions[0]?.options).toEqual(options)
  })

  it("applies the default configuration set and allows a per-email override", async () => {
    const withDefault = await send({
      options: { ...options, configurationSetName: "Default" },
    })
    expect((await getEmail(t, withDefault)).configurationSetName).toBe(
      "Default"
    )
    const overridden = await send({
      options: { ...options, configurationSetName: "Default" },
      configurationSetName: "Marketing",
    })
    expect((await getEmail(t, overridden)).configurationSetName).toBe(
      "Marketing"
    )
  })

  it("rejects non-simulator recipients in test mode", async () => {
    await expect(send({ to: ["user@example.com"] })).rejects.toThrow(
      "Test mode is enabled"
    )
    await expect(send({ bcc: ["user@example.com"] })).rejects.toThrow(
      "Test mode is enabled"
    )
    await expect(
      send({ to: ["bounce+order-1@simulator.amazonses.com"] })
    ).resolves.toBeTruthy()
  })

  it("allows any recipient when test mode is off", async () => {
    await expect(
      send({
        options: { ...options, testMode: false },
        to: ["user@example.com"],
      })
    ).resolves.toBeTruthy()
  })

  it("validates content rules", async () => {
    await expect(send({ html: undefined })).rejects.toThrow(
      "Either html/text or template must be provided"
    )
    await expect(send({ subject: undefined })).rejects.toThrow(
      "Subject is required when not using a template"
    )
    await expect(send({ template: { name: "Welcome" } })).rejects.toThrow(
      "Cannot provide both html/text and template"
    )
    await expect(send({ to: [] })).rejects.toThrow("At least one recipient")
  })

  it("accepts templated emails with exactly one template identity", async () => {
    const id = await send({
      subject: undefined,
      html: undefined,
      template: { name: "Welcome", data: { name: "Ada", count: 2 } },
    })
    const email = await getEmail(t, id)
    expect(email.template).toEqual({
      name: "Welcome",
      data: { name: "Ada", count: 2 },
    })
    expect(email.html).toBeUndefined()

    await expect(
      send({
        subject: undefined,
        html: undefined,
        template: {
          name: "Welcome",
          arn: "arn:aws:ses:us-east-1:1:template/x",
        },
      })
    ).rejects.toThrow("exactly one of name, arn, or content")
    await expect(
      send({ subject: undefined, html: undefined, template: { data: {} } })
    ).rejects.toThrow("exactly one of name, arn, or content")
  })

  it("dedupes on idempotencyKey", async () => {
    const first = await send({ idempotencyKey: "order:1" })
    const second = await send({ idempotencyKey: "order:1" })
    const third = await send({ idempotencyKey: "order:2" })
    const noKeyA = await send({})
    const noKeyB = await send({})
    expect(second).toBe(first)
    expect(third).not.toBe(first)
    expect(noKeyB).not.toBe(noKeyA)
    expect((await getEmail(t, first)).idempotencyKey).toBe("order:1")
    const all = await t.run((ctx) => ctx.db.query("emails").collect())
    expect(all).toHaveLength(4)
  })
})

describe("manual emails, cancellation, and status", () => {
  let t: Tester
  beforeEach(() => {
    t = setupTest()
  })

  it("tracks a manually sent email", async () => {
    const id = await t.mutation(api.lib.createManualEmail, {
      from: "sender@example.com",
      to: "success@simulator.amazonses.com",
      cc: "cc@example.com",
      bcc: ["bcc@example.com"],
      subject: "Manual",
      testMode: false,
    })
    let email = await getEmail(t, id)
    expect(email).toMatchObject({
      status: "queued",
      to: ["success@simulator.amazonses.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    })

    await t.mutation(api.lib.updateManualEmail, {
      emailId: id,
      status: "sent",
      sesMessageId: "ses-manual",
    })
    email = await getEmail(t, id)
    expect(email.status).toBe("sent")
    expect(email.sesMessageId).toBe("ses-manual")

    await t.mutation(api.lib.updateManualEmail, {
      emailId: id,
      status: "failed",
      errorMessage: "boom",
    })
    email = await getEmail(t, id)
    expect(email.status).toBe("sent")
    expect(email.sesMessageId).toBe("ses-manual")
  })

  it("cancels only unsent emails", async () => {
    const waiting = await insertTestSentEmail(t, { status: "waiting" })
    await t.mutation(api.lib.cancelEmail, { emailId: waiting._id })
    expect((await getEmail(t, waiting._id)).status).toBe("cancelled")

    const sent = await insertTestSentEmail(t)
    await expect(
      t.mutation(api.lib.cancelEmail, { emailId: sent._id })
    ).rejects.toThrow("already been sent")
  })

  it("reports status", async () => {
    const email = await insertTestSentEmail(t, { opened: true })
    expect(await t.query(api.lib.getStatus, { emailId: email._id })).toEqual({
      status: "sent",
      errorMessage: null,
      sesMessageId: TEST_SES_MESSAGE_ID,
      bounced: false,
      complained: false,
      failed: false,
      deliveryDelayed: false,
      opened: true,
      clicked: false,
    })
  })
})

describe("sendBatch", () => {
  const sesMock = mockClient(SESv2Client)
  let t: Tester
  const config = {
    region: "us-east-1",
    credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
    maxSendRate: 1000,
  }

  beforeEach(() => {
    sesMock.reset()
    t = setupTest()
  })

  const queued = (overrides?: Partial<Doc<"emails">>) =>
    insertTestSentEmail(t, {
      status: "queued",
      sesMessageId: undefined,
      to: ["success@simulator.amazonses.com"],
      ...overrides,
    })

  it("sends queued emails and records SES message ids", async () => {
    sesMock
      .on(SendEmailCommand)
      .resolvesOnce({ MessageId: "ses-1" })
      .resolvesOnce({ MessageId: "ses-2" })
    const a = await queued()
    const b = await queued()
    const cancelled = await queued({ status: "cancelled" })

    await t.action(internal.lib.sendBatch, {
      config,
      emailIds: [a._id, b._id, cancelled._id],
    })

    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2)
    expect((await getEmail(t, a._id)).sesMessageId).toBe("ses-1")
    expect((await getEmail(t, b._id)).sesMessageId).toBe("ses-2")
    expect((await getEmail(t, a._id)).status).toBe("sent")
    expect((await getEmail(t, cancelled._id)).status).toBe("cancelled")
  })

  it("groups templated emails into one SendBulkEmail call", async () => {
    sesMock.on(SendBulkEmailCommand).resolves({
      BulkEmailEntryResults: [
        { Status: "SUCCESS", MessageId: "bulk-1" },
        { Status: "SUCCESS", MessageId: "bulk-2" },
      ],
    })
    const template = { name: "Welcome", data: { n: 1 } }
    const a = await queued({ template, subject: undefined })
    const b = await queued({
      template: { ...template, data: { n: 2 } },
      subject: undefined,
    })

    await t.action(internal.lib.sendBatch, { config, emailIds: [a._id, b._id] })

    expect(sesMock.commandCalls(SendBulkEmailCommand)).toHaveLength(1)
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0)
    expect((await getEmail(t, a._id)).sesMessageId).toBe("bulk-1")
    expect((await getEmail(t, b._id)).sesMessageId).toBe("bulk-2")
  })

  it("marks permanent failures failed and keeps going", async () => {
    sesMock
      .on(SendEmailCommand)
      .rejectsOnce(
        new MessageRejected({
          message: "Email address is not verified.",
          $metadata: {},
        })
      )
      .resolvesOnce({ MessageId: "ses-2" })
    const a = await queued()
    const b = await queued()

    await t.action(internal.lib.sendBatch, { config, emailIds: [a._id, b._id] })

    const failed = await getEmail(t, a._id)
    expect(failed.status).toBe("failed")
    expect(failed.failed).toBe(true)
    expect(failed.errorMessage).toContain("not verified")
    expect(failed.finalizedAt).toBeLessThan(FINALIZED_EPOCH)
    expect((await getEmail(t, b._id)).status).toBe("sent")
  })

  it("throws on transient failures so the workpool retries, without re-sending", async () => {
    sesMock
      .on(SendEmailCommand)
      .resolvesOnce({ MessageId: "ses-1" })
      .rejectsOnce(
        new TooManyRequestsException({
          message: "Rate exceeded",
          $metadata: {},
        })
      )
    const a = await queued()
    const b = await queued()

    await expect(
      t.action(internal.lib.sendBatch, { config, emailIds: [a._id, b._id] })
    ).rejects.toThrow("Rate exceeded")
    expect((await getEmail(t, a._id)).status).toBe("sent")
    expect((await getEmail(t, b._id)).status).toBe("queued")

    // The retry only touches the email SES has not accepted yet.
    sesMock.reset()
    sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-2" })
    await t.action(internal.lib.sendBatch, { config, emailIds: [a._id, b._id] })
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1)
    expect((await getEmail(t, a._id)).sesMessageId).toBe("ses-1")
    expect((await getEmail(t, b._id)).sesMessageId).toBe("ses-2")
  })

  it("passes stored bodies to SES", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-1" })
    const id = await t.mutation(api.lib.sendEmail, {
      options: createTestRuntimeConfig(),
      from: "sender@example.com",
      to: ["success@simulator.amazonses.com"],
      subject: "Body test",
      html: "<p>Hello</p>",
      text: "Hello",
    })
    await t.run((ctx) => ctx.db.patch("emails", id, { status: "queued" }))

    await t.action(internal.lib.sendBatch, { config, emailIds: [id] })

    const input = sesMock.commandCalls(SendEmailCommand)[0]?.args[0].input
    expect(input?.Content?.Simple?.Subject?.Data).toBe("Body test")
    expect(input?.Content?.Simple?.Body?.Html?.Data).toBe("<p>Hello</p>")
    expect(input?.Content?.Simple?.Body?.Text?.Data).toBe("Hello")
  })
})

describe("batch sizing and pacing", () => {
  it("scales the batch to the send rate within bounds", () => {
    expect(batchSizeFor(1)).toBe(5)
    expect(batchSizeFor(14)).toBe(70)
    expect(batchSizeFor(50)).toBe(100)
    expect(batchSizeFor(0.1)).toBe(1)
  })

  it("computes the pause needed to honor the send rate", () => {
    expect(paceDelayMs(1, 1)).toBe(1000)
    expect(paceDelayMs(3, 10)).toBe(300)
  })
})

describe("cleanup", () => {
  it("removes finalized emails with their bodies and events", async () => {
    const t = setupTest()
    const finalized = await t.run(async (ctx) => {
      const html = await ctx.db.insert("content", {
        content: new TextEncoder().encode("<p>x</p>").buffer as ArrayBuffer,
        mimeType: "text/html",
      })
      const id = await ctx.db.insert("emails", {
        from: "a@example.com",
        to: ["b@example.com"],
        replyTo: [],
        html,
        status: "delivered",
        bounced: false,
        complained: false,
        failed: false,
        deliveryDelayed: false,
        opened: false,
        clicked: false,
        segment: 0,
        finalizedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
      })
      await ctx.db.insert("deliveryEvents", {
        emailId: id,
        sesMessageId: "x",
        eventType: "Delivery",
        createdAt: "t",
      })
      return id
    })
    const recent = await insertTestSentEmail(t, { finalizedAt: Date.now() })

    await t.mutation(api.lib.cleanupOldEmails, {})

    const [emails, content, events] = await t.run(async (ctx) => [
      await ctx.db.query("emails").collect(),
      await ctx.db.query("content").collect(),
      await ctx.db.query("deliveryEvents").collect(),
    ])
    expect(emails.map((e) => e._id)).toEqual([recent._id])
    expect(content).toHaveLength(0)
    expect(events).toHaveLength(0)
    expect(finalized).toBeTruthy()
  })

  it("removes abandoned emails regardless of status", async () => {
    const t = setupTest()
    await insertTestSentEmail(t, { status: "waiting" })
    await new Promise((resolve) => setTimeout(resolve, 2))
    await t.mutation(api.lib.cleanupAbandonedEmails, { olderThan: 0 })
    expect(await t.run((ctx) => ctx.db.query("emails").collect())).toHaveLength(
      0
    )
  })
})

// Type-level check: every event type round-trips through the validator union.
const _typeCheck: EmailEvent = createTestEventOfType("Click")
void _typeCheck
