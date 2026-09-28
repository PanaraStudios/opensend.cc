/// <reference types="vite/client" />
import dns from "node:dns"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import type { WorkId } from "@convex-dev/workpool"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fixture } from "./testHelpers/ses.fixture"
import { isPublicAddress, isPublicHostname } from "../lib/net/public-host"
import { webhookSignature } from "../lib/webhooks/signing"

const PUBLIC_IP = "93.184.216.34"
let fetcher: ReturnType<typeof stubFetch>
let answer: () => Response
const stubFetch = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => answer())

beforeEach(() => {
  /* convex-test runs scheduled functions on real timers, which would let the
     pool send attempts behind a test's back; tests drive them instead. */
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
  vi.spyOn(dns.promises, "lookup").mockResolvedValue([
    { address: PUBLIC_IP, family: 4 },
  ] as never)
  answer = () => new Response("OK", { status: 200 })
  fetcher = stubFetch()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** The SES fixture plus a plain member of the owner's team. */
async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "webhookPool")
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
  return { ...f, member }
}
type Setup = Awaited<ReturnType<typeof setup>>

const createWebhook = (
  who: Setup["owner"],
  events: string[] = ["domain.created"],
  endpoint = "https://hooks.example.com/opensend",
  organizationId = who.team
) =>
  who.client.action(api.webhooks.create, { organizationId, endpoint, events })

/** An outbox event for the team, fanned out to its webhooks. */
async function deliver(f: Setup, type = "domain.created", team = f.owner.team) {
  const event = await f.t.run((ctx) =>
    ctx.db.insert("events", {
      organizationId: team,
      type,
      data: { id: "dom_1", name: "example.com" },
    })
  )
  await f.t.mutation(internal.webhooks.deliverEvent, { id: event })
  return event
}
const deliveriesOf = (f: Setup, webhookId: Id<"webhooks">) =>
  f.t.run((ctx) =>
    ctx.db
      .query("webhookDeliveries")
      .withIndex("by_webhookId", (q) => q.eq("webhookId", webhookId))
      .order("desc")
      .collect()
  )
const attempt = (f: Setup, id: Id<"webhookDeliveries">, number: number) =>
  f.t.action(internal.webhookDelivery.attempt, { id, attempt: number })
const getDelivery = (f: Setup, id: Id<"webhookDeliveries">) =>
  f.t.run(async (ctx) => (await ctx.db.get("webhookDeliveries", id))!)
const sentHeaders = (call: number) =>
  (fetcher.mock.calls[call][1] as RequestInit).headers as Record<string, string>

describe("webhook access", () => {
  test("a plain member manages webhooks; another team is refused", async () => {
    const f = await setup()
    const id = await createWebhook(f.member, undefined, undefined, f.owner.team)
    const list = await f.member.client.query(api.webhooks.list, {
      organizationId: f.owner.team,
    })
    expect(list).toHaveLength(1)
    expect(list[0]).not.toHaveProperty("secret")
    const secret = await f.member.client.query(api.webhooks.signingSecret, {
      id,
    })
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/)
    expect(atob(secret!.slice(6))).toHaveLength(24)
    const stored = await f.t.run(
      async (ctx) => (await ctx.db.get("webhooks", id))!
    )
    expect(stored.secret).not.toContain(secret!.slice(6))

    const outsider = f.outsider.client
    await expect(
      outsider.query(api.webhooks.list, { organizationId: f.owner.team })
    ).rejects.toThrow("permission")
    await expect(outsider.query(api.webhooks.get, { id })).rejects.toThrow(
      "permission"
    )
    await expect(
      outsider.query(api.webhooks.signingSecret, { id })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.webhooks.update, { id, enabled: false })
    ).rejects.toThrow("permission")
    await expect(
      outsider.action(api.webhooks.rotateSecret, { id })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.webhooks.remove, { id })
    ).rejects.toThrow("permission")
    await expect(
      createWebhook(f.outsider, undefined, undefined, f.owner.team)
    ).rejects.toThrow("permission")

    await f.member.client.mutation(api.webhooks.update, {
      id,
      endpoint: "https://hooks.example.com/v2",
      events: ["domain.updated", "domain.created", "domain.created"],
    })
    const detail = await f.member.client.query(api.webhooks.get, { id })
    expect(detail?.webhook).toMatchObject({
      endpoint: "https://hooks.example.com/v2",
      events: ["domain.created", "domain.updated"],
    })
    await deliver(f)
    const [delivery] = await deliveriesOf(f, id)
    await expect(
      outsider.query(api.webhooks.delivery, { id: delivery._id })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.webhooks.replay, { id: delivery._id })
    ).rejects.toThrow("permission")
    await f.member.client.mutation(api.webhooks.remove, { id })
    expect(await f.member.client.query(api.webhooks.get, { id })).toBeNull()
    // What `remove` scheduled, run now.
    await f.t.mutation(internal.webhooks.purgeDeliveries, { webhookId: id })
    expect(await deliveriesOf(f, id)).toHaveLength(0)
  })

  test("endpoints must be public https URLs and events must be known", async () => {
    const f = await setup()
    for (const [endpoint, message] of [
      ["http://hooks.example.com", "https://"],
      ["https://127.0.0.1/hook", "public hostname"],
      ["https://[::1]/hook", "public hostname"],
      ["https://localhost/hook", "public hostname"],
      ["https://169.254.169.254/latest/meta-data", "public hostname"],
      ["https://metadata.google.internal/", "public hostname"],
      ["https://user:pw@hooks.example.com", "credentials"],
    ])
      await expect(createWebhook(f.owner, undefined, endpoint)).rejects.toThrow(
        message
      )
    await expect(createWebhook(f.owner, [])).rejects.toThrow("at least one")
    await expect(createWebhook(f.owner, ["email.unknown"])).rejects.toThrow(
      "from the list"
    )
    const id = await createWebhook(f.owner)
    await expect(
      f.owner.client.mutation(api.webhooks.update, {
        id,
        endpoint: "https://10.0.0.1/",
      })
    ).rejects.toThrow("public hostname")
  })
})

