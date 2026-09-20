/// <reference types="vite/client" />
import { test } from "vitest"
import { convexTest } from "convex-test"
import workpool from "@convex-dev/workpool/test"
import rateLimiter from "@convex-dev/rate-limiter/test"
import schema from "./schema.js"
import type { Doc } from "./_generated/dataModel.js"
import type { EmailEventOfType, EventType, RuntimeConfig } from "./shared.js"
import { assertExhaustive } from "./utils.js"

export const modules = import.meta.glob("./**/*.*s")

export const setupTest = () => {
  const t = convexTest(schema, modules)
  workpool.register(t, "emailWorkpool")
  workpool.register(t, "callbackWorkpool")
  rateLimiter.register(t, "rateLimiter")
  return t
}

export type Tester = ReturnType<typeof setupTest>

test("setup", () => {})

export const TEST_SES_MESSAGE_ID =
  "0100018e8f7b1c2d-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d-000000"

const baseMail = {
  timestamp: "2024-01-01T00:00:00.000Z",
  messageId: TEST_SES_MESSAGE_ID,
  source: "sender@example.com",
  sourceArn: "arn:aws:ses:us-east-1:123456789012:identity/example.com",
  sendingAccountId: "123456789012",
  destination: ["recipient@example.com"],
  headersTruncated: false,
  headers: [
    { name: "From", value: "sender@example.com" },
    { name: "To", value: "recipient@example.com" },
    { name: "Subject", value: "Test Email" },
  ],
  commonHeaders: {
    from: ["sender@example.com"],
    to: ["recipient@example.com"],
    messageId: TEST_SES_MESSAGE_ID,
    subject: "Test Email",
  },
  tags: {
    "ses:configuration-set": ["ConfigSet"],
    "ses:source-ip": ["192.0.2.0"],
  },
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

/** Build a realistic SES event record of the given type, following the AWS examples. */
export const createTestEventOfType = <T extends EventType>(
  type: T,
  overrides?: DeepPartial<EmailEventOfType<T>>
): EmailEventOfType<T> => {
  const merge = (event: Record<string, unknown>): EmailEventOfType<T> => {
    if (!overrides) return event as EmailEventOfType<T>
    const merged: Record<string, unknown> = { ...event }
    for (const [key, value] of Object.entries(overrides)) {
      const current = merged[key]
      merged[key] =
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        current !== null &&
        typeof current === "object" &&
        !Array.isArray(current)
          ? { ...(current as object), ...(value as object) }
          : value
    }
    return merged as EmailEventOfType<T>
  }

  const mail = baseMail
  switch (type) {
    case "Send":
      return merge({ eventType: "Send", mail, send: {} })
    case "Reject":
      return merge({
        eventType: "Reject",
        mail,
        reject: { reason: "Bad content" },
      })
    case "Bounce":
      return merge({
        eventType: "Bounce",
        mail,
        bounce: {
          bounceType: "Permanent",
          bounceSubType: "General",
          bouncedRecipients: [
            {
              emailAddress: "recipient@example.com",
              action: "failed",
              status: "5.1.1",
              diagnosticCode: "smtp; 550 5.1.1 user unknown",
            },
          ],
          timestamp: "2024-01-01T00:01:00.000Z",
          feedbackId: "0100018e8f7b1c2d-feedback-000000",
          reportingMTA: "dsn; mta.example.com",
        },
      })
    case "Complaint":
      return merge({
        eventType: "Complaint",
        mail,
        complaint: {
          complainedRecipients: [{ emailAddress: "recipient@example.com" }],
          timestamp: "2024-01-01T00:01:00.000Z",
          feedbackId: "0100018e8f7b1c2d-feedback-000000",
          userAgent: "Mozilla/5.0",
          complaintFeedbackType: "abuse",
          arrivalDate: "2024-01-01T00:01:00.000Z",
        },
      })
    case "Delivery":
      return merge({
        eventType: "Delivery",
        mail,
        delivery: {
          timestamp: "2024-01-01T00:00:12.000Z",
          processingTimeMillis: 11893,
          recipients: ["recipient@example.com"],
          smtpResponse: "250 2.6.0 Message received",
          remoteMtaIp: "192.0.2.1",
          reportingMTA: "mta.example.com",
        },
      })
    case "Open":
      return merge({
        eventType: "Open",
        mail,
        open: {
          ipAddress: "192.0.2.1",
          timestamp: "2024-01-01T00:05:00.000Z",
          userAgent: "Mozilla/5.0",
          isBotEvent: "Unlikely",
        },
      })
    case "Click":
      return merge({
        eventType: "Click",
        mail,
        click: {
          ipAddress: "192.0.2.1",
          timestamp: "2024-01-01T00:10:00.000Z",
          userAgent: "Mozilla/5.0",
          link: "https://example.com/test-link",
          linkTags: { samplekey0: ["samplevalue0"] },
          isBotEvent: "Likely",
        },
      })
    case "Rendering Failure":
      return merge({
        eventType: "Rendering Failure",
        mail,
        failure: {
          errorMessage:
            "Attribute 'name' is not present in the rendering data.",
          templateName: "MyTemplate",
        },
      })
    case "DeliveryDelay":
      return merge({
        eventType: "DeliveryDelay",
        mail,
        deliveryDelay: {
          timestamp: "2024-01-01T00:10:00.000Z",
          delayType: "TransientCommunicationFailure",
          expirationTime: "2024-01-01T12:00:00.000Z",
          delayedRecipients: [
            {
              emailAddress: "recipient@example.com",
              status: "4.4.1",
              diagnosticCode:
                "smtp; 421 4.4.1 Unable to connect to remote host",
            },
          ],
        },
      })
    case "Subscription":
      return merge({
        eventType: "Subscription",
        mail,
        subscription: {
          contactList: "ContactListName",
          timestamp: "2024-01-01T00:00:17.000Z",
          source: "UnsubscribeHeader",
          newTopicPreferences: {
            unsubscribeAll: true,
            topicSubscriptionStatus: [
              { topicName: "ExampleTopicName", subscriptionStatus: "OptOut" },
            ],
          },
          oldTopicPreferences: {
            unsubscribeAll: false,
            topicSubscriptionStatus: [
              { topicName: "ExampleTopicName", subscriptionStatus: "OptIn" },
            ],
          },
        },
      })
    default:
      return assertExhaustive(type)
  }
}

export const createTestRuntimeConfig = (
  overrides?: Partial<RuntimeConfig>
): RuntimeConfig => ({
  region: "us-east-1",
  credentials: {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  },
  maxSendRate: 10,
  testMode: true,
  initialBackoffMs: 1000,
  retryAttempts: 3,
  ...overrides,
})

export const setupTestLastOptions = (
  t: Tester,
  overrides?: Partial<RuntimeConfig>
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("lastOptions", {
      options: createTestRuntimeConfig(overrides),
    })
  })

export const insertTestEmail = (
  t: Tester,
  fields: Omit<Doc<"emails">, "_id" | "_creationTime">
) =>
  t.run(async (ctx) => {
    const id = await ctx.db.insert("emails", fields)
    const email = await ctx.db.get("emails", id)
    if (!email) throw new Error("Email not found")
    return email
  })

export const insertTestSentEmail = (
  t: Tester,
  overrides?: Partial<Doc<"emails">>
) =>
  insertTestEmail(t, {
    from: "sender@example.com",
    to: ["recipient@example.com"],
    subject: "Test Email",
    replyTo: [],
    status: "sent",
    bounced: false,
    complained: false,
    failed: false,
    deliveryDelayed: false,
    opened: false,
    clicked: false,
    sesMessageId: TEST_SES_MESSAGE_ID,
    segment: 1,
    finalizedAt: Number.MAX_SAFE_INTEGER, // FINALIZED_EPOCH
    ...overrides,
  })

export const getEmail = (t: Tester, id: Doc<"emails">["_id"]) =>
  t.run(async (ctx) => {
    const email = await ctx.db.get("emails", id)
    if (!email) throw new Error("Email not found")
    return email
  })
