import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { runToCompletion } from "@convex-dev/migrations"
import type { ActionCtx } from "./_generated/server"
import workpoolTest from "@convex-dev/workpool/test"
import { api, components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import {
  SIGNED_NOTIFICATION_V2,
  TEST_CERT_PEM,
  TEST_TOPIC_ARN,
} from "./testHelpers/snsFixture"
import { insertEmail, patchEmail } from "./emailRows"
import { acceptEmail } from "./emails"
import { insertRow, patchRow } from "./counts"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 8, 28, 12))
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const page = { cursor: null, numItems: 10 }
const day = { from: Date.UTC(2026, 8, 28), to: Date.UTC(2026, 8, 29) - 1 }

async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await storeTestCredentials(f)
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-cfg",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 100 },
    })
  })
  const makeEmail = async (
    changes: Partial<Doc<"emails">> = {},
    accepted = true
  ) =>
    f.t.run(async (ctx) => {
      const id = await insertEmail(
        ctx,
        {
          organizationId: f.owner.team,
          domainId: f.domain,
          from: "hi@mail.example.test",
          to: ["a@example.com", "b@example.com"],
          subject: "Hello",
          status: "queued",
          source: "api",
          generation: 0,
          attempts: 1,
          claimed: true,
          search: "hello",
          ...changes,
        },
        { html: "<p>Hello</p>" },
        ["a@example.com", "b@example.com"]
      )
      if (accepted)
        await acceptEmail(
          ctx,
          (await ctx.db.get("emails", id))!,
          `ses-${id}`,
          Date.now()
        )
      return id
    })
  const row = (id: Id<"emails">) =>
    f.t.run(async (ctx) => (await ctx.db.get("emails", id))!)
  const ingest = async (
    id: Id<"emails">,
    eventType: string,
    detail: Record<string, unknown> = {},
    changes: Record<string, unknown> = {},
    snsId = crypto.randomUUID()
  ) => {
    const mail = {
      messageId: `ses-${id}`,
      timestamp: new Date(Date.now() - 1000).toISOString(),
      destination: ["a@example.com", "b@example.com"],
      tags: { opensend_email: [id], opensend_team: [f.owner.team] },
    }
    const fields: Record<string, string> = {
      Send: "send",
      Delivery: "delivery",
      Bounce: "bounce",
      Complaint: "complaint",
      DeliveryDelay: "deliveryDelay",
      Reject: "reject",
      "Rendering Failure": "failure",
      Open: "open",
      Click: "click",
    }
    const message = JSON.stringify({
      eventType,
      mail,
      [fields[eventType] ?? eventType]: {
        timestamp: new Date().toISOString(),
        ...detail,
      },
      ...changes,
    })
    const args = {
      topicArn: (await f.t.run((ctx) =>
        ctx.db.get("sesRegions", f.region._id)
      ))!.topicArn!,
      messageId: snsId,
      message,
    }
    await f.t.mutation(internal.ses.state.ingest, args)
    const event = await f.t.run(
      async (ctx) =>
        (await ctx.db
          .query("sesEvents")
          .withIndex("by_topicArn_and_messageId", (q) =>
            q.eq("topicArn", args.topicArn).eq("messageId", snsId)
          )
          .unique())!
    )
    await f.t.mutation(internal.ses.projection.project, { id: event._id })
    return { event, args }
  }
  const summary = (domainId?: Id<"domains">) =>
    f.owner.client.query(api.metrics.summary, {
      organizationId: f.owner.team,
      domainId,
      spans: [day],
    })
  return { ...f, makeEmail, row, ingest, summary }
}

