import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { S3Client } from "@aws-sdk/client-s3"
import { internal } from "./_generated/api"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { MAX_INBOUND_BYTES } from "./ses/inboundTransfer"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function setup() {
  const f = await fixture()
  await storeTestCredentials(f)
  const body =
    "From: sender@example.com\r\nTo: hello@mail.example.test\r\nSubject: Hello\r\n\r\nMessage"
  const state = {
    getFailures: 0,
    deleteFailures: 0,
    declaredSize: undefined as number | undefined,
    oversizedStream: false,
  }
  const calls: { name: string; input: unknown }[] = []
  vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
    const name = command.constructor.name
    calls.push({ name, input: command.input })
    if (name === "GetObjectCommand") {
      if (state.getFailures-- > 0) throw new Error("S3 temporarily unavailable")
      return {
        ContentLength: state.declaredSize ?? body.length,
        Body: {
          transformToWebStream: () =>
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  state.oversizedStream
                    ? new Uint8Array(MAX_INBOUND_BYTES + 1)
                    : new TextEncoder().encode(body)
                )
                controller.close()
              },
            }),
        },
      } as never
    }
    if (name === "DeleteObjectCommand") {
      const row = await f.t.run((ctx) =>
        ctx.db.query("inboundMessages").first()
      )
      expect(row?.storageId).toBeDefined()
      expect(
        await f.t.run(async (ctx) => !!(await ctx.storage.get(row!.storageId!)))
      ).toBe(true)
      if (state.deleteFailures-- > 0)
        throw new Error("S3 delete temporarily unavailable")
    }
    return {} as never
  })
  await f.t.run(async (ctx) => {
    await ctx.db.patch("domains", f.domain, { receiving: true })
    await ctx.db.insert("inboundRegions", {
      region: "us-east-1",
      operation: "provision",
      phase: "ready",
      generation: 1,
      bucket: "inbound-bucket",
      topicArn: "inbound-topic",
      callbackConfirmed: true,
    })
  })
  const notification = {
    topicArn: "inbound-topic",
    messageId: "sns-1",
    message: JSON.stringify({
      notificationType: "Received",
      mail: { messageId: "ses-1" },
      receipt: {
        recipients: ["hello@mail.example.test"],
        action: {
          type: "S3",
          bucketName: "inbound-bucket",
          objectKey: `${f.domain}/ses-1`,
        },
      },
    }),
  }
  await f.t.mutation(internal.ses.inboundMessages.ingest, notification)
  const read = () =>
    f.t.run(async (ctx) => (await ctx.db.query("inboundMessages").first())!)
  const row = await read()
  const transfer = () =>
    f.t.action(internal.ses.inboundTransfer.transfer, { id: row._id })
  return { ...f, body, state, calls, notification, read, row, transfer }
}

test("downloads with ExpectedBucketOwner, stores MIME, commits its id, then deletes; replay is inert", async () => {
  const f = await setup()
  await f.transfer()
  const row = await f.read()
  expect(row).toMatchObject({
    size: f.body.length,
    storedAt: expect.any(Number),
    deletedFromS3At: expect.any(Number),
  })
  expect(
    await f.t.run(async (ctx) =>
      (await ctx.storage.get(row.storageId!))!.text()
    )
  ).toBe(f.body)
  expect(f.calls).toEqual(
    ["GetObjectCommand", "DeleteObjectCommand"].map((name) => ({
      name,
      input: {
        Bucket: "inbound-bucket",
        Key: `${f.domain}/ses-1`,
        ExpectedBucketOwner: "123456789012",
      },
    }))
  )
  await f.transfer()
  expect(f.calls).toHaveLength(2)
  expect(
    await f.t.mutation(internal.ses.inboundMessages.ingest, f.notification)
  ).toBe(false)
  expect(
    await f.t.mutation(internal.ses.inboundMessages.ingest, {
      ...f.notification,
      messageId: "sns-2",
    })
  ).toBe(false)
  expect(
    await f.t.run((ctx) => ctx.db.query("inboundMessages").take(10))
  ).toHaveLength(1)
})

