import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { api, components, internal } from "./_generated/api"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { insertEmail } from "./emailRows"
import { patchRow } from "./counts"
import { signToken } from "../lib/tokens/signed"
import { TRACKING_CONTEXT } from "../lib/tracking/html"
import { trackingTarget } from "./ses/contracts"
import { trackingOrigin } from "./tracking"

const secret = "test-tracking-secret-".repeat(3)
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("BETTER_AUTH_SECRET", secret)
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await storeTestCredentials(f)
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "domains", f.domain, {
      status: "partially_verified",
      sesVerified: true,
      dkimVerified: true,
      mailFromVerified: true,
      tenantAssociated: true,
      configurationSet: "opensend-cfg",
      openTracking: true,
      clickTracking: true,
      trackingSubdomain: "links",
      records: [
        {
          id: "tracking",
          kind: "Tracking",
          type: "CNAME",
          name: "links.mail.example.test",
          value: "api.opensend.test",
          ttl: "300",
          status: "pending",
        },
      ],
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 100 },
    })
  })
  const id = await f.t.run((ctx) =>
    insertEmail(
      ctx,
      {
        organizationId: f.owner.team,
        domainId: f.domain,
        from: "hi@mail.example.test",
        to: ["a@example.com"],
        subject: "Tracked",
        status: "queued",
        source: "api",
        generation: 0,
        attempts: 0,
        search: "tracked",
      },
      {
        html: '<a class="cta" href="https://example.com/?x=1&amp;y=2">Visit</a>',
        text: "https://example.com/?x=1&y=2",
      },
      ["a@example.com"]
    )
  )
  const token = (index: number) =>
    signToken(`${id}.${index}`, TRACKING_CONTEXT, secret)
  return { ...f, id, token }
}

test("send pipeline tracks through verified HTTPS fallback and leaves text untouched", async () => {
  const f = await setup()
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockResolvedValue({ MessageId: "ses-1" } as never)
  await f.t.action(internal.emailSend.deliver, { id: f.id, generation: 0 })
  const input = send.mock.calls[0][0].input as {
    Content: {
      Simple: { Body: { Html: { Data: string }; Text: { Data: string } } }
    }
  }
  expect(input.Content.Simple.Body.Html.Data).toContain(
    "https://api.opensend.test/t/c/"
  )
  expect(input.Content.Simple.Body.Html.Data).toContain(
    "https://api.opensend.test/t/o/"
  )
  expect(input.Content.Simple.Body.Text.Data).toBe(
    "https://example.com/?x=1&y=2"
  )
  expect(
    await f.t.run((ctx) => ctx.db.query("emailTracking").first())
  ).toMatchObject({ links: ["https://example.com/?x=1&y=2"] })
})

test("each HTTP hit projects once, emits Resend payloads, and unique metrics stay unique", async () => {
  const f = await setup()
  await f.t.mutation(internal.emails.claim, { id: f.id, generation: 0 })
  for (const kind of ["o", "o", "c", "c"] as const) {
    const result = await f.t.fetch(
      `/t/${kind}/${await f.token(kind === "o" ? -1 : 0)}`,
      { headers: { "user-agent": "test", "x-real-ip": "1.2.3.4" } }
    )
    expect(result.status).toBe(kind === "o" ? 200 : 302)
    expect(result.headers.get("cache-control")).toContain("no-store")
    if (kind === "c")
      expect(result.headers.get("location")).toBe(
        "https://example.com/?x=1&y=2"
      )
    else {
      expect(result.headers.get("content-type")).toBe("image/gif")
      expect((await result.arrayBuffer()).byteLength).toBeGreaterThan(20)
    }
  }
  const data = await f.t.run(async (ctx) => ({
    row: await ctx.db.get("emails", f.id),
    events: await ctx.db.query("emailEvents").take(20),
    webhooks: await ctx.db.query("events").take(20),
    metrics: await ctx.db.query("emailMetrics").take(20),
  }))
  expect(data.row?.status).toBe("clicked")
  expect(data.events.filter((r) => r.type === "opened")).toHaveLength(2)
  expect(data.events.filter((r) => r.type === "clicked")).toHaveLength(2)
  expect(data.metrics.map((r) => r.type).sort()).toEqual([
    "clicked",
    "delivered",
    "opened",
    "queued",
  ])
  expect(data.webhooks.filter((r) => r.type === "email.clicked")).toHaveLength(
    2
  )
  expect(
    data.webhooks.find((r) => r.type === "email.clicked")?.data
  ).toMatchObject({
    email_id: f.id,
    to: ["a@example.com"],
    click: {
      link: "https://example.com/?x=1&y=2",
      ipAddress: "1.2.3.4",
      userAgent: "test",
      timestamp: new Date().toISOString(),
    },
  })
  expect(
    data.webhooks.find((r) => r.type === "email.opened")?.data
  ).not.toHaveProperty("click")
})