describe("signing", () => {
  test("matches Svix's reference vector", async () => {
    expect(
      await webhookSignature({
        id: "msg_loFOjxBNrRLzqYUf",
        timestamp: 1731705121,
        body: '{"event_type":"ping","data":{"success":true}}',
        secret: "whsec_plJ3nmyCDGBKInavdOK15jsl",
      })
    ).toBe("v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=")
  })

  test("a delivery carries Svix headers signed with the webhook's secret", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    const event = await deliver(f)
    const [delivery] = await deliveriesOf(f, id)
    await attempt(f, delivery._id, 0)
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe("https://hooks.example.com/opensend")
    expect(init.redirect).toBe("manual")
    const headers = sentHeaders(0)
    expect(headers["svix-id"]).toBe(`msg_${event}`)
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      type: "domain.created",
      data: { id: "dom_1", name: "example.com" },
    })
    expect(new Date(body.created_at).toISOString()).toBe(body.created_at)
    const secret = await f.owner.client.query(api.webhooks.signingSecret, {
      id,
    })
    expect(headers["svix-signature"]).toBe(
      await webhookSignature({
        id: headers["svix-id"],
        timestamp: Number(headers["svix-timestamp"]),
        body: init.body as string,
        secret: secret!,
      })
    )
  })

  test("rotating replaces the secret at once", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    const before = await f.owner.client.query(api.webhooks.signingSecret, {
      id,
    })
    await f.member.client.action(api.webhooks.rotateSecret, { id })
    const after = await f.owner.client.query(api.webhooks.signingSecret, {
      id,
    })
    expect(after).not.toBe(before)
    await deliver(f)
    const [delivery] = await deliveriesOf(f, id)
    expect(
      (
        await f.t.mutation(internal.webhooks.claimAttempt, {
          id: delivery._id,
          attempt: 0,
        })
      )?.secret
    ).toBe(after)
    await attempt(f, delivery._id, 0)
    const headers = sentHeaders(0)
    const [, init] = fetcher.mock.calls[0] as [URL, RequestInit]
    expect(headers["svix-signature"]).toBe(
      await webhookSignature({
        id: headers["svix-id"],
        timestamp: Number(headers["svix-timestamp"]),
        body: init.body as string,
        secret: after!,
      })
    )
  })
})

