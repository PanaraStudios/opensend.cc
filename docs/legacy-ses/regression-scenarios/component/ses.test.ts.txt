import { describe, expect, it } from "vitest"
import {
  BadRequestException,
  BulkEmailStatus,
  MessageRejected,
  SESv2Client,
  SendBulkEmailCommand,
  SendEmailCommand,
  TooManyRequestsException,
} from "@aws-sdk/client-sesv2"
import { mockClient } from "aws-sdk-client-mock"
import {
  buildSendBulkEmailInput,
  buildSendEmailInput,
  classifyBulkStatus,
  classifySesError,
  MAX_BULK_ENTRIES,
  planSendUnits,
  sendUnit,
  TransientSendError,
  unitRecipientCount,
  type OutboundEmail,
} from "./ses.js"

const simple = (id: string, extra?: Partial<OutboundEmail>): OutboundEmail => ({
  id,
  from: "Sender <sender@example.com>",
  to: ["success@simulator.amazonses.com"],
  subject: "Hello",
  replyTo: [],
  html: "<p>Hi</p>",
  text: "Hi",
  ...extra,
})

const templated = (
  id: string,
  extra?: Partial<OutboundEmail>
): OutboundEmail => ({
  id,
  from: "sender@example.com",
  to: [`success+${id}@simulator.amazonses.com`],
  replyTo: ["reply@example.com"],
  template: { name: "Welcome", data: { name: id } },
  configurationSetName: "ConfigSet",
  ...extra,
})

describe("buildSendEmailInput", () => {
  it("maps a simple email onto SESv2 SendEmail", () => {
    const input = buildSendEmailInput(
      simple("a", {
        cc: ["cc@example.com"],
        replyTo: ["reply@example.com"],
        headers: [{ name: "X-Custom", value: "1" }],
        tags: [{ name: "campaign", value: "welcome" }],
        configurationSetName: "ConfigSet",
      })
    )
    expect(input).toEqual({
      FromEmailAddress: "Sender <sender@example.com>",
      Destination: {
        ToAddresses: ["success@simulator.amazonses.com"],
        CcAddresses: ["cc@example.com"],
        BccAddresses: undefined,
      },
      ReplyToAddresses: ["reply@example.com"],
      Content: {
        Simple: {
          Subject: { Data: "Hello", Charset: "UTF-8" },
          Body: {
            Html: { Data: "<p>Hi</p>", Charset: "UTF-8" },
            Text: { Data: "Hi", Charset: "UTF-8" },
          },
          Headers: [{ Name: "X-Custom", Value: "1" }],
        },
      },
      EmailTags: [
        { Name: "convex-email-id", Value: "a" },
        { Name: "campaign", Value: "welcome" },
      ],
      ConfigurationSetName: "ConfigSet",
    })
  })

  it("omits empty reply-to lists and absent bodies", () => {
    const input = buildSendEmailInput(simple("a", { text: undefined }))
    expect(input.ReplyToAddresses).toBeUndefined()
    expect(input.Content?.Simple?.Body?.Text).toBeUndefined()
    expect(input.Content?.Simple?.Headers).toBeUndefined()
  })

  it("maps templated emails with serialized TemplateData", () => {
    const input = buildSendEmailInput(
      templated("a", { headers: [{ name: "X-Custom", value: "1" }] })
    )
    expect(input.Content).toEqual({
      Template: {
        TemplateName: "Welcome",
        TemplateArn: undefined,
        TemplateContent: undefined,
        TemplateData: '{"name":"a"}',
        Headers: [{ Name: "X-Custom", Value: "1" }],
      },
    })
  })

  it("supports inline template content", () => {
    const input = buildSendEmailInput(
      templated("a", {
        template: {
          content: { subject: "Hi {{name}}", html: "<p>{{name}}</p>" },
          data: { name: "Ada" },
        },
      })
    )
    expect(input.Content?.Template?.TemplateContent).toEqual({
      Subject: "Hi {{name}}",
      Html: "<p>{{name}}</p>",
      Text: undefined,
    })
  })
})

describe("planSendUnits", () => {
  it("sends simple emails individually and groups compatible templated emails", () => {
    const units = planSendUnits([
      simple("s1"),
      templated("t1"),
      templated("t2"),
      templated("t3", { from: "other@example.com" }),
      simple("s2"),
    ])
    expect(units.map((u) => u.kind)).toEqual([
      "single",
      "single",
      "bulk",
      "single",
    ])
    const bulk = units.find((u) => u.kind === "bulk")
    expect(bulk?.kind === "bulk" && bulk.emails.map((e) => e.id)).toEqual([
      "t1",
      "t2",
    ])
  })

  it("splits large template groups at the SES bulk limit", () => {
    const emails = Array.from({ length: MAX_BULK_ENTRIES + 1 }, (_, i) =>
      templated(`t${i}`)
    )
    const units = planSendUnits(emails)
    expect(units).toHaveLength(2)
    expect(units[0]?.kind).toBe("bulk")
    // The single leftover is sent with SendEmail.
    expect(units[1]?.kind).toBe("single")
  })

  it("counts recipients across to/cc/bcc", () => {
    expect(
      unitRecipientCount({
        kind: "single",
        email: simple("a", { cc: ["c@example.com"], bcc: ["b@example.com"] }),
      })
    ).toBe(3)
  })
})

