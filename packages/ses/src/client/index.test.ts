import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { convexTest } from "convex-test"
import { defineSchema } from "convex/server"
import { SES, type EmailId } from "./index.js"
import { register } from "../test.js"
import { components, modules } from "./setup.test.js"
import {
  fetchTestCertificate,
  SIGNED_NOTIFICATION_V2,
  SIGNED_SUBSCRIPTION_CONFIRMATION,
  TEST_TOPIC_ARN,
} from "./sns.test.js"

const schema = defineSchema({})

function setupTest() {
  const t = convexTest(schema, modules)
  register(t)
  return t
}
type ConvexTest = ReturnType<typeof setupTest>

const baseOptions = {
  region: "us-east-1",
  credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
  snsTopicArn: TEST_TOPIC_ARN,
  fetchCertificate: fetchTestCertificate,
}

const createSes = (overrides?: Partial<ConstructorParameters<typeof SES>[1]>) =>
  new SES(components.ses, { ...baseOptions, ...overrides })

/** Run `fn` inside a mutation so it has a `runMutation`/`runQuery` ctx. */
const inMutation = <T>(
  t: ConvexTest,
  fn: (ctx: Parameters<Parameters<typeof t.run>[0]>[0]) => Promise<T>
) => t.run(fn)

describe("SES constructor", () => {
  const savedEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...savedEnv }
  })

  it("defaults to test mode, the sandbox send rate, and env credentials", () => {
    process.env.AWS_REGION = "eu-west-1"
    process.env.AWS_ACCESS_KEY_ID = "env-key"
    process.env.AWS_SECRET_ACCESS_KEY = "env-secret"
    process.env.AWS_SES_SNS_TOPIC_ARN = "arn:a, arn:b"
    process.env.AWS_SES_CONFIGURATION_SET = "EnvSet"
    const ses = new SES(components.ses)
    expect(ses.config).toMatchObject({
      region: "eu-west-1",
      credentials: { accessKeyId: "env-key", secretAccessKey: "env-secret" },
      snsTopicArns: ["arn:a", "arn:b"],
      configurationSetName: "EnvSet",
      maxSendRate: 1,
      initialBackoffMs: 30_000,
      retryAttempts: 5,
      testMode: true,
    })
  })

  it("lets options override the environment", () => {
    const ses = createSes({
      maxSendRate: 14,
      testMode: false,
      retryAttempts: 2,
    })
    expect(ses.config.maxSendRate).toBe(14)
    expect(ses.config.testMode).toBe(false)
    expect(ses.config.retryAttempts).toBe(2)
    expect(ses.config.snsTopicArns).toEqual([TEST_TOPIC_ARN])
  })

  it("fails fast on invalid tuning options", () => {
    expect(() => createSes({ maxSendRate: 0 })).toThrow("maxSendRate")
    expect(() => createSes({ retryAttempts: 0 })).toThrow("retryAttempts")
    expect(() => createSes({ initialBackoffMs: -1 })).toThrow(
      "initialBackoffMs"
    )
    expect(() => createSes({ maxSendRate: Infinity })).toThrow("maxSendRate")
    expect(() => createSes({ retryAttempts: 1.5 })).toThrow("retryAttempts")
    expect(() => createSes({ initialBackoffMs: NaN })).toThrow(
      "initialBackoffMs"
    )
  })
})