describe("delivery", () => {
  test("goes only to the event's team's enabled webhooks subscribed to it", async () => {
    const f = await setup()
    const listening = await createWebhook(f.owner, [
      "domain.created",
      "domain.deleted",
    ])
    const other = await createWebhook(f.owner, ["email.sent"])
    const disabled = await createWebhook(f.owner)
    await f.owner.client.mutation(api.webhooks.update, {
      id: disabled,
      enabled: false,
    })
    const foreign = await createWebhook(f.outsider)
    await deliver(f)
    expect(await deliveriesOf(f, listening)).toHaveLength(1)
    for (const id of [other, disabled, foreign])
      expect(await deliveriesOf(f, id)).toHaveLength(0)
    await f.owner.client.mutation(api.webhooks.update, {
      id: disabled,
      enabled: true,
    })
    await deliver(f)
    expect(await deliveriesOf(f, disabled)).toHaveLength(1)
  })

  test("the outbox hands a domain event to the pool, which delivers it", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    await f.owner.client.mutation(api.domains.create, {
      organizationId: f.owner.team,
      name: "new.example.test",
      region: "us-east-1",
      customReturnPath: "send",
    })
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    const [delivery] = await deliveriesOf(f, id)
    expect(delivery).toMatchObject({
      event: "domain.created",
      status: 200,
      failed: false,
      attempts: 1,
      response: "OK",
    })
    expect(delivery.payload.data).toMatchObject({
      name: "new.example.test",
      region: "us-east-1",
      capabilities: { sending: "enabled", receiving: "disabled" },
    })
    expect(await f.owner.client.query(api.webhooks.get, { id })).toMatchObject({
      deliveries: 1,
      failed: 0,
      delivered: ["domain.created"],
    })
  })

  test("retries on Svix's schedule and stops on success", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    await deliver(f)
    const [{ _id }] = await deliveriesOf(f, id)
    answer = () => new Response("nope", { status: 500 })
    const start = Date.now()
    await attempt(f, _id, 0)
    let row = await getDelivery(f, _id)
    expect(row).toMatchObject({ status: 500, failed: true, attempts: 1 })
    expect(row.nextAttemptAt! - start).toBeGreaterThanOrEqual(5000)
    expect(row.nextAttemptAt! - start).toBeLessThan(60000)
    // A stale attempt number is never sent twice.
    await attempt(f, _id, 0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    // A redirect is a failure and is not followed.
    answer = () =>
      new Response("moved", {
        status: 302,
        headers: { location: "https://169.254.169.254/" },
      })
    await attempt(f, _id, 1)
    row = await getDelivery(f, _id)
    expect(row).toMatchObject({ status: 302, failed: true, attempts: 2 })
    expect(row.nextAttemptAt! - Date.now()).toBeGreaterThan(4 * 60000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    answer = () => new Response(null, { status: 204 })
    await attempt(f, _id, 2)
    row = await getDelivery(f, _id)
    expect(row).toMatchObject({ status: 204, failed: false, attempts: 3 })
    expect(row.nextAttemptAt).toBeUndefined()
    expect(await f.owner.client.query(api.webhooks.get, { id })).toMatchObject({
      deliveries: 1,
      failed: 0,
    })
  })

  test("gives up after the last scheduled attempt", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    await deliver(f)
    const [{ _id }] = await deliveriesOf(f, id)
    answer = () => new Response("x".repeat(10000), { status: 503 })
    for (let n = 0; n < 8; n++) await attempt(f, _id, n)
    const row = await getDelivery(f, _id)
    expect(row).toMatchObject({ attempts: 8, failed: true })
    expect(row.nextAttemptAt).toBeUndefined()
    expect(row.response).toHaveLength(4096)
  })

  test("disabling or deleting the webhook stops its retries", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    await deliver(f)
    const [{ _id }] = await deliveriesOf(f, id)
    answer = () => new Response("down", { status: 500 })
    await attempt(f, _id, 0)
    await f.owner.client.mutation(api.webhooks.update, { id, enabled: false })
    await attempt(f, _id, 1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const stopped = await getDelivery(f, _id)
    expect(stopped.attempts).toBe(1)
    expect(stopped.nextAttemptAt).toBeUndefined()

    const gone = await createWebhook(f.owner)
    await deliver(f)
    const [pending] = await deliveriesOf(f, gone)
    await f.owner.client.mutation(api.webhooks.remove, { id: gone })
    await attempt(f, pending._id, 0)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test("a host resolving to a private address is never fetched", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    await deliver(f)
    const [{ _id }] = await deliveriesOf(f, id)
    vi.mocked(dns.promises.lookup).mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: "169.254.169.254", family: 4 },
    ] as never)
    await attempt(f, _id, 0)
    expect(fetcher).not.toHaveBeenCalled()
    expect(await getDelivery(f, _id)).toMatchObject({
      status: 0,
      failed: true,
      attempts: 1,
      response: expect.stringContaining("private network"),
    })
  })

  test("an attempt whose action crashed still counts and is retried", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    await deliver(f)
    const [{ _id }] = await deliveriesOf(f, id)
    await f.t.mutation(internal.webhooks.attemptDone, {
      workId: "work" as WorkId,
      context: { id: _id, attempt: 0 },
      result: { kind: "failed", error: "Action crashed" },
    })
    const row = await getDelivery(f, _id)
    expect(row).toMatchObject({
      status: 0,
      attempts: 1,
      response: "Action crashed",
    })
    expect(row.nextAttemptAt).toBeDefined()
  })

  test("a timeout is a failed attempt with a reason", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    await deliver(f)
    const [{ _id }] = await deliveriesOf(f, id)
    fetcher.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "TimeoutError" })
    )
    await attempt(f, _id, 0)
    expect(await getDelivery(f, _id)).toMatchObject({
      status: 0,
      response: "No response within 15 seconds",
    })
  })

  test("an endpoint failing for five days is disabled", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    answer = () => new Response("down", { status: 500 })
    await deliver(f)
    const [first] = await deliveriesOf(f, id)
    await attempt(f, first._id, 0)
    vi.setSystemTime(Date.now() + 5 * 24 * 3600000)
    await deliver(f)
    const [second] = await deliveriesOf(f, id)
    await attempt(f, second._id, 0)
    // Sessions have expired by now, so read the rows directly.
    const webhook = await f.t.run((ctx) => ctx.db.get("webhooks", id))
    expect(webhook?.enabled).toBe(false)
    expect((await getDelivery(f, second._id)).nextAttemptAt).toBeUndefined()
    await deliver(f)
    expect(await deliveriesOf(f, id)).toHaveLength(2)
  })
})

