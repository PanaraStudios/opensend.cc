import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow } from "./counts"
import { webhookSignature } from "../lib/webhooks/signing"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected network"))
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "webhookPool")
  const member = await f.actor("rest-member")
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
  const key = await member.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "REST", permission: "full_access", domainId: null },
  })
  const other = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Other", permission: "full_access", domainId: null },
  })
  const sending = await member.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Send", permission: "sending_access", domainId: null },
  })
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    token = key.token,
    idem?: string
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    const response = await f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(idem ? { "Idempotency-Key": idem } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }
  const webhook = () =>
    call("/webhooks", "POST", {
      endpoint: "https://hooks.example.com/events",
      events: ["email.sent", "suppression.added", "suppression.removed"],
    })
  const delivery = async (id: string) => {
    const event = await f.t.run((ctx) =>
      ctx.db.insert("events", {
        organizationId: f.owner.team,
        type: "email.sent",
        data: { email_id: "mail" },
      })
    )
    await f.t.mutation(internal.webhooks.deliverEvent, { id: event })
    return f.t.run(
      async (ctx) =>
        (await ctx.db
          .query("webhookDeliveries")
          .withIndex("by_webhookId", (q) =>
            q.eq("webhookId", id as Id<"webhooks">)
          )
          .order("desc")
          .first())!
    )
  }
  return { ...f, member, key, other, sending, call, webhook, delivery }
}

