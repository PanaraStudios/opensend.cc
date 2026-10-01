import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow, deleteRow } from "./counts"
import { MAX_SHARE_AGE, shareDuration } from "./emailShares"
import { tokenHash } from "../lib/oauth/policy"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubEnv("BETTER_AUTH_SECRET", "email-share-test-secret")
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected network"))
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function setup() {
  const f = await fixture()
  const member = await f.actor("share-member")
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
  const ids = await f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["attachment"]))
    const sent = await insertRow(ctx, "emails", {
      organizationId: f.owner.team,
      domainId: f.domain,
      from: "sender@example.test",
      to: ["to@example.test"],
      bcc: ["private@example.test"],
      cc: ["cc@example.test"],
      replyTo: ["reply@example.test"],
      subject: "Shared subject",
      status: "sent",
      source: "api",
      generation: 1,
      attempts: 1,
      search: "shared",
      sentAt: Date.now(),
    })
    await ctx.db.insert("emailContents", {
      emailId: sent,
      html: "<p>Shared body</p>",
      text: "Shared body",
      headers: [{ name: "X-Internal", value: "private" }],
      attachments: [
        {
          filename: "notes.txt",
          contentType: "text/plain",
          size: 10,
          storageId,
        },
      ],
    })
    const inboundId = await ctx.db.insert("inboundMessages", {
      organizationId: f.owner.team,
      domainId: f.domain,
      region: "us-east-1",
      messageId: "share-inbound",
      topicArn: "test",
      sesMessageId: "test",
      bucket: "test",
      objectKey: "test",
      notification: "",
    })
    const received = await insertRow(ctx, "receivedEmails", {
      organizationId: f.owner.team,
      domainId: f.domain,
      inboundId,
      rawId: storageId,
      from: "received@example.test",
      sender: "received@example.test",
      to: ["to@example.test"],
      cc: [],
      bcc: ["private@example.test"],
      replyTo: [],
      subject: "Shared received",
      messageId: "received-id",
      receivedFor: ["private@example.test"],
      authentication: { spf: "pass" },
      receivedAt: Date.now(),
      expiresAt: Date.now() + 30 * 86_400_000,
    })
    await ctx.db.insert("receivedContents", {
      emailId: received,
      html: "<p>Received body</p>",
      text: "Received body",
      headers: { "X-Internal": "private" },
    })
    await ctx.db.insert("receivedAttachments", {
      emailId: received,
      storageId,
      filename: "notes.txt",
      contentType: "text/plain",
      size: 10,
      contentId: null,
      contentDisposition: "attachment",
    })
    return { sent, received }
  })
  const key = (
    permission: "full_access" | "sending_access" = "full_access",
    actor = f.owner
  ) =>
    actor.client.action(api.apiKeys.create, {
      organizationId: actor.team,
      input: { name: "Share", permission, domainId: null },
    })
  const { token } = await key()
  const post = (
    id: string,
    body?: unknown,
    bearer = token,
    idempotencyKey?: string
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(`/emails/${id}/share`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  return { ...f, ...ids, member, key, post }
}
const tokenFrom = (url: string) => new URL(url).searchParams.get("token")!

for (const [value, duration] of [
  [undefined, MAX_SHARE_AGE],
  ["10m", 600000],
  ["2 hours", 7200000],
  ["1 day", 86400000],
  ["48h", MAX_SHARE_AGE],
  ["0.5h", 1800000],
  ["30 seconds", 30000],
] as const)
  test(`duration ${value} is supported`, () =>
    expect(shareDuration(value)).toBe(duration))

for (const value of [
  "49h",
  "3 days",
  "0m",
  "-1h",
  "nonsense",
  "",
  "1h 30m",
  "Infinityh",
  48,
  null,
  {},
  "0.0001ms",
])
  test(`rejects duration ${JSON.stringify(value)}`, async () => {
    const f = await setup()
    const response = await f.post(f.sent, { expires_in: value })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      name: "validation_error",
      statusCode: 422,
    })
    expect(
      await f.t.run((ctx) => ctx.db.query("emailShares").first())
    ).toBeNull()
  })