describe("replay", () => {
  test("re-sends the same message once, and is refused while disabled", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    await deliver(f)
    const [source] = await deliveriesOf(f, id)
    await f.owner.client.mutation(api.webhooks.update, { id, enabled: false })
    await expect(
      f.member.client.mutation(api.webhooks.replay, { id: source._id })
    ).rejects.toThrow("Enable the webhook")
    await f.owner.client.mutation(api.webhooks.update, { id, enabled: true })
    const replayed = await f.member.client.mutation(api.webhooks.replay, {
      id: source._id,
    })
    expect(await getDelivery(f, replayed)).toMatchObject({
      messageId: source.messageId,
      payload: source.payload,
      replay: true,
      attempts: 0,
    })
    answer = () => new Response("down", { status: 500 })
    await attempt(f, replayed, 0)
    expect((await getDelivery(f, replayed)).nextAttemptAt).toBeUndefined()
    expect(sentHeaders(0)["svix-id"]).toBe(source.messageId)
  })
})

describe("domain events", () => {
  test("are emitted when a domain is created, updated and deleted", async () => {
    const f = await setup()
    await f.owner.client.mutation(api.domains.create, {
      organizationId: f.owner.team,
      name: "events.example.test",
      region: "us-east-1",
      customReturnPath: "send",
    })
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      sending: false,
    })
    await f.t.mutation(internal.domains.finish, {
      id: f.domain,
      changes: { deleted: true },
    })
    const events = await f.t.run((ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_organizationId_and_type", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .collect()
    )
    const byType = Object.fromEntries(events.map((e) => [e.type, e.data]))
    expect(byType["domain.created"]).toMatchObject({
      name: "events.example.test",
      status: "pending",
      region: "us-east-1",
    })
    expect(new Date(byType["domain.created"].created_at).toISOString()).toBe(
      byType["domain.created"].created_at
    )
    expect(byType["domain.updated"]).toMatchObject({
      name: "mail.example.test",
      capabilities: { sending: "disabled" },
    })
    expect(byType["domain.deleted"]).toMatchObject({ id: f.domain })
  })
})

describe("retention", () => {
  test("drops deliveries and events older than 90 days", async () => {
    const f = await setup()
    const id = await createWebhook(f.owner)
    const old = await deliver(f)
    vi.setSystemTime(Date.now() + 91 * 24 * 3600000)
    const fresh = await deliver(f)
    await f.t.mutation(internal.webhooks.cleanup, {})
    const left = await deliveriesOf(f, id)
    expect(left).toHaveLength(1)
    expect(left[0].messageId).toBe(`msg_${fresh}`)
    expect(await f.t.run((ctx) => ctx.db.get("events", old))).toBeNull()
    const stats = await f.t.run((ctx) =>
      ctx.db
        .query("webhookStats")
        .withIndex("by_webhookId", (q) => q.eq("webhookId", id))
        .unique()
    )
    expect(stats).toMatchObject({ deliveries: 1, failed: 1 })
  })
})

describe("public addresses", () => {
  test("only globally routable addresses and public names pass", () => {
    for (const ip of ["8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"])
      expect(isPublicAddress(ip), ip).toBe(true)
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.4",
      "192.168.1.1",
      "169.254.169.254",
      "100.100.100.200",
      "0.0.0.0",
      "::1",
      "::",
      "::ffff:127.0.0.1",
      "fd00:ec2::254",
      "fe80::1",
      "2002:7f00:1::",
      "64:ff9b::a9fe:a9fe",
      "not-an-ip",
    ])
      expect(isPublicAddress(ip), ip).toBe(false)
    expect(isPublicHostname("hooks.example.com")).toBe(true)
    for (const host of [
      "localhost",
      "intranet",
      "127.0.0.1",
      "[::1]",
      "a.local",
    ])
      expect(isPublicHostname(host), host).toBe(false)
  })
})