test("forgeries, wrong purpose, unknown indexes and arbitrary destinations return 404", async () => {
  const f = await setup()
  await f.t.mutation(internal.emails.claim, { id: f.id, generation: 0 })
  for (const suffix of [
    "forged",
    (await f.token(0)) + "x",
    await f.token(1),
    await f.token(-1),
    await signToken(`${f.id}.https://evil.test`, TRACKING_CONTEXT, secret),
  ]) {
    const response = await f.t.fetch(`/t/c/${suffix}?url=https://evil.test`)
    expect(response.status).toBe(404)
    expect(response.headers.has("location")).toBe(false)
  }
  const good = await f.t.fetch(`/t/c/${await f.token(0)}?url=https://evil.test`)
  expect(good.headers.get("location")).toBe("https://example.com/?x=1&y=2")
})

test("verified CNAME enables custom host and the TLS ask endpoint rejects all others", async () => {
  const f = await setup()
  expect(
    (await f.t.fetch("/t/ask?domain=links.mail.example.test")).status
  ).toBe(403)
  await f.t.run(async (ctx) => {
    const domain = (await ctx.db.get("domains", f.domain))!
    await patchRow(ctx, "domains", f.domain, {
      records: domain.records.map((r) => ({
        ...r,
        status: "verified" as const,
      })),
    })
  })
  const message = await f.t.mutation(internal.emails.claim, {
    id: f.id,
    generation: 0,
  })
  expect(message?.html).toContain("https://links.mail.example.test/t/")
  expect(
    (await f.t.fetch("/t/ask?domain=links.mail.example.test")).status
  ).toBe(200)
  expect((await f.t.fetch("/t/ask?domain=evil.test")).status).toBe(403)
  const domain = (await f.t.run((ctx) => ctx.db.get("domains", f.domain)))!
  expect(
    trackingOrigin(
      {
        ...domain,
        records: domain.records.map((r) => ({
          ...r,
          value: "r.us-east-1.awstrack.me",
        })),
      },
      "https://api.opensend.test"
    )
  ).toBe("https://api.opensend.test")
  await f.t.run((ctx) => patchRow(ctx, "domains", f.domain, { deleted: true }))
  expect(
    (await f.t.fetch("/t/ask?domain=links.mail.example.test")).status
  ).toBe(403)
})

test("rate limits hits without creating extra events", async () => {
  const f = await setup()
  await f.t.mutation(internal.emails.claim, { id: f.id, generation: 0 })
  const url = `/t/o/${await f.token(-1)}`
  for (let i = 0; i < 120; i++) expect((await f.t.fetch(url)).status).toBe(200)
  expect((await f.t.fetch(url)).status).toBe(429)
  expect(
    (await f.t.run((ctx) => ctx.db.query("emailEvents").take(150))).filter(
      (r) => r.type === "opened"
    )
  ).toHaveLength(120)
})

test("tracking remains team scoped, members can configure it, invalid settings fail", async () => {
  const f = await setup()
  await expect(
    f.outsider.client.mutation(api.domains.update, {
      id: f.domain,
      clickTracking: false,
    })
  ).rejects.toThrow(/permission/i)
  const member = await f.actor("tracking-member")
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
  await expect(
    member.client.mutation(api.domains.update, {
      id: f.domain,
      trackingSubdomain: "invalid name",
    })
  ).rejects.toThrow()
  await member.client.mutation(api.domains.update, {
    id: f.domain,
    clickTracking: false,
  })
  expect(
    (await f.t.run((ctx) => ctx.db.get("domains", f.domain)))?.clickTracking
  ).toBe(false)
})

test("SES OPEN and CLICK no longer project", async () => {
  const f = await setup()
  await f.t.mutation(internal.emails.claim, { id: f.id, generation: 0 })
  for (const eventType of ["Open", "Click"]) {
    const id = await f.t.run((ctx) =>
      ctx.db.insert("sesEvents", {
        topicArn: "arn:aws:sns:us-east-1:123456789012:opensend-events",
        messageId: eventType,
        message: JSON.stringify({
          eventType,
          mail: { messageId: "ses-1", tags: { opensend_email: [f.id] } },
        }),
      })
    )
    await f.t.mutation(internal.ses.projection.project, { id })
  }
  expect((await f.t.run((ctx) => ctx.db.get("emails", f.id)))?.status).toBe(
    "queued"
  )
})