const cases = [
  ["Send", "sent", {}],
  ["Delivery", "delivered", { recipients: ["a@example.com"] }],
  [
    "Bounce",
    "bounced",
    {
      bounceType: "Permanent",
      bounceSubType: "General",
      bouncedRecipients: [
        { emailAddress: "a@example.com", diagnosticCode: "550 No such user" },
      ],
    },
  ],
  [
    "Complaint",
    "complained",
    { complainedRecipients: [{ emailAddress: "a@example.com" }] },
  ],
  [
    "DeliveryDelay",
    "delivery_delayed",
    {
      delayedRecipients: [{ emailAddress: "a@example.com" }],
      delayType: "MailboxFull",
    },
  ],
  ["Reject", "failed", { reason: "Bad content" }],
  ["Rendering Failure", "failed", { errorMessage: "Missing variable" }],
  ["Open", "opened", { ipAddress: "1.2.3.4", userAgent: "test" }],
  [
    "Click",
    "clicked",
    { ipAddress: "1.2.3.4", userAgent: "test", link: "https://example.com" },
  ],
] as const

describe("SES projection", () => {
  test.each(cases)(
    "projects %s and emits its webhook once across SNS redelivery",
    async (kind, status, detail) => {
      const f = await setup()
      const id = await f.makeEmail()
      const { event, args } = await f.ingest(id, kind, detail)
      await f.t.mutation(internal.ses.state.ingest, args)
      await f.t.mutation(internal.ses.projection.project, { id: event._id })
      expect((await f.row(id)).status).toBe(status)
      const events = await f.t.run((ctx) => ctx.db.query("events").take(20))
      const matching = events.filter((row) => row.type === `email.${status}`)
      expect(matching).toHaveLength(1)
      expect(matching[0].data).toMatchObject({
        email_id: id,
        from: "hi@mail.example.test",
        to: ["bounced", "complained", "delivered", "delivery_delayed"].includes(
          status
        )
          ? ["a@example.com"]
          : ["a@example.com", "b@example.com"],
        subject: "Hello",
      })
      if (kind === "Bounce")
        expect(matching[0].data.bounce).toEqual({
          type: "Permanent",
          subType: "General",
          message: "550 No such user",
        })
      if (kind === "Click")
        expect(matching[0].data.click).toMatchObject({
          link: "https://example.com",
          ipAddress: "1.2.3.4",
          userAgent: "test",
        })
      if (status === "failed")
        expect(matching[0].data.failed).toHaveProperty("reason")
      const timeline = await f.owner.client.query(api.emails.timeline, {
        id,
        paginationOpts: page,
      })
      expect(timeline.page.filter((row) => row.type === status)).toHaveLength(1)
      expect(
        (await f.t.run((ctx) => ctx.db.get("sesEvents", event._id)))
          ?.projectedAt
      ).toBeDefined()
    }
  )

  test("out-of-order events never regress status and preserve each recipient outcome", async () => {
    const f = await setup()
    const id = await f.makeEmail()
    await f.ingest(id, "Click", { link: "https://example.com" })
    await f.ingest(id, "DeliveryDelay", {
      delayedRecipients: [{ emailAddress: "a@example.com" }],
      timestamp: new Date(Date.now() - 5000).toISOString(),
    })
    await f.ingest(id, "Delivery", { recipients: ["b@example.com"] })
    expect((await f.row(id)).status).toBe("clicked")
    await f.ingest(id, "Bounce", {
      bounceType: "Permanent",
      bouncedRecipients: [{ emailAddress: "a@example.com" }],
    })
    await f.ingest(id, "Open")
    expect((await f.row(id)).status).toBe("bounced")
    await f.ingest(id, "Complaint", {
      complainedRecipients: [{ emailAddress: "b@example.com" }],
    })
    await f.ingest(id, "Click")
    expect((await f.row(id)).status).toBe("complained")
    const timeline = await f.owner.client.query(api.emails.timeline, {
      id,
      paginationOpts: { ...page, numItems: 50 },
    })
    expect(
      timeline.page.find((event) => event.type === "bounced")?.recipients
    ).toEqual(["a@example.com"])
    expect(
      timeline.page.find((event) => event.type === "delivered")?.recipients
    ).toEqual(["b@example.com"])
    const suppressed = await f.owner.client.query(api.suppressions.list, {
      organizationId: f.owner.team,
      paginationOpts: page,
    })
    expect(
      suppressed.page.map((row) => [row.email, row.reason]).sort()
    ).toEqual([
      ["a@example.com", "bounced"],
      ["b@example.com", "complained"],
    ])
    const counts = (await f.summary())[0]
    expect(counts).toMatchObject({
      sent: 1,
      delivered: 1,
      opened: 1,
      clicked: 1,
      bounced: 1,
      complained: 1,
      Permanent: 1,
    })
    const reputation = await f.owner.client.query(api.ses.reputation.list, {
      paginationOpts: page,
    })
    expect(reputation.page[0]).toMatchObject({
      volume: 2,
      bounced: 1,
      complained: 1,
    })
  })

  test.each(["Transient", "Undetermined"])(
    "%s bounce is counted without automatic suppression",
    async (bounceType) => {
      const f = await setup()
      const id = await f.makeEmail()
      await f.ingest(id, "Bounce", {
        bounceType,
        bouncedRecipients: [{ emailAddress: "a@example.com" }],
      })
      expect(
        (await f.summary())[0][bounceType as "Transient" | "Undetermined"]
      ).toBe(1)
      expect(
        (
          await f.owner.client.query(api.suppressions.count, {
            organizationId: f.owner.team,
          })
        ).total
      ).toBe(0)
    }
  )

  test("SNS beating the send response records one acceptance and preserves delivery", async () => {
    const f = await setup()
    const id = await f.makeEmail({}, false)
    await f.ingest(id, "Delivery", { recipients: ["a@example.com"] })
    await f.t.mutation(internal.emails.record, {
      id,
      generation: 0,
      outcome: { kind: "sent", messageId: `ses-${id}` },
    })
    expect(await f.row(id)).toMatchObject({
      status: "delivered",
      messageId: `ses-${id}`,
      claimed: false,
    })
    const events = await f.t.run((ctx) => ctx.db.query("events").take(20))
    expect(events.filter((event) => event.type === "email.sent")).toHaveLength(
      1
    )
    expect((await f.summary())[0]).toMatchObject({ sent: 1, delivered: 1 })
  })

  test("MessageId fallback works and wrong team tags or recipients cannot poison a team", async () => {
    const f = await setup()
    const id = await f.makeEmail()
    await f.ingest(
      id,
      "Delivery",
      { recipients: ["a@example.com"] },
      { mail: { messageId: `ses-${id}` } }
    )
    expect((await f.row(id)).status).toBe("delivered")
    await f.ingest(
      id,
      "Bounce",
      {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "a@example.com" }],
      },
      {
        mail: {
          messageId: `ses-${id}`,
          tags: { opensend_team: [f.outsider.team] },
        },
      }
    )
    await f.ingest(id, "Bounce", {
      bounceType: "Permanent",
      bouncedRecipients: [{ emailAddress: "outsider@example.com" }],
    })
    expect((await f.row(id)).status).toBe("delivered")
    expect(
      (
        await f.owner.client.query(api.suppressions.count, {
          organizationId: f.owner.team,
        })
      ).total
    ).toBe(0)
  })

  test("replays signed SNS notifications from the verification boundary", async () => {
    const f = await setup()
    const id = await f.makeEmail({ to: ["recipient@example.com"] })
    const message = JSON.parse(SIGNED_NOTIFICATION_V2.Message)
    await f.t.run(async (ctx) => {
      await ctx.db.patch("sesRegions", f.region._id, {
        topicArn: TEST_TOPIC_ARN,
      })
      await patchEmail(ctx, id, { messageId: message.mail.messageId })
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(TEST_CERT_PEM))
    )
    for (let i = 0; i < 2; i++)
      await f.t.action(internal.ses.events.receive, {
        body: JSON.stringify(SIGNED_NOTIFICATION_V2),
      })
    const events = await f.t.run((ctx) => ctx.db.query("sesEvents").take(10))
    expect(events).toHaveLength(1)
    await f.t.mutation(internal.ses.projection.project, { id: events[0]._id })
    expect((await f.row(id)).status).toBe("delivered")
  })

  test("account email never enters team metrics or webhooks", async () => {
    const f = await setup()
    const id = await f.makeEmail({
      organizationId: "installation",
      source: "system",
    })
    await f.ingest(id, "Delivery", { recipients: ["a@example.com"] })
    expect((await f.row(id)).status).toBe("delivered")
    expect((await f.summary())[0].sent).toBe(0)
    expect(await f.t.run((ctx) => ctx.db.query("events").take(10))).toEqual([])
  })
})

