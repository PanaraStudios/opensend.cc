import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { tokenHash } from "../lib/oauth/policy"
import type { Caller } from "./api/caller"

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  const key = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Retry", permission: "full_access" },
  })
  const credential = {
    kind: "key" as const,
    tokenHash: await tokenHash(key.token),
  }
  const reserve = (key = "retry", requestHash = "same") =>
    f.t.mutation(internal.api.state.begin, {
      credential,
      permission: "full_access",
      idempotency: { key, requestHash },
    })
  const call = (path: string, body: unknown, retry = path) =>
    f.t.fetch(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.token}`,
        "Idempotency-Key": retry,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { ...f, reserve, call }
}

test("a crash after resource creation and a late 500 cannot discard the committed result", async () => {
  const f = await setup()
  const begun = await f.reserve()
  if (begun.kind !== "ok") throw Error("reservation failed")
  const caller: Caller = { ...begun.caller, idempotencyId: begun.idempotencyId }
  await expect(
    f.t.action(async (ctx) => {
      await ctx.runMutation(internal.api.audience.create, {
        caller,
        resource: "segments",
        body: '{"name":"Once"}',
      })
      throw Error("crash after commit")
    })
  ).rejects.toThrow("crash after commit")
  await f.t.mutation(internal.api.state.finish, {
    caller,
    idempotencyId: begun.idempotencyId,
    log: {
      method: "POST",
      path: "/segments",
      status: 500,
      durationMs: 1,
      userAgent: "test",
      requestHeaders: [],
    },
  })
  vi.setSystemTime(Date.now() + 61_000)
  const retry = await f.reserve()
  expect(retry.kind).toBe("replay")
  expect(
    await f.t.run((ctx) => ctx.db.query("segments").collect())
  ).toHaveLength(1)
  await expect(
    f.t.mutation(internal.api.audience.create, {
      caller,
      resource: "segments",
      body: '{"name":"Duplicate"}',
    })
  ).rejects.toThrow("concurrent_idempotent_requests")
})

test("expired uncommitted leases allow a retry and fence the original worker", async () => {
  const f = await setup()
  const first = await f.reserve()
  if (first.kind !== "ok") throw Error("reservation failed")
  expect(await f.reserve()).toMatchObject({
    kind: "error",
    error: { statusCode: 409, name: "concurrent_idempotent_requests" },
  })
  expect(await f.reserve("retry", "different")).toMatchObject({
    kind: "error",
    error: { statusCode: 409, name: "invalid_idempotent_request" },
  })
  vi.setSystemTime(Date.now() + 61_000)
  const next = await f.reserve()
  expect(next.kind).toBe("ok")
  await expect(
    f.t.mutation(internal.api.audience.create, {
      caller: { ...first.caller, idempotencyId: first.idempotencyId },
      resource: "segments",
      body: '{"name":"stale"}',
    })
  ).rejects.toThrow("concurrent_idempotent_requests")
  expect(
    await f.t.run((ctx) => ctx.db.query("segments").collect())
  ).toHaveLength(0)
})

test.each([
  ["/api-keys", { name: "Once" }],
  ["/domains", { name: "another.example.com" }],
  ["/contacts", { email: "once@example.com" }],
  ["/segments", { name: "Once" }],
  ["/topics", { name: "Once", default_subscription: "opt_in" }],
  ["/contact-properties", { key: "once", type: "string" }],
  ["/templates", { name: "Once", html: "<p>Hello</p>" }],
  [
    "/broadcasts",
    {
      name: "Once",
      subject: "Hello",
      html: "<p>Hello</p>",
      from: "hi@mail.example.test",
    },
  ],
  ["/events", { name: "purchase" }],
  [
    "/events/send",
    { event: "purchase", email: "once@example.com", properties: {} },
  ],
] as const)(
  "%s commits its response before the HTTP logger",
  async (path, body) => {
    const f = await setup()
    const response = await f.call(path, body)
    const text = await response.text()
    expect(response.status, text).toBeLessThan(300)
    const reservation = await f.t.run((ctx) =>
      ctx.db.query("apiIdempotency").first()
    )
    expect(reservation?.response).toEqual({
      status: response.status,
      body: text,
    })
    vi.setSystemTime(Date.now() + 61_000)
    expect(await (await f.call(path, body)).text()).toBe(text)
    expect((await f.call(path, { ...body, changed: true })).status).toBe(409)
  }
)

test("resource command POSTs retain their exact responses", async () => {
  const f = await setup()
  const contact = await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: f.owner.team,
    contacts: [{ email: "c@example.com" }],
    segmentIds: [],
  })
  const segment = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.owner.team,
    name: "S",
  })
  const template = await f.owner.client.mutation(api.templates.create, {
    organizationId: f.owner.team,
    name: "T",
    subject: "S",
    preview: "",
    html: "<p>T</p>",
  })
  const broadcast = await f.owner.client.mutation(api.broadcasts.create, {
    organizationId: f.owner.team,
    name: "B",
    subject: "S",
    preview: "",
    html: "<p>T</p>",
  })
  for (const path of [
    `/contacts/${contact.createdIds[0]}/segments/${segment}`,
    `/templates/${template}/publish`,
    `/templates/${template}/duplicate`,
    `/broadcasts/${broadcast}/duplicate`,
    `/domains/${f.domain}/verify`,
  ]) {
    vi.setSystemTime(Date.now() + 1000)
    const first = await f.call(path, {})
    const text = await first.text()
    expect(first.status, text).toBe(200)
    const saved = await f.t.run((ctx) =>
      ctx.db
        .query("apiIdempotency")
        .withIndex("by_organizationId_and_key", (q) =>
          q.eq("organizationId", f.owner.team).eq("key", path)
        )
        .unique()
    )
    expect(saved?.response?.body).toBe(text)
    expect(await (await f.call(path, {})).text()).toBe(text)
  }
})

test.each(["/emails", "/emails/batch", "/smtp/emails"])(
  "%s creates and queues only once",
  async (path) => {
    const f = await setup()
    await f.t.run(async (ctx) => {
      await ctx.db.patch("domains", f.domain, {
        status: "verified",
        tenantAssociated: true,
        configurationSet: "test",
      })
      await ctx.db.patch("sesRegions", f.region._id, {
        callbackConfirmed: true,
        quota: { ...f.region.quota, production: true },
      })
    })
    await f.owner.client.mutation(api.smtp.update, {
      organizationId: f.owner.team,
      enabled: true,
    })
    const email = {
      from: "hi@mail.example.test",
      to: ["r@example.com"],
      subject: "Once",
      html: "<p>Hello</p>",
    }
    const body = path.endsWith("batch")
      ? [email]
      : { ...email, attachments: [{ filename: "a.txt", content: "SGVsbG8=" }] }
    const first = await f.call(path, body)
    const text = await first.text()
    expect(first.status, text).toBe(200)
    const reservation = await f.t.run((ctx) =>
      ctx.db.query("apiIdempotency").first()
    )
    expect(reservation?.response?.body).toBe(text)
    vi.setSystemTime(Date.now() + 61_000)
    expect(await (await f.call(path, body)).text()).toBe(text)
    expect(
      await f.t.run((ctx) => ctx.db.query("emails").collect())
    ).toHaveLength(1)
  }
)

test("a committed key expires after 24 hours", async () => {
  const f = await setup()
  await f.call("/segments", { name: "One" })
  vi.setSystemTime(Date.now() + 86_400_001)
  expect((await f.call("/segments", { name: "Two" })).status).toBe(200)
  expect(
    await f.t.run((ctx) => ctx.db.query("segments").collect())
  ).toHaveLength(2)
})

test("scheduled send/cancel commands and SMTP authentication replay", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    await ctx.db.patch("domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "test",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true },
    })
  })
  await f.owner.client.mutation(api.smtp.update, {
    organizationId: f.owner.team,
    enabled: true,
  })
  const at = new Date(Date.now() + 3_600_000).toISOString()
  const sent = await f.call("/emails", {
    from: "hi@mail.example.test",
    to: ["r@example.com"],
    subject: "Scheduled",
    html: "<p>H</p>",
    scheduled_at: at,
  })
  const email = (await sent.json()) as { id: string }
  const broadcast = await f.owner.client.mutation(api.broadcasts.create, {
    organizationId: f.owner.team,
    name: "B",
    subject: "S",
    html: "<p>T</p>",
    from: "hi@mail.example.test",
  })
  for (const [path, body] of [
    [`/emails/${email.id}/cancel`, {}],
    [`/broadcasts/${broadcast}/send`, { scheduled_at: at }],
    [`/broadcasts/${broadcast}/cancel`, {}],
    ["/smtp/auth", undefined],
  ] as const) {
    vi.setSystemTime(Date.now() + 1000)
    const first = await f.call(path, body)
    const text = await first.text()
    expect(first.status, text).toBe(200)
    const reservation = await f.t.run((ctx) =>
      ctx.db
        .query("apiIdempotency")
        .withIndex("by_organizationId_and_key", (q) =>
          q.eq("organizationId", f.owner.team).eq("key", path)
        )
        .unique()
    )
    expect(reservation?.response?.body).toBe(text)
    expect(await (await f.call(path, body)).text()).toBe(text)
  }
})

test("a stale attachment send deletes its uploaded files when the final mutation rejects", async () => {
  const f = await setup()
  const begun = await f.reserve()
  if (begun.kind !== "ok") throw Error("reservation failed")
  vi.setSystemTime(Date.now() + 61_000)
  await f.reserve()
  const { sendEmailBody } = await import("./api/emails")
  await expect(
    f.t.action((ctx) =>
      sendEmailBody(
        ctx,
        { ...begun.caller, idempotencyId: begun.idempotencyId },
        {
          from: "hi@mail.example.test",
          to: ["r@example.com"],
          subject: "No duplicate",
          html: "<p>H</p>",
          attachments: [{ filename: "a.txt", content: "SGVsbG8=" }],
        }
      )
    )
  ).rejects.toThrow("concurrent_idempotent_requests")
  expect(
    await f.t.run((ctx) => ctx.db.system.query("_storage").collect())
  ).toHaveLength(0)
})