test("click before the SES response preserves acceptance, message ID and retention", async () => {
  const f = await setup()
  vi.spyOn(SESv2Client.prototype, "send").mockImplementation(async () => {
    expect((await f.t.fetch(`/t/c/${await f.token(0)}`)).status).toBe(302)
    return { MessageId: "ses-early-click" } as never
  })
  await f.t.action(internal.emailSend.deliver, { id: f.id, generation: 0 })
  const row = await f.t.run((ctx) => ctx.db.get("emails", f.id))
  expect(row).toMatchObject({
    status: "clicked",
    messageId: "ses-early-click",
    claimed: false,
    sentAt: expect.any(Number),
    expiresAt: expect.any(Number),
  })
  const events = await f.t.run((ctx) => ctx.db.query("emailEvents").take(20))
  expect(events.filter((event) => event.type === "sent")).toHaveLength(1)
})

test("tracking endpoints return 404 after email content retention cleanup", async () => {
  const f = await setup()
  await f.t.mutation(internal.emails.claim, { id: f.id, generation: 0 })
  const { deleteEmailContent } = await import("./emailRows")
  await f.t.run((ctx) => deleteEmailContent(ctx, f.id))
  expect((await f.t.fetch(`/t/c/${await f.token(0)}`)).status).toBe(404)
})

test("retry keeps link indexes and origin stable and does not duplicate the URL map", async () => {
  const f = await setup()
  const first = await f.t.mutation(internal.emails.claim, {
    id: f.id,
    generation: 0,
  })
  await f.t.run(async (ctx) => {
    const { patchEmail } = await import("./emailRows")
    await patchEmail(ctx, f.id, { claimed: false, generation: 1 })
    const domain = (await ctx.db.get("domains", f.domain))!
    await patchRow(ctx, "domains", f.domain, {
      records: domain.records.map((r) => ({
        ...r,
        status: "verified" as const,
      })),
    })
  })
  const second = await f.t.mutation(internal.emails.claim, {
    id: f.id,
    generation: 1,
  })
  expect(second?.html).toBe(first?.html)
  expect(
    await f.t.run((ctx) => ctx.db.query("emailTracking").take(10))
  ).toHaveLength(1)
})

test("cloud custom tracking targets the dashboard proxy and survives upstream Host rewriting", async () => {
  vi.stubEnv("SITE_URL", "https://dashboard.opensend.test")
  const f = await setup()
  const callbackOrigin = "https://fake-name.eu.convex.site"
  expect(
    trackingTarget(callbackOrigin, "https://dashboard.opensend.test")
  ).toBe("dashboard.opensend.test")
  expect(
    trackingTarget(
      "https://api.opensend.test",
      "https://dashboard.opensend.test"
    )
  ).toBe("api.opensend.test")
  await f.t.run(async (ctx) => {
    await ctx.db.patch("installation", f.installation, { callbackOrigin })
    const domain = (await ctx.db.get("domains", f.domain))!
    await patchRow(ctx, "domains", f.domain, {
      records: domain.records.map((r) => ({
        ...r,
        status: "verified" as const,
        value: "dashboard.opensend.test",
      })),
    })
  })
  expect(
    (await f.t.fetch("/t/ask?domain=links.mail.example.test")).status
  ).toBe(200)
  const message = await f.t.mutation(internal.emails.claim, {
    id: f.id,
    generation: 0,
  })
  expect(message?.html).toContain("https://links.mail.example.test/t/")
  const response = await f.t.fetch(`/t/c/${await f.token(0)}`, {
    headers: { host: "fake-name.eu.convex.site", "x-real-ip": "1.2.3.4" },
  })
  expect(response.status).toBe(302)
  expect(response.headers.get("location")).toBe("https://example.com/?x=1&y=2")
  await f.t.run(async (ctx) => {
    const domain = (await ctx.db.get("domains", f.domain))!
    await patchRow(ctx, "domains", f.domain, {
      records: domain.records.map((r) => ({
        ...r,
        value: "fake-name.eu.convex.site",
      })),
    })
  })
  expect(
    (await f.t.fetch("/t/ask?domain=links.mail.example.test")).status
  ).toBe(403)
})