describe("SES.sendEmail", () => {
  let t: ConvexTest
  beforeEach(() => {
    t = setupTest()
  })

  it("normalizes recipients and enqueues through the component", async () => {
    const ses = createSes()
    const id = await inMutation(t, (ctx) =>
      ses.sendEmail(ctx, {
        from: "Me <me@example.com>",
        to: "success@simulator.amazonses.com",
        cc: "complaint@simulator.amazonses.com",
        replyTo: "reply@example.com",
        subject: "Hi there",
        html: "<p>Hello</p>",
        tags: [{ name: "campaign", value: "test" }],
      })
    )
    const email = await inMutation(t, (ctx) => ses.get(ctx, id))
    expect(email).toMatchObject({
      from: "Me <me@example.com>",
      to: ["success@simulator.amazonses.com"],
      cc: ["complaint@simulator.amazonses.com"],
      replyTo: ["reply@example.com"],
      subject: "Hi there",
      html: "<p>Hello</p>",
      tags: [{ name: "campaign", value: "test" }],
      status: "waiting",
    })
    const status = await inMutation(t, (ctx) => ses.status(ctx, id))
    expect(status?.status).toBe("waiting")
  })

  it("does not let extra message properties override trusted runtime options", async () => {
    const t = setupTest()
    const ses = createSes()
    const input = {
      from: "me@example.com",
      to: "real@example.com",
      subject: "Must reject",
      text: "x",
      options: { ...ses.config, testMode: false },
    }
    await expect(
      inMutation(t, (ctx) => ses.sendEmail(ctx, input))
    ).rejects.toThrow("Test mode")
  })
  it("accepts Resend-style template id and variables", async () => {
    const t = setupTest()
    const ses = createSes()
    const id = await inMutation(t, (ctx) =>
      ses.sendEmail(ctx, {
        from: "me@example.com",
        to: "success@simulator.amazonses.com",
        subject: "Optional template subject",
        template: { id: "Welcome", variables: { name: "Ada" } },
      })
    )
    expect((await inMutation(t, (ctx) => ses.get(ctx, id)))?.template).toEqual({
      name: "Welcome",
      data: { name: "Ada" },
    })
  })
  it("supports the deprecated positional signature", async () => {
    const ses = createSes()
    const id = await inMutation(t, (ctx) =>
      ses.sendEmail(
        ctx,
        "me@example.com",
        "success@simulator.amazonses.com",
        "Subject",
        "<p>html</p>",
        "text"
      )
    )
    const email = await inMutation(t, (ctx) => ses.get(ctx, id))
    expect(email?.subject).toBe("Subject")
    expect(email?.text).toBe("text")
  })

  it("returns the existing id for a duplicate idempotencyKey", async () => {
    const ses = createSes()
    const send = () =>
      inMutation(t, (ctx) =>
        ses.sendEmail(ctx, {
          from: "me@example.com",
          to: "success@simulator.amazonses.com",
          subject: "Once",
          text: "once",
          idempotencyKey: "order:42",
        })
      )
    expect(await send()).toBe(await send())
  })

  it("refuses to send without credentials or region", async () => {
    const ses = createSes({
      credentials: { accessKeyId: "", secretAccessKey: "" },
    })
    await expect(
      inMutation(t, (ctx) =>
        ses.sendEmail(ctx, {
          from: "me@example.com",
          to: "success@simulator.amazonses.com",
          subject: "x",
          text: "x",
        })
      )
    ).rejects.toThrow("AWS credentials are not set")
    const noRegion = createSes({ region: "" })
    await expect(
      inMutation(t, (ctx) =>
        noRegion.sendEmail(ctx, {
          from: "me@example.com",
          to: "success@simulator.amazonses.com",
          subject: "x",
          text: "x",
        })
      )
    ).rejects.toThrow("AWS region is not set")
  })

  it("cancels waiting emails", async () => {
    const ses = createSes()
    const id = await inMutation(t, (ctx) =>
      ses.sendEmail(ctx, {
        from: "me@example.com",
        to: "success@simulator.amazonses.com",
        subject: "x",
        text: "x",
      })
    )
    await inMutation(t, (ctx) => ses.cancelEmail(ctx, id))
    expect((await inMutation(t, (ctx) => ses.status(ctx, id)))?.status).toBe(
      "cancelled"
    )
  })
})

describe("SES.sendEmailManually", () => {
  it("rejects non-simulator destinations before invoking the callback", async () => {
    const t = setupTest()
    const callback = vi.fn(async () => "should-not-send")
    await expect(
      inMutation(t, (ctx) =>
        createSes().sendEmailManually(
          ctx,
          {
            from: "me@example.com",
            to: "real@example.com",
            subject: "x",
          },
          callback
        )
      )
    ).rejects.toThrow("Test mode")
    expect(callback).not.toHaveBeenCalled()
  })
  it("records the SES message id on success and the error on failure", async () => {
    const t = setupTest()
    const ses = createSes({ configurationSetName: "Default" })
    const options = {
      from: "me@example.com",
      to: "success@simulator.amazonses.com",
      subject: "Manual",
    }

    let seen: EmailId | undefined
    const ok = await inMutation(t, (ctx) =>
      ses.sendEmailManually(ctx, options, async (emailId) => {
        seen = emailId
        return "ses-manual-1"
      })
    )
    expect(seen).toBe(ok)
    const sent = await inMutation(t, (ctx) => ses.get(ctx, ok))
    expect(sent?.status).toBe("sent")
    expect(sent?.sesMessageId).toBe("ses-manual-1")
    expect(sent?.configurationSetName).toBe("Default")

    // `sendEmailManually` is meant for actions (network I/O). `t.run` is a
    // single transaction, so observe the failure write before the callback's
    // error would roll it back.
    const failed = await inMutation(t, async (ctx) => {
      let failedId: EmailId | undefined
      try {
        await ses.sendEmailManually(ctx, options, async (emailId) => {
          failedId = emailId
          throw new Error("SMTP exploded")
        })
      } catch (error) {
        return {
          error: (error as Error).message,
          status: await ses.status(ctx, failedId!),
        }
      }
      throw new Error("expected sendEmailManually to rethrow")
    })
    expect(failed.error).toBe("SMTP exploded")
    expect(failed.status?.status).toBe("failed")
    expect(failed.status?.errorMessage).toBe("SMTP exploded")
  })
})