describe("metrics and authorization", () => {
  test("team isolation, domain filters, calendar boundaries and server paging", async () => {
    const f = await setup()
    const id = await f.makeEmail()
    await f.ingest(id, "Delivery", { recipients: ["a@example.com"] })
    const second = await f.t.run(async (ctx) => {
      const row = (await ctx.db.get("domains", f.domain))!
      const { _id, _creationTime, ...data } = row
      void _id
      void _creationTime
      return insertRow(ctx, "domains", { ...data, name: "second.example.com" })
    })
    await f.makeEmail({ domainId: second, from: "hi@second.example.com" })
    expect((await f.summary())[0].sent).toBe(2)
    expect((await f.summary(f.domain))[0]).toMatchObject({
      sent: 1,
      delivered: 1,
    })
    const args = { organizationId: f.owner.team, spans: [day] }
    await expect(
      f.outsider.client.query(api.metrics.summary, args)
    ).rejects.toThrow("permission")
    await expect(
      f.outsider.client.query(api.metrics.domains, {
        organizationId: f.owner.team,
        paginationOpts: page,
      })
    ).rejects.toThrow("permission")
    expect(
      (
        await f.outsider.client.query(api.metrics.summary, {
          ...args,
          organizationId: f.outsider.team,
        })
      )[0].sent
    ).toBe(0)
    const firstPage = await f.owner.client.query(api.metrics.domains, {
      organizationId: f.owner.team,
      paginationOpts: { ...page, numItems: 1 },
    })
    const next = await f.owner.client.query(api.metrics.domains, {
      organizationId: f.owner.team,
      paginationOpts: { cursor: firstPage.continueCursor, numItems: 1 },
    })
    expect(
      new Set([...firstPage.page, ...next.page].map((row) => row.id)).size
    ).toBe(2)
    expect(
      (
        await f.owner.client.query(api.metrics.summary, {
          ...args,
          spans: [{ from: day.from - 86400000, to: day.from - 1 }],
        })
      )[0].sent
    ).toBe(0)
    await expect(
      f.owner.client.query(api.metrics.summary, {
        ...args,
        spans: [{ ...day, from: day.from + 1 }],
      })
    ).rejects.toThrow("Invalid metrics")
    await expect(
      f.owner.client.query(api.metrics.summary, { ...args, spans: [] })
    ).rejects.toThrow("date range")
  })

  test("plain members can write suppressions and read metrics but cannot pause", async () => {
    const f = await setup()
    const member = await f.actor("member")
    await f.t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "member",
        data: {
          organizationId: f.owner.team,
          userId: member.user._id,
          role: "member",
          createdAt: Date.now(),
        },
      },
    })
    const id = await member.client.mutation(api.suppressions.add, {
      organizationId: f.owner.team,
      email: "a@example.com",
      reason: "manual",
    })
    await member.client.mutation(api.suppressions.remove, { id })
    expect(
      (
        await member.client.query(api.metrics.summary, {
          organizationId: f.owner.team,
          spans: [day],
        })
      )[0].sent
    ).toBe(0)
    await expect(
      member.client.action(api.ses.reputationActions.setPaused, {
        id: f.tenant,
        paused: true,
      })
    ).rejects.toThrow("administrator")
    await expect(
      f.outsider.client.query(api.ses.reputation.list, { paginationOpts: page })
    ).rejects.toThrow("administrator")
    await expect(
      f.outsider.client.query(api.ses.reputation.count, {})
    ).rejects.toThrow("administrator")
  })
})