for (const kind of ["sent", "received"] as const)
  test(`a plain member shares ${kind} mail; public projection and hash-only storage`, async () => {
    const f = await setup()
    const result = await f.member.client.mutation(api.emailShares.create, {
      organizationId: f.owner.team,
      id: f[kind],
    })
    const token = tokenFrom(result.url)
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    const row = (await f.t.run((ctx) => ctx.db.query("emailShares").first()))!
    expect(row.tokenHash).toBe(await tokenHash(token))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(row.expiresAt).toBe(Date.now() + MAX_SHARE_AGE)
    const email = await f.t.action(api.emailShares.view, { token })
    expect(email).toMatchObject({
      subject: kind === "sent" ? "Shared subject" : "Shared received",
      attachments: [
        { filename: "notes.txt", contentType: "text/plain", size: 10 },
      ],
    })
    expect(Object.keys(email!).sort()).toEqual(
      [
        "subject",
        "from",
        "to",
        "cc",
        "replyTo",
        "date",
        "expiresAt",
        "html",
        "text",
        "attachments",
      ].sort()
    )
    expect(JSON.stringify(email)).not.toContain("private")
    expect(JSON.stringify(email)).not.toContain(f[kind])
    expect(
      await f.t.action(api.emailShares.view, { token: "f".repeat(64) })
    ).toBeNull()
    expect(await f.t.action(api.emailShares.view, { token: "bad" })).toBeNull()
    vi.setSystemTime(row.expiresAt)
    expect(await f.t.action(api.emailShares.view, { token })).toBeNull()
  })

test("another member cannot share a foreign team's email", async () => {
  const f = await setup()
  await expect(
    f.outsider.client.mutation(api.emailShares.create, {
      organizationId: f.owner.team,
      id: f.sent,
    })
  ).rejects.toThrow(/permission/i)
  await expect(
    f.outsider.client.mutation(api.emailShares.create, {
      organizationId: f.outsider.team,
      id: f.sent,
    })
  ).rejects.toThrow(/not found/i)
  await expect(
    f.t.mutation(api.emailShares.create, {
      organizationId: f.owner.team,
      id: f.sent,
    })
  ).rejects.toThrow(/sign in/i)
})

test("REST supports both email types, defaults, full-access permissions, and foreign 404", async () => {
  const f = await setup()
  for (const id of [f.sent, f.received]) {
    const response = await f.post(id)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      object: "email",
      id,
      url: expect.stringMatching(
        /^https:\/\/opensend.test\/shared\?token=[a-f0-9]{64}$/
      ),
    })
    expect(
      await f.t.action(api.emailShares.view, { token: tokenFrom(data.url) })
    ).not.toBeNull()
  }
  const sending = await f.key("sending_access")
  expect((await f.post(f.sent, {}, sending.token)).status).toBe(403)
  const outsider = await f.key("full_access", f.outsider)
  for (const id of [f.sent, f.received, "not-an-id"])
    expect((await f.post(id, {}, outsider.token)).status).toBe(404)
})

test("idempotency replays one link without persisting the bearer in cache or logs", async () => {
  const f = await setup()
  const first = await f.post(
    f.sent,
    { expires_in: "2 hours" },
    undefined,
    "share-once"
  )
  expect(first.status).toBe(200)
  const body = await first.json()
  const again = await f.post(
    f.sent,
    { expires_in: "2 hours" },
    undefined,
    "share-once"
  )
  expect(await again.json()).toEqual(body)
  const changed = await f.post(
    f.sent,
    { expires_in: "1 day" },
    undefined,
    "share-once"
  )
  expect(changed.status).toBe(409)
  expect(await changed.json()).toMatchObject({
    name: "invalid_idempotent_request",
  })
  const saved = await f.t.run(async (ctx) => ({
    shares: await ctx.db.query("emailShares").take(10),
    cache: await ctx.db.query("apiIdempotency").take(10),
    logs: await ctx.db.query("apiLogBodies").take(10),
  }))
  expect(saved.shares).toHaveLength(1)
  expect(JSON.stringify(saved)).not.toContain(tokenFrom(body.url))
  expect(saved.logs.every((log) => log.responseBody === "[redacted]")).toBe(
    true
  )
})