describe("webhook REST parity", () => {
  test("plain member CRUD, create idempotency, signing secret on create, retrieve and rotate, newest-first paging", async () => {
    const f = await setup()
    const input = {
      endpoint: "https://hooks.example.com/events",
      events: ["email.sent"],
    }
    const first = await f.call(
      "/webhooks",
      "POST",
      input,
      f.key.token,
      "create"
    )
    expect(first.status).toBe(201)
    expect(first.body).toEqual({
      object: "webhook",
      id: expect.any(String),
      signing_secret: expect.stringMatching(/^whsec_/),
    })
    expect(
      await f.call("/webhooks", "POST", input, f.key.token, "create")
    ).toEqual(first)
    const second = await f.webhook()
    const page = await f.call("/webhooks?limit=1")
    expect(page.body).toMatchObject({
      object: "list",
      has_more: true,
      data: [{ id: second.body.id }],
    })
    expect(page.body.data[0]).not.toHaveProperty("signing_secret")
    expect(
      (await f.call(`/webhooks?after=${second.body.id}`)).body.data.map(
        (x: { id: string }) => x.id
      )
    ).toEqual([first.body.id])
    expect(
      (await f.call(`/webhooks?before=${first.body.id}`)).body.data[0].id
    ).toBe(second.body.id)
    const url = `/webhooks/${first.body.id}`
    expect((await f.call(url)).body).toMatchObject({
      object: "webhook",
      status: "enabled",
      events: ["email.sent"],
    })
    // Resend returns the signing secret with a single webhook, not in lists.
    expect((await f.call(url)).body.signing_secret).toBe(
      first.body.signing_secret
    )
    expect(
      (
        await f.call(url, "PATCH", {
          status: "disabled",
          events: ["suppression.added"],
        })
      ).body
    ).toEqual({ object: "webhook", id: first.body.id })
    expect((await f.call(url)).body.status).toBe("disabled")
    expect((await f.call(url, "DELETE")).body).toEqual({
      object: "webhook",
      id: first.body.id,
      deleted: true,
    })
    expect((await f.call(url)).status).toBe(404)
  })
  test("rotation replays its response and overlaps signatures for exactly 24 hours", async () => {
    const f = await setup()
    const { body: created } = await f.webhook()
    const path = `/webhooks/${created.id}/signing-secret/rotate`
    const rotated = await f.call(path, "POST", undefined, f.key.token, "rotate")
    expect(rotated.status).toBe(200)
    expect(rotated.body.signing_secret).not.toBe(created.signing_secret)
    expect(
      await f.call(path, "POST", undefined, f.key.token, "rotate")
    ).toEqual(rotated)
    const logs = await f.t.run((ctx) =>
      ctx.db
        .query("apiLogs")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .take(100)
    )
    for (const log of logs.filter(
      (log) =>
        log.method === "POST" && (log.path === "/webhooks" || log.path === path)
    )) {
      const body = await f.t.run((ctx) =>
        ctx.db
          .query("apiLogBodies")
          .withIndex("by_logId", (q) => q.eq("logId", log._id))
          .unique()
      )
      expect(JSON.parse(body!.responseBody!).signing_secret).toBe("[redacted]")
    }
    const delivery = await f.delivery(created.id)
    const target = await f.t.mutation(internal.webhooks.claimAttempt, {
      id: delivery._id,
      attempt: 0,
    })
    expect(target).toMatchObject({
      secret: rotated.body.signing_secret,
      previousSecret: created.signing_secret,
    })
    const input = {
      id: "event",
      timestamp: 123,
      body: "{}",
      secret: target!.secret,
      previousSecret: target!.previousSecret,
    }
    expect((await webhookSignature(input)).split(" ")).toEqual([
      await webhookSignature({ ...input, previousSecret: undefined }),
      await webhookSignature({
        ...input,
        secret: created.signing_secret,
        previousSecret: undefined,
      }),
    ])
    vi.setSystemTime(Date.now() + 24 * 3600_000)
    expect(
      await f.t.mutation(internal.webhooks.claimAttempt, {
        id: delivery._id,
        attempt: 0,
      })
    ).not.toHaveProperty("previousSecret")
  })
  test("event projections, real attempt history, cursor pagination and replay keep the original event and retry schedule", async () => {
    const f = await setup()
    const { body: hook } = await f.webhook()
    const delivery = await f.delivery(hook.id)
    const base = `/webhooks/${hook.id}/events`
    expect((await f.call(base)).body.data[0]).toMatchObject({
      id: delivery._id,
      type: "email.sent",
      status: "pending",
    })
    const target = await f.t.mutation(internal.webhooks.claimAttempt, {
      id: delivery._id,
      attempt: 0,
    })
    expect(target).not.toBeNull()
    expect((await f.call(`${base}/${delivery._id}`)).body.status).toBe(
      "attempting"
    )
    await f.t.mutation(internal.webhooks.recordAttempt, {
      id: delivery._id,
      attempt: 0,
      status: 503,
      durationMs: 25,
      response: "Unavailable",
    })
    vi.setSystemTime(Date.now() + 6000)
    await f.t.mutation(internal.webhooks.claimAttempt, {
      id: delivery._id,
      attempt: 1,
    })
    await f.t.mutation(internal.webhooks.recordAttempt, {
      id: delivery._id,
      attempt: 1,
      status: 200,
      durationMs: 10,
      response: "OK",
    })
    // Stale completion cannot duplicate history.
    await f.t.mutation(internal.webhooks.recordAttempt, {
      id: delivery._id,
      attempt: 1,
      status: 200,
      durationMs: 10,
      response: "OK",
    })
    const attemptsUrl = `${base}/${delivery._id}/attempts`
    const attempts = (await f.call(`${attemptsUrl}?limit=1`)).body
    expect(attempts).toMatchObject({
      has_more: true,
      data: [
        { http_status_code: 200, response: "OK", sent_at: expect.any(String) },
      ],
    })
    expect(
      (await f.call(`${attemptsUrl}?after=${attempts.data[0].id}`)).body
    ).toMatchObject({ has_more: false, data: [{ http_status_code: 503 }] })
    expect((await f.call(`${base}/${delivery._id}`)).body).toMatchObject({
      object: "webhook_event",
      status: "success",
      next_attempt_at: null,
      payload: delivery.payload,
    })
    const replay = await f.call(
      `${base}/${delivery._id}/replay`,
      "POST",
      undefined,
      f.key.token,
      "replay"
    )
    expect(replay.body).toEqual({ object: "webhook_event", id: delivery._id })
    expect(
      await f.call(
        `${base}/${delivery._id}/replay`,
        "POST",
        undefined,
        f.key.token,
        "replay"
      )
    ).toEqual(replay)
    const rows = await f.t.run((ctx) =>
      ctx.db
        .query("webhookDeliveries")
        .withIndex("by_webhookId", (q) => q.eq("webhookId", hook.id))
        .take(10)
    )
    expect(rows).toHaveLength(2)
    const replayed = rows.find((x) => x.replay)!
    expect(replayed).toMatchObject({
      originalDeliveryId: delivery._id,
      messageId: delivery.messageId,
    })
    await f.t.mutation(internal.webhooks.recordAttempt, {
      id: replayed._id,
      attempt: 0,
      status: 500,
      durationMs: 5,
      response: "Replay failed",
    })
    expect((await f.call(attemptsUrl)).body.data).toHaveLength(3)
    expect((await f.call(base)).body.data).toHaveLength(1)
    const second = await f.delivery(hook.id)
    expect((await f.call(`${base}?limit=1`)).body.has_more).toBe(true)
    expect((await f.call(`${base}?after=${second._id}`)).body.data[0].id).toBe(
      delivery._id
    )
    expect((await f.call(`${base}?before=${second._id}`)).status).toBe(422)
    expect((await f.call(`${attemptsUrl}?before=invalid`)).status).toBe(422)
    await f.call(`/webhooks/${hook.id}`, "PATCH", { status: "disabled" })
    expect(
      await f.call(`${base}/${delivery._id}/replay`, "POST")
    ).toMatchObject({ status: 422, body: { name: "validation_error" } })
  })
  test("manual replay updates event status, preserves retry time and purges its history on deletion", async () => {
    const f = await setup()
    const { body: hook } = await f.webhook()
    const delivery = await f.delivery(hook.id)
    await f.t.mutation(internal.webhooks.recordAttempt, {
      id: delivery._id,
      attempt: 0,
      status: 500,
      durationMs: 1,
      response: "Fail",
    })
    const path = `/webhooks/${hook.id}/events/${delivery._id}`
    const before = (await f.call(path)).body
    expect(before.status).toBe("attempting")
    await f.call(`${path}/replay`, "POST")
    const replayed = await f.t.run((ctx) =>
      ctx.db
        .query("webhookDeliveries")
        .withIndex("by_webhookId_and_replay", (q) =>
          q.eq("webhookId", hook.id).eq("replay", true)
        )
        .first()
    )
    await f.t.mutation(internal.webhooks.recordAttempt, {
      id: replayed!._id,
      attempt: 0,
      status: 200,
      durationMs: 2,
      response: "OK",
    })
    expect((await f.call(path)).body).toMatchObject({
      status: "success",
      next_attempt_at: null,
    })
    const original = await f.t.run((ctx) =>
      ctx.db.get("webhookDeliveries", delivery._id)
    )
    expect(new Date(original!.nextAttemptAt!).toISOString()).toBe(
      before.next_attempt_at
    )
    expect((await f.call(`${path}/attempts`)).body.data).toHaveLength(2)
    await f.call(`/webhooks/${hook.id}`, "DELETE")
    await f.t.mutation(internal.webhooks.purgeDeliveries, {
      webhookId: hook.id,
    })
    expect(
      await f.t.run((ctx) =>
        ctx.db
          .query("webhookAttempts")
          .withIndex("by_webhookId", (q) => q.eq("webhookId", hook.id))
          .take(10)
      )
    ).toEqual([])
    expect((await f.call(path)).status).toBe(404)
  })

  test("every id route isolates teams and nested ids, every operation refuses sending keys", async () => {
    const f = await setup()
    const { body: hook } = await f.webhook()
    const { body: second } = await f.webhook()
    const delivery = await f.delivery(hook.id)
    const routes: [string, string, unknown?][] = [
      [
        "/webhooks",
        "POST",
        { endpoint: "https://example.com", events: ["email.sent"] },
      ],
      ["/webhooks", "GET"],
      [`/webhooks/${hook.id}`, "GET"],
      [`/webhooks/${hook.id}`, "PATCH", {}],
      [`/webhooks/${hook.id}`, "DELETE"],
      [`/webhooks/${hook.id}/signing-secret/rotate`, "POST"],
      [`/webhooks/${hook.id}/events`, "GET"],
      [`/webhooks/${hook.id}/events/${delivery._id}`, "GET"],
      [`/webhooks/${hook.id}/events/${delivery._id}/replay`, "POST"],
      [`/webhooks/${hook.id}/events/${delivery._id}/attempts`, "GET"],
    ]
    for (const [path, method, body] of routes) {
      expect(await f.call(path, method, body, f.sending.token)).toMatchObject({
        status: 401,
        body: { name: "restricted_api_key" },
      })
      if (path !== "/webhooks")
        expect(await f.call(path, method, body, f.other.token)).toMatchObject({
          status: 404,
          body: { name: "not_found" },
        })
    }
    for (const suffix of ["", "/attempts", "/replay"])
      expect(
        (
          await f.call(
            `/webhooks/${second.id}/events/${delivery._id}${suffix}`,
            suffix === "/replay" ? "POST" : "GET"
          )
        ).status
      ).toBe(404)
    expect(
      (
        await f.call(
          `/webhooks?after=${hook.id}`,
          "GET",
          undefined,
          f.other.token
        )
      ).status
    ).toBe(422)
    await expect(
      f.outsider.client.mutation(api.webhooks.update, {
        id: hook.id,
        enabled: false,
      })
    ).rejects.toThrow("permission")
  })
  test.each([
    [{}, "missing_required_field"],
    [{ endpoint: "https://example.com" }, "missing_required_field"],
    [
      { endpoint: "http://127.0.0.1", events: ["email.sent"] },
      "validation_error",
    ],
    [
      { endpoint: "https://example.com", events: ["invalid"] },
      "validation_error",
    ],
    [{ endpoint: "https://example.com", events: [] }, "validation_error"],
    [{ endpoint: "https://example.com", events: 3 }, "validation_error"],
  ])("validates webhook body %j", async (body, name) => {
    const f = await setup()
    expect(await f.call("/webhooks", "POST", body)).toMatchObject({
      status: 422,
      body: { name },
    })
  })
})