describe("tenant sending control", () => {
  test("pause/resume calls only the tenant ARN and the send gate fails queued emails", async () => {
    const f = await setup()
    const id = await f.makeEmail({}, false)
    const calls: { name: string; input: unknown }[] = []
    let enabled = false
    vi.spyOn(SESv2Client.prototype, "send").mockImplementation(
      (async (command: { constructor: { name: string }; input: unknown }) => {
        calls.push({ name: command.constructor.name, input: command.input })
        return {
          ReputationEntity: {
            SendingStatusAggregate: enabled ? "ENABLED" : "DISABLED",
            CustomerManagedStatus: { Status: enabled ? "ENABLED" : "DISABLED" },
          },
        }
      }) as never
    )
    await f.owner.client.action(api.ses.reputationActions.setPaused, {
      id: f.tenant,
      paused: true,
    })
    expect(calls[0]).toEqual({
      name: "UpdateReputationEntityCustomerManagedStatusCommand",
      input: {
        ReputationEntityType: "RESOURCE",
        ReputationEntityReference: `arn:aws:ses:us-east-1:123456789012:tenant/${f.tenantName}/provider-tenant`,
        SendingStatus: "DISABLED",
      },
    })
    await expect(
      f.t.query(internal.ses.sendContext.get, {
        organizationId: f.owner.team,
        domainId: f.domain,
      })
    ).rejects.toThrow("Sending is paused")
    await f.t.run((ctx) => patchEmail(ctx, id, { claimed: false }))
    expect(
      await f.t.mutation(internal.emails.claim, { id, generation: 0 })
    ).toBeNull()
    expect(await f.row(id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Sending is paused"),
    })
    enabled = true
    await f.owner.client.action(api.ses.reputationActions.setPaused, {
      id: f.tenant,
      paused: false,
    })
    expect(calls[2].input).toMatchObject({ SendingStatus: "ENABLED" })
    expect(
      await f.t.query(internal.ses.sendContext.get, {
        organizationId: f.owner.team,
        domainId: f.domain,
      })
    ).toHaveProperty("TenantName", f.tenantName)
  })

  test("AWS restriction survives resume, failures fail closed, concurrent requests refuse", async () => {
    const f = await setup()
    const send = vi.spyOn(SESv2Client.prototype, "send").mockResolvedValue({
      ReputationEntity: {
        SendingStatusAggregate: "DISABLED",
        CustomerManagedStatus: { Status: "ENABLED" },
      },
    } as never)
    await f.owner.client.action(api.ses.reputationActions.setPaused, {
      id: f.tenant,
      paused: false,
    })
    expect(
      (await f.t.run((ctx) => ctx.db.get("sesTenants", f.tenant)))
        ?.sendingStatus
    ).toBe("DISABLED")
    send.mockRejectedValue(new Error("AccessDenied"))
    await expect(
      f.owner.client.action(api.ses.reputationActions.setPaused, {
        id: f.tenant,
        paused: true,
      })
    ).rejects.toThrow("AWS operation failed")
    expect(
      (await f.t.run((ctx) => ctx.db.get("sesTenants", f.tenant)))
        ?.sendingStatus
    ).toBe("UNKNOWN")
    await f.owner.client.mutation(internal.ses.reputation.begin, {
      id: f.tenant,
      operation: "one",
    })
    await expect(
      f.owner.client.mutation(internal.ses.reputation.begin, {
        id: f.tenant,
        operation: "two",
      })
    ).rejects.toThrow("in progress")
    await f.t.run((ctx) =>
      ctx.db.patch("sesTenants", f.tenant, { deleted: true })
    )
    await expect(
      f.owner.client.action(api.ses.reputationActions.setPaused, {
        id: f.tenant,
        paused: false,
      })
    ).rejects.toThrow("not ready")
  })
})