test("workpool retries a failed download without deleting the object early", async () => {
  const f = await setup()
  f.state.getFailures = 1
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(f.calls.map((c) => c.name)).toEqual([
    "GetObjectCommand",
    "GetObjectCommand",
    "DeleteObjectCommand",
  ])
  expect((await f.read()).storageId).toBeDefined()
  expect((await f.read()).deletedFromS3At).toBeDefined()
})

test("delete failure keeps durable content and retry skips downloading and storing again", async () => {
  const f = await setup()
  f.state.deleteFailures = 1
  await expect(f.transfer()).rejects.toThrow("delete temporarily")
  const before = await f.read()
  expect(before.storageId).toBeDefined()
  expect(before.deletedFromS3At).toBeUndefined()
  await f.transfer()
  expect((await f.read()).storageId).toBe(before.storageId)
  expect(f.calls.map((c) => c.name)).toEqual([
    "GetObjectCommand",
    "DeleteObjectCommand",
    "DeleteObjectCommand",
  ])
})

test("storage failure preserves the S3 object for retry", async () => {
  const f = await setup()
  const action = await import("./ses/inboundTransfer")
  // Exercise the action with the real query/mutation boundaries but failed file IO.
  await f.t.run(async (ctx) => {
    const handler = action.transfer as unknown as {
      _handler: (ctx: unknown, args: unknown) => Promise<null>
    }
    await expect(
      handler._handler(
        {
          ...ctx,
          storage: {
            ...ctx.storage,
            store: async () => {
              throw new Error("Storage unavailable")
            },
          },
        },
        { id: f.row._id }
      )
    ).rejects.toThrow("Storage unavailable")
  })
  expect(f.calls.map((c) => c.name)).toEqual(["GetObjectCommand"])
  expect((await f.read()).storageId).toBeUndefined()
  await f.transfer()
  expect((await f.read()).storageId).toBeDefined()
})

test.each(["header", "stream"])(
  "oversized %s is rejected without buffering unbounded content or deleting early",
  async (source) => {
    const f = await setup()
    if (source === "header") f.state.declaredSize = MAX_INBOUND_BYTES + 1
    else f.state.oversizedStream = true
    await f.transfer()
    expect(await f.read()).toMatchObject({
      rejected: true,
      transferError: "Inbound message exceeds 40 MiB",
    })
    expect((await f.read()).storageId).toBeUndefined()
    expect(f.calls.map((c) => c.name)).toEqual(["GetObjectCommand"])
    await f.transfer()
    expect(f.calls).toHaveLength(1)
  }
)

test("out-of-scope object keys never reach S3", async () => {
  const f = await setup()
  await f.t.run((ctx) =>
    ctx.db.patch("inboundMessages", f.row._id, {
      objectKey: "another-domain/ses-1",
    })
  )
  await expect(f.transfer()).rejects.toThrow("does not belong")
  expect(f.calls).toEqual([])
})

test("exhausted retries expose the failure and operator replay recovers", async () => {
  const f = await setup()
  f.state.getFailures = 12
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(f.calls.filter((c) => c.name === "GetObjectCommand")).toHaveLength(12)
  expect((await f.read()).transferError).toContain("Inbound transfer failed")
  expect((await f.read()).storageId).toBeUndefined()
  await f.t.mutation(internal.ses.inboundMessages.retry, { id: f.row._id })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect((await f.read()).deletedFromS3At).toBeDefined()
  expect((await f.read()).transferError).toBeUndefined()
})

test("ingest requires the recipient's object prefix and the known bucket", async () => {
  const f = await setup()
  const message = JSON.parse(f.notification.message)
  for (const patch of [
    { objectKey: "foreign-domain/ses-2" },
    { bucketName: "foreign-bucket" },
  ]) {
    expect(
      await f.t.mutation(internal.ses.inboundMessages.ingest, {
        ...f.notification,
        messageId: JSON.stringify(patch),
        message: JSON.stringify({
          ...message,
          receipt: {
            ...message.receipt,
            action: { ...message.receipt.action, ...patch },
          },
        }),
      })
    ).toBe(false)
  }
  expect(
    await f.t.run((ctx) => ctx.db.query("inboundMessages").take(10))
  ).toHaveLength(1)
})
