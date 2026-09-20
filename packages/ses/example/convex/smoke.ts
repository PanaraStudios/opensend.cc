import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2"
import { SES, vEmailId, type EmailId } from "@k4stack/ses"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server"

const ses: SES = new SES(components.ses, {
  onEmailEvent: internal.example.handleEmailEvent,
})
const vCase = v.object({ id: vEmailId, expected: v.string() })

/** Atomically enqueue scenarios and their callback expectations. Simulator only. */
export const start = internalMutation({
  args: { from: v.string(), runId: v.string() },
  returns: v.array(vCase),
  handler: async (ctx, args) => {
    const cases: { id: EmailId; expected: string }[] = []
    for (const expectation of ["success", "bounce", "complaint"] as const) {
      const input = {
        from: args.from,
        to: `${expectation}@simulator.amazonses.com`,
        subject: "SES component smoke test",
        text: "Transactional email setup verification.",
        idempotencyKey: `smoke:${args.runId}:${expectation}`,
      }
      const id = await ses.sendEmail(ctx, input)
      if ((await ses.sendEmail(ctx, input)) !== id)
        throw new Error("Enqueue idempotency failed")
      await ctx.db.insert("testEmails", { email: id, expectation })
      cases.push({
        id,
        expected:
          expectation === "success"
            ? "delivered"
            : expectation === "bounce"
              ? "bounced"
              : "complained",
      })
    }
    // Two compatible templates exercise bulk sending when maxSendRate permits it.
    for (let i = 0; i < 2; i++) {
      const id = await ses.sendEmail(ctx, {
        from: args.from,
        to: "success@simulator.amazonses.com",
        template: {
          content: { subject: "Hi {{name}}", text: "Welcome {{name}}" },
          data: { name: `User ${i}` },
        },
      })
      await ctx.db.insert("testEmails", { email: id, expectation: "success" })
      cases.push({ id, expected: "delivered" })
    }
    const id = await ses.sendEmail(ctx, {
      from: args.from,
      to: "success@simulator.amazonses.com",
      subject: "Must be cancelled",
      text: "Not sent",
    })
    await ses.cancelEmail(ctx, id)
    cases.push({ id, expected: "cancelled" })
    return cases
  },
})

export const check = internalQuery({
  args: { cases: v.array(vCase) },
  returns: v.array(
    v.object({
      id: vEmailId,
      expected: v.string(),
      status: v.string(),
      callback: v.boolean(),
      passed: v.boolean(),
      error: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx, { cases }) => {
    if (cases.length > 20) throw new Error("At most 20 cases")
    return await Promise.all(
      cases.map(async ({ id, expected }) => {
        const state = await ses.status(ctx, id)
        const waiting = await ctx.db
          .query("testEmails")
          .withIndex("by_email", (q) => q.eq("email", id))
          .first()
        const callback = expected === "cancelled" || waiting === null
        const matched =
          expected === "complained"
            ? state?.complained
            : state?.status === expected
        return {
          id,
          expected,
          status: state?.status ?? "missing",
          callback,
          passed: !!matched && callback,
          error: state?.errorMessage ?? null,
        }
      })
    )
  },
})

/** Exercises real SDK serialization and signing in Convex; transport is synthetic. */
export const runtimeSdk = internalAction({
  args: {},
  returns: v.object({
    signed: v.boolean(),
    host: v.string(),
    messageId: v.string(),
  }),
  handler: async () => {
    let signed = false
    let host = ""
    const client = new SESv2Client({
      region: "us-east-1",
      credentials: {
        accessKeyId: "AKIATESTONLY",
        secretAccessKey: "test-only-not-a-credential",
      },
      maxAttempts: 1,
      requestHandler: {
        handle: async (request: {
          headers: Record<string, string>
          hostname: string
        }) => {
          signed =
            request.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ") ??
            false
          host = request.hostname
          return {
            response: {
              statusCode: 200,
              headers: { "content-type": "application/json" },
              body: new TextEncoder().encode(
                '{"MessageId":"synthetic-runtime-ok"}'
              ),
            },
          }
        },
      },
    })
    try {
      const result = await client.send(
        new SendEmailCommand({
          FromEmailAddress: "test@example.com",
          Destination: { ToAddresses: ["success@simulator.amazonses.com"] },
          Content: {
            Simple: {
              Subject: { Data: "Runtime test" },
              Body: { Text: { Data: "hello" } },
            },
          },
        })
      )
      return { signed, host, messageId: result.MessageId ?? "" }
    } finally {
      client.destroy()
    }
  },
})

/** String wrappers keep CLI output machine-readable for the workstation script. */
export const startJson = internalMutation({
  args: { from: v.string(), runId: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> =>
    JSON.stringify(await ctx.runMutation(internal.smoke.start, args)),
})
export const checkJson = internalQuery({
  args: { cases: v.array(vCase) },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> =>
    JSON.stringify(await ctx.runQuery(internal.smoke.check, args)),
})