describe("SES.handleSesEventWebhook", () => {
  let t: ConvexTest
  const fetchSpy = vi.fn<typeof fetch>()

  beforeEach(() => {
    t = setupTest()
    fetchSpy.mockReset()
    vi.stubGlobal("fetch", fetchSpy)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const post = (body: unknown) =>
    new Request("https://example.convex.site/ses-webhook", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })

  /** Run the webhook inside a Convex ctx and return only the HTTP status. */
  const webhookStatus = (ses: SES, body: unknown) =>
    t.action(async (ctx) => {
      const response = await ses.handleSesEventWebhook(ctx, post(body))
      return response.status
    })

  it("requires an SNS topic ARN", async () => {
    const ses = createSes({ snsTopicArn: [] })
    await expect(webhookStatus(ses, SIGNED_NOTIFICATION_V2)).rejects.toThrow(
      "SNS topic ARN is not set"
    )
  })

  it("confirms subscriptions by visiting the SubscribeURL", async () => {
    fetchSpy.mockResolvedValue(new Response("ok", { status: 200 }))
    const ses = createSes()
    expect(await webhookStatus(ses, SIGNED_SUBSCRIPTION_CONFIRMATION)).toBe(200)
    expect(fetchSpy).toHaveBeenCalledWith(
      SIGNED_SUBSCRIPTION_CONFIRMATION.SubscribeURL,
      expect.objectContaining({ redirect: "error" })
    )
  })

  it("rejects messages from unexpected topics before doing anything", async () => {
    const ses = createSes({
      snsTopicArn: "arn:aws:sns:us-east-1:123456789012:other",
    })
    expect(await webhookStatus(ses, SIGNED_SUBSCRIPTION_CONFIRMATION)).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects tampered notifications and malformed bodies", async () => {
    const ses = createSes()
    expect(
      await webhookStatus(ses, {
        ...SIGNED_NOTIFICATION_V2,
        Message: '{"eventType":"Bounce"}',
      })
    ).toBe(400)
    expect(await webhookStatus(ses, "{not json")).toBe(400)
  })

  it("applies a verified notification to the tracked email", async () => {
    const ses = createSes()
    // The real RSA-signed fixture contains a complete SES delivery event.
    const id = await inMutation(t, (ctx) =>
      ses.sendEmailManually(
        ctx,
        {
          from: "me@example.com",
          to: "success@simulator.amazonses.com",
          subject: "x",
        },
        async () =>
          "0100018e8f7b1c2d-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d-000000"
      )
    )
    expect(await webhookStatus(ses, SIGNED_NOTIFICATION_V2)).toBe(200)
    expect((await inMutation(t, (ctx) => ses.status(ctx, id)))?.status).toBe(
      "delivered"
    )

    // SNS redelivery is acknowledged without duplicate processing.
    expect(await webhookStatus(ses, SIGNED_NOTIFICATION_V2)).toBe(200)
  })

  it("returns 503 for a valid notification before the send response is recorded", async () => {
    expect(await webhookStatus(createSes(), SIGNED_NOTIFICATION_V2)).toBe(503)
  })

  it("rejects oversized bodies and invalid signatures with 400", async () => {
    expect(await webhookStatus(createSes(), "x".repeat(1024 * 1024 + 1))).toBe(
      400
    )
    expect(
      await webhookStatus(createSes(), {
        ...SIGNED_NOTIFICATION_V2,
        Signature: "%%%",
      })
    ).toBe(400)
  })
})
