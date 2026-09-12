import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2"
import { SES, vOnEmailEventArgs } from "@k4stack/ses"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server"

export const ses: SES = new SES(components.ses, {
  onEmailEvent: internal.example.handleEmailEvent,
})

const SIMULATOR = "simulator.amazonses.com"

/** Send a burst of emails to the SES mailbox simulator and wait for them to finalize. */
export const testBatch = internalAction({
  args: { from: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scenarios = ["success", "bounce", "complaint"] as const
    for (let i = 0; i < 25; i++) {
      const expectation = scenarios[i % scenarios.length]!
      const email = await ses.sendEmail(ctx, {
        from: args.from,
        to: `${expectation}+${i}@${SIMULATOR}`,
        subject: "Test Email",
        html: "This is a test email",
      })
      await ctx.runMutation(internal.example.insertExpectation, {
        email,
        expectation,
      })
    }
    const deadline = Date.now() + 240_000
    while (!(await ctx.runQuery(internal.example.isEmpty))) {
      if (Date.now() >= deadline)
        throw new Error(
          "Timed out waiting for SES callbacks; inspect SNS delivery and configuration set"
        )
      console.log("Waiting for emails to be processed...")
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    console.log("All emails finalized as expected")
    return null
  },
})

export const sendOne = internalAction({
  args: { from: v.string(), to: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const email = await ses.sendEmail(ctx, {
      from: args.from,
      to: args.to ?? [
        `success@${SIMULATOR}`,
        `success+1@${SIMULATOR}`,
        `bounce@${SIMULATOR}`,
        `complaint@${SIMULATOR}`,
        `ooto@${SIMULATOR}`,
      ],
      subject: "Test Email",
      html: "This is a test email",
    })
    console.log("Email enqueued", email)
    const deadline = Date.now() + 240_000
    let status = await ses.status(ctx, email)
    while (
      status &&
      (status.status === "queued" || status.status === "waiting")
    ) {
      if (Date.now() >= deadline)
        throw new Error("Timed out waiting for SES send")
      await new Promise((resolve) => setTimeout(resolve, 1000))
      status = await ses.status(ctx, email)
    }
    console.log("Email status", status)
    return email
  },
})

/** Send with a stored SES template (create one with `aws sesv2 create-email-template`). */
export const sendWithTemplate = internalAction({
  args: {
    from: v.string(),
    to: v.optional(v.string()),
    templateName: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const email = await ses.sendEmail(ctx, {
      from: args.from,
      to: args.to ?? `success@${SIMULATOR}`,
      template: {
        name: args.templateName,
        data: { PRODUCT: "Vintage Macintosh", PRICE: 499 },
      },
    })
    console.log("Templated email enqueued", email)
    return email
  },
})

/** Send with an inline template; no template resource needs to exist in SES. */
export const sendWithInlineTemplate = internalAction({
  args: { from: v.string(), to: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await ses.sendEmail(ctx, {
      from: args.from,
      to: args.to ?? `success@${SIMULATOR}`,
      template: {
        content: {
          subject: "Welcome, {{name}}!",
          html: "<p>Thanks for joining, {{name}}.</p>",
          text: "Thanks for joining, {{name}}.",
        },
        data: { name: "Ada" },
      },
    })
  },
})

export const insertExpectation = internalMutation({
  args: {
    email: v.string(),
    expectation: v.union(
      v.literal("success"),
      v.literal("bounce"),
      v.literal("complaint")
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("testEmails", {
      email: args.email,
      expectation: args.expectation,
    })
    return null
  },
})

export const isEmpty = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return (await ctx.db.query("testEmails").first()) === null
  },
})

/** Receives every SES event for emails sent by this app. */
export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    console.log("Got called back!", args.id, args.event.eventType)
    const testEmail = await ctx.db
      .query("testEmails")
      .withIndex("by_email", (q) => q.eq("email", args.id))
      .unique()
    if (!testEmail) {
      console.log("Not a test email, ignoring")
      return null
    }
    const finalizing =
      (args.event.eventType === "Delivery" &&
        testEmail.expectation === "success") ||
      (args.event.eventType === "Bounce" &&
        testEmail.expectation === "bounce") ||
      (args.event.eventType === "Complaint" &&
        testEmail.expectation === "complaint")
    if (finalizing) {
      console.log(
        `Email ${args.id} finalized as expected: ${args.event.eventType}`
      )
      await ctx.db.delete("testEmails", testEmail._id)
    }
    return null
  },
})

/**
 * Send an email yourself with the AWS SDK while letting the component track
 * it. Useful for features the batching API does not cover, like attachments.
 */
export const sendManual = internalAction({
  args: { from: v.string(), to: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const client = new SESv2Client({
      maxAttempts: 1,
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
    })
    const to = args.to ?? `success@${SIMULATOR}`
    const subject = "hello world"

    return await ses.sendEmailManually(
      ctx,
      { from: args.from, to, subject },
      async (emailId) => {
        const response = await client.send(
          new SendEmailCommand({
            ConfigurationSetName: process.env.AWS_SES_CONFIGURATION_SET,
            FromEmailAddress: args.from,
            Destination: { ToAddresses: [to] },
            Content: {
              Simple: {
                Subject: { Data: subject },
                Body: { Text: { Data: "it works!" } },
                Headers: [{ Name: "X-Email-Id", Value: emailId }],
              },
            },
          })
        )
        if (!response.MessageId)
          throw new Error("No MessageId returned from SES")
        return response.MessageId
      }
    )
  },
})