describe("suppression REST parity", () => {
  test("id/email CRUD, normalized addresses, source origins, shared events and tenant cleanup", async () => {
    const f = await setup()
    const added = await f.call(
      "/suppressions",
      "POST",
      { email: "  ADA+tag@Example.com " },
      f.key.token,
      "add"
    )
    expect(added.status).toBe(201)
    const id = added.body.id
    expect(
      await f.call(
        "/suppressions",
        "POST",
        { email: "  ADA+tag@Example.com " },
        f.key.token,
        "add"
      )
    ).toEqual(added)
    expect((await f.call(`/suppressions/${id}`)).body).toMatchObject({
      object: "suppression",
      id,
      email: "ada+tag@example.com",
      origin: "manual",
      source_id: null,
    })
    expect(
      (await f.call("/suppressions/ADA%2Btag%40example.com")).body.id
    ).toBe(id)
    const sourceId = await f.t.run((ctx) =>
      insertRow(ctx, "emails", {
        organizationId: f.owner.team,
        from: "from@example.com",
        to: ["bounce@example.com"],
        subject: "Test",
        status: "bounced",
        source: "api",
        generation: 0,
        attempts: 0,
        domainId: f.domain,
        search: "test",
      })
    )
    const bounced = await f.t.mutation(internal.suppressions.record, {
      organizationId: f.owner.team,
      email: "bounce@example.com",
      reason: "bounced",
      sourceId,
    })
    expect((await f.call(`/suppressions/${bounced}`)).body).toMatchObject({
      origin: "bounce",
      source_id: sourceId,
    })
    expect(
      (await f.call("/suppressions?origin=bounce")).body.data.map(
        (x: { id: string }) => x.id
      )
    ).toEqual([bounced])
    await f.member.client.mutation(api.suppressions.remove, { id: bounced })
    expect(
      (await f.call("/suppressions/ada%2Btag%40example.com", "DELETE")).body
    ).toEqual({ object: "suppression", id, deleted: true })
    const events = await f.t.run((ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .take(50)
    )
    expect(events.filter((x) => x.type === "suppression.added")).toHaveLength(2)
    expect(events.filter((x) => x.type === "suppression.removed")).toHaveLength(
      2
    )
    const jobs = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    )
    expect(
      jobs.some(
        (job) =>
          job.name.includes("releaseSuppression") &&
          job.args[0].email === "bounce@example.com"
      )
    ).toBe(true)
  })
  test("atomic batch add/remove accepts 1–100, returns input order, replays POST responses", async () => {
    const f = await setup()
    const body = {
      emails: ["one@example.com", "two@example.com", "ONE@example.com"],
    }
    const added = await f.call(
      "/suppressions/batch/add",
      "POST",
      body,
      f.key.token,
      "batch-add"
    )
    expect(added.status).toBe(201)
    expect(added.body.data).toHaveLength(3)
    expect(added.body.data[0]).toEqual(added.body.data[2])
    expect(
      await f.call(
        "/suppressions/batch/add",
        "POST",
        body,
        f.key.token,
        "batch-add"
      )
    ).toEqual(added)
    const ids = added.body.data.map((x: { id: string }) => x.id)
    const foreign = await f.call(
      "/suppressions",
      "POST",
      { email: "foreign@example.com" },
      f.other.token
    )
    expect(
      (
        await f.call("/suppressions/batch/remove", "POST", {
          ids: [ids[0], foreign.body.id],
        })
      ).status
    ).toBe(404)
    expect((await f.call(`/suppressions/${ids[0]}`)).status).toBe(200)
    expect(
      (
        await f.call("/suppressions/batch/add", "POST", {
          emails: ["new@example.com", "bad"],
        })
      ).status
    ).toBe(422)
    expect((await f.call("/suppressions/new%40example.com")).status).toBe(404)
    const removed = await f.call(
      "/suppressions/batch/remove",
      "POST",
      { ids },
      f.key.token,
      "batch-remove"
    )
    expect(removed.body.data).toEqual(
      ids.map((id: string) => ({ object: "suppression", id, deleted: true }))
    )
    expect(
      await f.call(
        "/suppressions/batch/remove",
        "POST",
        { ids },
        f.key.token,
        "batch-remove"
      )
    ).toEqual(removed)
    await f.call("/suppressions", "POST", { email: "email@example.com" })
    expect(
      (
        await f.call("/suppressions/batch/remove", "POST", {
          emails: ["EMAIL@example.com"],
        })
      ).status
    ).toBe(200)
    expect((await f.call("/suppressions")).body.data).toEqual([])
  })
  test("the 100-entry boundary commits atomically and emits one event per unique address", async () => {
    const f = await setup()
    const emails = Array.from(
      { length: 100 },
      (_, i) => `batch${i}@example.com`
    )
    const added = await f.call("/suppressions/batch/add", "POST", { emails })
    expect(added.status).toBe(201)
    expect(added.body.data).toHaveLength(100)
    expect((await f.call("/suppressions?limit=100")).body.data).toHaveLength(
      100
    )
    const removed = await f.call("/suppressions/batch/remove", "POST", {
      emails,
    })
    expect(removed.status).toBe(200)
    expect(removed.body.data).toHaveLength(100)
    expect((await f.call("/suppressions")).body.data).toEqual([])
    const events = await f.t.run((ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .take(300)
    )
    expect(events.filter((x) => x.type === "suppression.added")).toHaveLength(
      100
    )
    expect(events.filter((x) => x.type === "suppression.removed")).toHaveLength(
      100
    )
  })

  test("pagination, origins and foreign cursor isolation", async () => {
    const f = await setup()
    const first = await f.call("/suppressions", "POST", {
      email: "one@example.com",
    })
    const second = await f.call("/suppressions", "POST", {
      email: "two@example.com",
    })
    expect((await f.call("/suppressions?limit=1")).body).toMatchObject({
      has_more: true,
      data: [{ id: second.body.id }],
    })
    expect(
      (await f.call(`/suppressions?after=${second.body.id}`)).body.data[0].id
    ).toBe(first.body.id)
    expect(
      (await f.call(`/suppressions?before=${first.body.id}`)).body.data[0].id
    ).toBe(second.body.id)
    expect(
      (
        await f.call(
          `/suppressions?after=${first.body.id}`,
          "GET",
          undefined,
          f.other.token
        )
      ).status
    ).toBe(422)
    expect((await f.call("/suppressions?origin=complaint")).body.data).toEqual(
      []
    )
    for (const query of [
      "origin=bad",
      "limit=0",
      "limit=101",
      "after=a&before=b",
      "after=missing",
    ])
      expect(await f.call(`/suppressions?${query}`)).toMatchObject({
        status: 422,
        body: { name: "validation_error" },
      })
  })
  test("all operations require full access; ids and emails are team scoped", async () => {
    const f = await setup()
    const added = await f.call("/suppressions", "POST", {
      email: "one@example.com",
    })
    for (const [path, method, body] of [
      ["/suppressions", "GET"],
      ["/suppressions", "POST", { email: "x@example.com" }],
      ["/suppressions/batch/add", "POST", { emails: ["x@example.com"] }],
      ["/suppressions/batch/remove", "POST", { ids: [added.body.id] }],
      [`/suppressions/${added.body.id}`, "GET"],
      [`/suppressions/${added.body.id}`, "DELETE"],
    ] as [string, string, unknown?][])
      expect(await f.call(path, method, body, f.sending.token)).toMatchObject({
        status: 401,
        body: { name: "restricted_api_key" },
      })
    for (const id of [added.body.id, "one%40example.com"])
      for (const method of ["GET", "DELETE"])
        expect(
          await f.call(`/suppressions/${id}`, method, undefined, f.other.token)
        ).toMatchObject({ status: 404, body: { name: "not_found" } })
    await expect(
      f.outsider.client.mutation(api.suppressions.remove, { id: added.body.id })
    ).rejects.toThrow("permission")
  })
  test.each([
    ["/suppressions", {}, "missing_required_field"],
    ["/suppressions", { email: "bad" }, "validation_error"],
    ["/suppressions/batch/add", { emails: [] }, "validation_error"],
    [
      "/suppressions/batch/add",
      { emails: Array(101).fill("a@example.com") },
      "validation_error",
    ],
    ["/suppressions/batch/add", { emails: [4] }, "validation_error"],
    ["/suppressions/batch/remove", {}, "validation_error"],
    [
      "/suppressions/batch/remove",
      { emails: ["a@example.com"], ids: ["id"] },
      "validation_error",
    ],
  ])("validates %s %j", async (path, body, name) => {
    const f = await setup()
    expect(await f.call(path, "POST", body)).toMatchObject({
      status: 422,
      body: { name },
    })
  })
})