describe("projection recovery and metric boundaries", () => {
  test("per-recipient webhooks and rolling counts retain different feedback times", async () => {
    const f = await setup()
    const id = await f.makeEmail()
    const old = new Date(Date.now() - 25 * 3600000).toISOString()
    await f.ingest(id, "Bounce", {
      timestamp: old,
      bounceType: "Permanent",
      bouncedRecipients: [{ emailAddress: "a@example.com" }],
    })
    await f.ingest(id, "Bounce", {
      bounceType: "Permanent",
      bouncedRecipients: [{ emailAddress: "b@example.com" }],
    })
    await f.ingest(id, "Bounce", {
      bounceType: "Permanent",
      bouncedRecipients: [{ emailAddress: "b@example.com" }],
    })
    const result = await f.owner.client.query(api.ses.reputation.list, {
      paginationOpts: page,
    })
    expect(result.page[0]).toMatchObject({ volume: 2, bounced: 1 })
    expect((await f.summary())[0].bounced).toBe(1)
    const events = await f.t.run((ctx) => ctx.db.query("events").take(20))
    expect(
      events
        .filter((event) => event.type === "email.bounced")
        .map((event) => event.data.to)
    ).toEqual([["a@example.com"], ["b@example.com"], ["b@example.com"]])
  })

  test("batched recipients become separate webhooks and a late failure cannot erase delivery", async () => {
    const f = await setup()
    const id = await f.makeEmail()
    await f.ingest(id, "Delivery", {
      recipients: ["a@example.com", "b@example.com"],
    })
    await f.ingest(id, "Reject", {
      reason: "Bad content",
      timestamp: new Date(Date.now() - 5000).toISOString(),
    })
    expect((await f.row(id)).status).toBe("delivered")
    const events = await f.t.run((ctx) => ctx.db.query("events").take(20))
    expect(
      events
        .filter((event) => event.type === "email.delivered")
        .map((event) => event.data.to)
    ).toEqual([["a@example.com"], ["b@example.com"]])
  })

  test("feedback can recover an ambiguous send failure", async () => {
    const f = await setup()
    const id = await f.makeEmail({}, false)
    await f.t.mutation(internal.emails.record, {
      id,
      generation: 0,
      outcome: {
        kind: "failed",
        error: "The send was interrupted",
        retryable: false,
      },
    })
    await f.ingest(id, "Delivery", { recipients: ["a@example.com"] })
    expect((await f.row(id)).status).toBe("delivered")
  })

  test("unmatched feedback can replay after acceptance and malformed input stays inert", async () => {
    const f = await setup()
    const id = await f.makeEmail({}, false)
    const { event } = await f.ingest(
      id,
      "Delivery",
      { recipients: ["a@example.com"] },
      { mail: { messageId: `ses-${id}` } }
    )
    expect((await f.row(id)).status).toBe("queued")
    await f.t.mutation(internal.emails.record, {
      id,
      generation: 0,
      outcome: { kind: "sent", messageId: `ses-${id}` },
    })
    await f.t.mutation(internal.ses.projection.project, {
      id: event._id,
      attempt: 1,
    })
    expect((await f.row(id)).status).toBe("delivered")
    const topicArn = (await f.t.run((ctx) =>
      ctx.db.get("sesRegions", f.region._id)
    ))!.topicArn!
    for (const message of ["not json", "null", '{"eventType":"Unknown"}']) {
      const raw = await f.t.run((ctx) =>
        ctx.db.insert("sesEvents", {
          topicArn,
          messageId: crypto.randomUUID(),
          message,
        })
      )
      await f.t.mutation(internal.ses.projection.project, {
        id: raw,
        attempt: 6,
      })
    }
    expect((await f.summary())[0]).toMatchObject({ sent: 1, delivered: 1 })
  })

  test("mismatched MessageIds and regions cannot update the tagged email", async () => {
    const f = await setup()
    const id = await f.makeEmail()
    const second = await f.makeEmail()
    await f.ingest(
      id,
      "Delivery",
      { recipients: ["a@example.com"] },
      { mail: { messageId: `ses-${second}`, tags: { opensend_email: [id] } } }
    )
    expect((await f.row(id)).status).toBe("sent")
    await f.t.run((ctx) =>
      patchRow(ctx, "domains", f.domain, { region: "eu-west-1" })
    )
    await f.ingest(id, "Delivery", { recipients: ["a@example.com"] })
    expect((await f.row(id)).status).toBe("sent")
  })

  test("retention deletes metric facts through their counters", async () => {
    const f = await setup()
    const id = await f.makeEmail()
    await f.ingest(id, "Bounce", {
      bounceType: "Permanent",
      bouncedRecipients: [{ emailAddress: "a@example.com" }],
    })
    await f.t.run((ctx) => patchEmail(ctx, id, { expiresAt: Date.now() - 1 }))
    await f.t.mutation(internal.emails.prune, {})
    expect((await f.summary())[0]).toMatchObject({
      sent: 0,
      bounced: 0,
      Permanent: 0,
    })
    const reputation = await f.owner.client.query(api.ses.reputation.list, {
      paginationOpts: page,
    })
    expect(reputation.page[0]).toMatchObject({ volume: 0, bounced: 0 })
    expect(
      await f.t.run((ctx) => ctx.db.query("recipientMetrics").take(10))
    ).toEqual([])
  })
})