for (const kind of ["sent", "received"] as const)
  test(`deleting ${kind} mail immediately kills its link`, async () => {
    const f = await setup()
    const result = await f.owner.client.mutation(api.emailShares.create, {
      organizationId: f.owner.team,
      id: f[kind],
    })
    await f.t.run((ctx) =>
      kind === "sent"
        ? deleteRow(ctx, "emails", f.sent)
        : deleteRow(ctx, "receivedEmails", f.received)
    )
    expect(
      await f.t.action(api.emailShares.view, { token: tokenFrom(result.url) })
    ).toBeNull()
  })

for (const deleted of [false, true])
  test(`${deleted ? "deleting" : "retiring"} a team immediately kills its links`, async () => {
    const f = await setup()
    const result = await f.owner.client.mutation(api.emailShares.create, {
      organizationId: f.owner.team,
      id: f.sent,
    })
    if (deleted)
      await f.t.mutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: "organization",
          where: [{ field: "_id", value: f.owner.team }],
        },
      })
    else
      await f.t.run((ctx) =>
        ctx.db.insert("teamRetirements", { teamId: f.owner.team })
      )
    expect(
      await f.t.action(api.emailShares.view, { token: tokenFrom(result.url) })
    ).toBeNull()
  })

test("prunes expired tokens in bounded batches and preserves active links", async () => {
  const f = await setup()
  const active = await f.owner.client.mutation(api.emailShares.create, {
    organizationId: f.owner.team,
    id: f.sent,
  })
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 205; i++)
      await ctx.db.insert("emailShares", {
        organizationId: f.owner.team,
        emailId: f.sent,
        tokenHash: String(i),
        expiresAt: Date.now() - 1,
      })
  })
  for (let i = 0; i < 3; i++)
    await f.t.mutation(internal.retention.emailShares, {})
  expect(
    await f.t.run((ctx) => ctx.db.query("emailShares").take(300))
  ).toHaveLength(1)
  expect(
    await f.t.action(api.emailShares.view, { token: tokenFrom(active.url) })
  ).not.toBeNull()
})

test("email retention expiry is enforced before cron deletion and caps the public expiry", async () => {
  const f = await setup()
  const result = await f.owner.client.mutation(api.emailShares.create, {
    organizationId: f.owner.team,
    id: f.received,
  })
  const expiresAt = Date.now() + 60_000
  await f.t.run((ctx) =>
    ctx.db.patch("receivedEmails", f.received, { expiresAt })
  )
  const token = tokenFrom(result.url)
  expect(await f.t.action(api.emailShares.view, { token })).toMatchObject({
    expiresAt,
  })
  vi.setSystemTime(expiresAt)
  expect(await f.t.action(api.emailShares.view, { token })).toBeNull()
  expect((await f.post(f.received)).status).toBe(404)
})

test("new links are independent and missing content fails closed", async () => {
  const f = await setup()
  const args = { organizationId: f.owner.team, id: f.sent }
  const first = await f.owner.client.mutation(api.emailShares.create, args)
  const second = await f.owner.client.mutation(api.emailShares.create, args)
  expect(first.url).not.toBe(second.url)
  for (const link of [first, second])
    expect(
      await f.t.action(api.emailShares.view, { token: tokenFrom(link.url) })
    ).not.toBeNull()
  await f.t.run(async (ctx) => {
    const content = (await ctx.db
      .query("emailContents")
      .withIndex("by_emailId", (q) => q.eq("emailId", f.sent))
      .unique())!
    await ctx.db.delete("emailContents", content._id)
  })
  expect(
    await f.t.action(api.emailShares.view, { token: tokenFrom(first.url) })
  ).toBeNull()
})