describe("buildSendBulkEmailInput", () => {
  it("shares template identity and applies per-entry replacements", () => {
    const input = buildSendBulkEmailInput([
      templated("t1", { tags: [{ name: "k", value: "v" }] }),
      templated("t2", { cc: ["cc@example.com"] }),
    ])
    expect(input.FromEmailAddress).toBe("sender@example.com")
    expect(input.ReplyToAddresses).toEqual(["reply@example.com"])
    expect(input.ConfigurationSetName).toBe("ConfigSet")
    expect(input.DefaultContent?.Template?.TemplateName).toBe("Welcome")
    expect(input.DefaultContent?.Template?.TemplateData).toBe("{}")
    expect(input.BulkEmailEntries).toHaveLength(2)
    expect(input.BulkEmailEntries?.[0]).toEqual({
      Destination: {
        ToAddresses: ["success+t1@simulator.amazonses.com"],
        CcAddresses: undefined,
        BccAddresses: undefined,
      },
      ReplacementEmailContent: {
        ReplacementTemplate: { ReplacementTemplateData: '{"name":"t1"}' },
      },
      ReplacementHeaders: undefined,
      ReplacementTags: [
        { Name: "convex-email-id", Value: "t1" },
        { Name: "k", Value: "v" },
      ],
    })
    expect(input.BulkEmailEntries?.[1]?.Destination?.CcAddresses).toEqual([
      "cc@example.com",
    ])
  })

  it("rejects non-templated or oversized groups", () => {
    expect(() => buildSendBulkEmailInput([simple("a")])).toThrow()
    expect(() =>
      buildSendBulkEmailInput(
        Array.from({ length: MAX_BULK_ENTRIES + 1 }, (_, i) =>
          templated(`t${i}`)
        )
      )
    ).toThrow()
  })
})

describe("error classification", () => {
  const meta = { $metadata: {} }
  it("treats rejections and bad requests as permanent", () => {
    expect(
      classifySesError(new MessageRejected({ message: "rejected", ...meta }))
    ).toBe("permanent")
    expect(
      classifySesError(new BadRequestException({ message: "bad", ...meta }))
    ).toBe("permanent")
  })

  it("treats throttling and unknown errors as transient", () => {
    expect(
      classifySesError(
        new TooManyRequestsException({ message: "slow", ...meta })
      )
    ).toBe("transient")
    expect(classifySesError(new TypeError("fetch failed"))).toBe("transient")
  })

  it("classifies bulk entry statuses", () => {
    expect(classifyBulkStatus(BulkEmailStatus.SUCCESS)).toBe("success")
    expect(classifyBulkStatus(BulkEmailStatus.ACCOUNT_THROTTLED)).toBe(
      "transient"
    )
    expect(classifyBulkStatus(BulkEmailStatus.TRANSIENT_FAILURE)).toBe(
      "transient"
    )
    expect(classifyBulkStatus(BulkEmailStatus.MESSAGE_REJECTED)).toBe(
      "permanent"
    )
    expect(classifyBulkStatus(BulkEmailStatus.TEMPLATE_NOT_FOUND)).toBe(
      "permanent"
    )
    expect(classifyBulkStatus(undefined)).toBe("transient")
  })
})

describe("sendUnit", () => {
  const sesMock = mockClient(SESv2Client)
  const client = new SESv2Client({ region: "us-east-1" })

  it("records the SES MessageId for a successful single send", async () => {
    sesMock.reset()
    sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-1" })
    const outcome = await sendUnit(client, {
      kind: "single",
      email: simple("a"),
    })
    expect(outcome).toEqual({
      sent: [{ emailId: "a", messageId: "ses-1" }],
      failed: [],
      retry: [],
    })
  })

  it("reports permanent single-send failures without throwing", async () => {
    sesMock.reset()
    sesMock.on(SendEmailCommand).rejects(
      new MessageRejected({
        message: "Email address is not verified.",
        $metadata: {},
      })
    )
    const outcome = await sendUnit(client, {
      kind: "single",
      email: simple("a"),
    })
    expect(outcome.sent).toEqual([])
    expect(outcome.failed[0]?.emailId).toBe("a")
    expect(outcome.failed[0]?.error).toContain("MessageRejected")
  })

  it("throws a TransientSendError for throttling", async () => {
    sesMock.reset()
    sesMock.on(SendEmailCommand).rejects(
      new TooManyRequestsException({
        message: "Rate exceeded",
        $metadata: {},
      })
    )
    await expect(
      sendUnit(client, { kind: "single", email: simple("a") })
    ).rejects.toBeInstanceOf(TransientSendError)
  })

  it("splits bulk results into sent, failed, and retry", async () => {
    sesMock.reset()
    sesMock.on(SendBulkEmailCommand).resolves({
      BulkEmailEntryResults: [
        { Status: BulkEmailStatus.SUCCESS, MessageId: "ses-1" },
        { Status: BulkEmailStatus.MESSAGE_REJECTED, Error: "rejected" },
        { Status: BulkEmailStatus.ACCOUNT_THROTTLED, Error: "throttled" },
      ],
    })
    const outcome = await sendUnit(client, {
      kind: "bulk",
      emails: [templated("t1"), templated("t2"), templated("t3")],
    })
    expect(outcome.sent).toEqual([{ emailId: "t1", messageId: "ses-1" }])
    expect(outcome.failed.map((f) => f.emailId)).toEqual(["t2"])
    expect(outcome.retry).toEqual(["t3"])
  })
})