test("upgrade backfills metrics and replays stored SES events idempotently", async () => {
  const f = await setup()
  const id = await f.t.run(async (ctx) => {
    const emailId = await ctx.db.insert("emails", {
      organizationId: f.owner.team,
      domainId: f.domain,
      from: "hi@mail.example.test",
      to: ["a@example.com"],
      subject: "Legacy",
      source: "api",
      status: "sent",
      generation: 0,
      attempts: 1,
      search: "legacy",
      messageId: "legacy",
      sentAt: Date.now(),
    })
    await ctx.db.insert("emailEvents", {
      emailId,
      type: "sent",
      at: Date.now(),
    })
    const region = (await ctx.db.get("sesRegions", f.region._id))!
    await ctx.db.insert("sesEvents", {
      topicArn: region.topicArn!,
      messageId: "legacy-sns",
      message: JSON.stringify({
        eventType: "Delivery",
        mail: { messageId: "legacy" },
        delivery: {
          timestamp: new Date().toISOString(),
          recipients: ["a@example.com"],
        },
      }),
    })
    return emailId
  })
  const backfill = async (ctx: ActionCtx) => {
    for (const migration of [
      internal.migrations.countEmailDomains,
      internal.migrations.seedEmailMetrics,
      internal.migrations.projectSesEvents,
      internal.migrations.countEmailMetrics,
      internal.migrations.countRecipientMetrics,
    ])
      await runToCompletion(ctx, components.migrations, migration, {
        cursor: null,
      })
  }
  for (let i = 0; i < 2; i++) await f.t.action(backfill)
  expect((await f.row(id)).status).toBe("delivered")
  expect((await f.summary())[0]).toMatchObject({ sent: 1, delivered: 1 })
  expect((await f.summary(f.domain))[0]).toMatchObject({
    sent: 1,
    delivered: 1,
  })
  const events = await f.t.run((ctx) => ctx.db.query("events").take(10))
  expect(
    events.filter((event) => event.type === "email.delivered")
  ).toHaveLength(1)
})
