/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fixture } from "./testHelpers/ses.fixture"
import { customEventName, customEventType } from "./automationEvents"

beforeEach(() => {
  /* Scheduled consumers stay queued; tests run the ones they look at. */
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse("2026-09-28T12:00:00.000Z"))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const page = { numItems: 50, cursor: null }

async function setup() {
  const f = await fixture()
  const org = f.owner.team
  const member = await f.actor("member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: org,
        userId: member.user._id,
        role: "member",
        createdAt: Date.now(),
      },
    },
  })
  const define = (
    name: string,
    schema: {
      key: string
      type: "string" | "number" | "boolean" | "date"
    }[] = []
  ) =>
    f.owner.client.mutation(api.automationEvents.create, {
      organizationId: org,
      name,
      schema,
    })
  const list = async (search?: string) =>
    (
      await f.owner.client.query(api.automationEvents.list, {
        organizationId: org,
        paginationOpts: page,
        search,
      })
    ).page
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: org,
    input: { name: "App", permission: "full_access", domainId: null },
  })
  /** A REST call, each a moment after the last so the rate limit never
      trips. */
  const call = async (
    path: string,
    init: RequestInit & { json?: unknown } = {},
    bearer = token
  ) => {
    vi.setSystemTime(Date.now() + 200)
    const { json, ...rest } = init
    const response = await f.t.fetch(path, {
      ...rest,
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        ...rest.headers,
      },
    })
    return { status: response.status, body: await response.json() }
  }
  const send = (json: unknown, headers: Record<string, string> = {}) =>
    call("/events/send", { method: "POST", json, headers })
  const occurrences = () =>
    f.t.run((ctx) => ctx.db.query("automationEventOccurrences").collect())
  const outbox = () =>
    f.t.run((ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_organizationId_and_type", (q) =>
          q.eq("organizationId", org)
        )
        .collect()
    )
  const contact = async (email: string) =>
    (
      await f.owner.client.mutation(api.contacts.upsert, {
        organizationId: org,
        contacts: [{ email }],
        segmentIds: [],
      })
    ).createdIds[0]!
  return {
    f,
    org,
    member,
    define,
    list,
    call,
    send,
    occurrences,
    outbox,
    contact,
  }
}

describe("event definitions in the dashboard", () => {
  test("another team's member is refused", async () => {
    const { f, org, define } = await setup()
    const id = await define("user.created")
    const outsider = f.outsider.client
    await expect(
      outsider.query(api.automationEvents.list, {
        organizationId: org,
        paginationOpts: page,
      })
    ).rejects.toThrow("permission")
    await expect(
      outsider.query(api.automationEvents.byName, {
        organizationId: org,
        name: "user.created",
      })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.automationEvents.create, {
        organizationId: org,
        name: "x",
        schema: [],
      })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.automationEvents.update, { id, schema: [] })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.automationEvents.remove, { id })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.automationEvents.ensure, {
        organizationId: org,
        names: ["y"],
      })
    ).rejects.toThrow("permission")
  })

  test("a plain member adds, edits and deletes events", async () => {
    const { f, org, member, list } = await setup()
    const id = await member.client.mutation(api.automationEvents.create, {
      organizationId: org,
      name: "  user.created  ",
      schema: [
        { key: " plan ", type: "string" },
        { key: "", type: "number" },
      ],
    })
    expect(await list()).toMatchObject([
      { name: "user.created", schema: [{ key: "plan", type: "string" }] },
    ])
    await member.client.mutation(api.automationEvents.update, {
      id,
      name: "user.signed_up",
      schema: [
        { key: "plan", type: "string" },
        { key: "seats", type: "number" },
      ],
    })
    const found = await member.client.query(api.automationEvents.byName, {
      organizationId: org,
      name: "user.signed_up",
    })
    expect(found?.schema).toEqual([
      { key: "plan", type: "string" },
      { key: "seats", type: "number" },
    ])
    // Saving under its own name is not a clash.
    await member.client.mutation(api.automationEvents.update, {
      id,
      name: "user.signed_up",
    })
    await member.client.mutation(api.automationEvents.remove, { id })
    expect(await f.t.run((ctx) => ctx.db.get("automationEvents", id))).toBe(
      null
    )
  })

  test("validates names and properties", async () => {
    const { define } = await setup()
    await expect(define("   ")).rejects.toThrow("Enter an event name")
    await expect(define("opensend:email.sent")).rejects.toThrow("reserved")
    await expect(define("x".repeat(257))).rejects.toThrow("256")
    await define("user.created")
    await expect(define("user.created")).rejects.toThrow("already exists")
    await expect(
      define("order.paid", [{ key: "total-cents", type: "number" }])
    ).rejects.toThrow("letters, numbers and underscores")
    await expect(
      define("order.paid", [
        { key: "total", type: "number" },
        { key: "total", type: "string" },
      ])
    ).rejects.toThrow("listed twice")
    await expect(
      define(
        "order.paid",
        Array.from({ length: 51 }, (_, i) => ({
          key: `k${i}`,
          type: "string" as const,
        }))
      )
    ).rejects.toThrow("50")
  })

  test("a rename cannot take another event's name", async () => {
    const { f, define } = await setup()
    await define("user.created")
    const other = await define("user.deleted")
    await expect(
      f.owner.client.mutation(api.automationEvents.update, {
        id: other,
        name: "user.created",
      })
    ).rejects.toThrow("already exists")
  })

  test("search matches names and property keys as text", async () => {
    const { define, list } = await setup()
    await define("user.created", [{ key: "plan_name", type: "string" }])
    await define("order.paid")
    const names = async (search: string) =>
      (await list(search)).map((row) => row.name)
    expect(await names("created")).toEqual(["user.created"])
    expect(await names("user.cre")).toEqual(["user.created"])
    expect(await names("plan")).toEqual(["user.created"])
    expect(await names("order")).toEqual(["order.paid"])
    expect(await names("nothing")).toEqual([])
    expect((await list()).map((row) => row.name)).toEqual([
      "order.paid",
      "user.created",
    ])
  })

  test("naming events in an automation defines each new one once", async () => {
    const { org, member, define, list } = await setup()
    await define("user.created", [{ key: "plan", type: "string" }])
    const ensure = (names: string[]) =>
      member.client.mutation(api.automationEvents.ensure, {
        organizationId: org,
        names,
      })
    await ensure(["user.created", " trial.ended ", "", "opensend:x"])
    await ensure(["trial.ended"])
    expect(
      (await list()).map(({ name, schema }) => ({ name, schema }))
    ).toEqual([
      { name: "trial.ended", schema: [] },
      { name: "user.created", schema: [{ key: "plan", type: "string" }] },
    ])
  })
})

describe("POST /events/send", () => {
  test("stores the occurrence and puts it on the outbox", async () => {
    const { org, define, send, occurrences, outbox, contact } = await setup()
    await define("user.created", [
      { key: "plan", type: "string" },
      { key: "seats", type: "number" },
      { key: "trial", type: "boolean" },
      { key: "renews_at", type: "date" },
    ])
    const contactId = await contact("ada@example.com")
    const payload = {
      plan: "pro",
      seats: 3,
      trial: false,
      renews_at: "2026-10-01T00:00:00.000Z",
      extra: { nested: [1, 2] },
    }
    const reply = await send({
      event: "user.created",
      contact_id: contactId,
      payload,
    })
    expect(reply).toEqual({
      status: 202,
      body: { object: "event", event: "user.created" },
    })
    const [stored] = await occurrences()
    expect(stored).toMatchObject({
      organizationId: org,
      name: "user.created",
      contactId,
      email: "ada@example.com",
      payload,
    })
    const [event] = (await outbox()).filter(
      (row) => row.type === customEventType("user.created")
    )
    expect(event.data).toEqual({
      id: stored._id,
      event: "user.created",
      contact_id: contactId,
      email: "ada@example.com",
      payload,
    })
    expect(customEventName(event.type)).toBe("user.created")
    expect(customEventName("email.sent")).toBeNull()
  })

  test("a payload that does not match the schema is a 422", async () => {
    const { define, send, occurrences, outbox } = await setup()
    await define("user.created", [
      { key: "seats", type: "number" },
      { key: "renews_at", type: "date" },
    ])
    const reply = await send({
      event: "user.created",
      email: "ada@example.com",
      payload: { seats: "3", renews_at: "not a date" },
    })
    expect(reply.status).toBe(422)
    expect(reply.body).toEqual({
      statusCode: 422,
      name: "validation_error",
      message:
        "The payload does not match the user.created event: seats must be a number, renews_at must be a date.",
    })
    const missing = await send({
      event: "user.created",
      email: "ada@example.com",
    })
    expect(missing.body.message).toContain("seats is missing")
    expect(await occurrences()).toEqual([])
    expect(await outbox()).toEqual([])
  })

  test("names the contact by id or by address, exactly one", async () => {
    const { f, send, occurrences, contact } = await setup()
    const known = await contact("ada@example.com")
    const both = await send({
      event: "ping",
      contact_id: known,
      email: "ada@example.com",
    })
    expect(both.status).toBe(422)
    expect((await send({ event: "ping" })).status).toBe(422)
    expect(
      (await send({ event: "ping", email: "not-an-address" })).status
    ).toBe(422)
    const missing = await send({ event: "ping", contact_id: "nope" })
    expect(missing).toMatchObject({
      status: 404,
      body: { name: "not_found", message: "Contact not found" },
    })
    // Another team's contact is as good as none.
    const foreign = (
      await f.outsider.client.mutation(api.contacts.upsert, {
        organizationId: f.outsider.team,
        contacts: [{ email: "eve@example.com" }],
        segmentIds: [],
      })
    ).createdIds[0]!
    expect((await send({ event: "ping", contact_id: foreign })).status).toBe(
      404
    )
    // A known address finds its contact; an unknown one is kept for the run
    // to create, as Resend does, and no contact is made here.
    await send({ event: "ping", email: " ADA@example.com " })
    await send({ event: "ping", email: "new@example.com" })
    const rows = await occurrences()
    expect(rows.map(({ contactId, email }) => ({ contactId, email }))).toEqual([
      { contactId: known, email: "ada@example.com" },
      { contactId: undefined, email: "new@example.com" },
    ])
    const contacts = await f.t.run((ctx) => ctx.db.query("contacts").collect())
    expect(contacts.map((row) => row.email).sort()).toEqual([
      "ada@example.com",
      "eve@example.com",
    ])
  })

  test("an event nobody defined is accepted as sent, without defining it", async () => {
    const { send, occurrences, list } = await setup()
    const reply = await send({
      event: "order.paid",
      email: "ada@example.com",
      payload: { anything: true },
    })
    expect(reply.status).toBe(202)
    expect(await occurrences()).toHaveLength(1)
    expect(await list()).toEqual([])
    const reserved = await send({
      event: "opensend:email.sent",
      email: "ada@example.com",
    })
    expect(reserved.status).toBe(422)
    expect(reserved.body.message).toContain("reserved")
  })

  test("refuses payloads that are not objects, too large or unstorable", async () => {
    const { send, occurrences } = await setup()
    const base = { event: "ping", email: "ada@example.com" }
    for (const payload of [
      [1, 2],
      "text",
      { $where: 1 },
      { big: "x".repeat(70_000) },
    ]) {
      const reply = await send({ ...base, payload })
      expect(reply.status).toBe(422)
      expect(reply.body.name).toBe("validation_error")
    }
    expect(await occurrences()).toEqual([])
  })

  test("a custom event named like a system event never reaches webhooks", async () => {
    const { f, org, send, outbox } = await setup()
    const webhookId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("webhooks", {
        organizationId: org,
        endpoint: "https://hooks.example.com",
        events: ["email.sent"],
        enabled: true,
        secret: "encrypted",
      })
      await ctx.db.insert("webhookSubscriptions", {
        organizationId: org,
        event: "email.sent",
        enabled: true,
        webhookId: id,
      })
      return id
    })
    expect(
      (await send({ event: "email.sent", email: "ada@example.com" })).status
    ).toBe(202)
    const [event] = await outbox()
    expect(event.type).toBe("custom:email.sent")
    await f.t.mutation(internal.webhooks.deliverEvent, { id: event._id })
    const deliveries = await f.t.run((ctx) =>
      ctx.db
        .query("webhookDeliveries")
        .withIndex("by_webhookId", (q) => q.eq("webhookId", webhookId))
        .collect()
    )
    expect(deliveries).toEqual([])
  })

  test("an Idempotency-Key replays the send without storing it twice", async () => {
    const { send, occurrences, outbox } = await setup()
    const body = { event: "ping", email: "ada@example.com" }
    const first = await send(body, { "Idempotency-Key": "ping/1" })
    const again = await send(body, { "Idempotency-Key": "ping/1" })
    expect(again).toEqual(first)
    expect(await occurrences()).toHaveLength(1)
    expect(await outbox()).toHaveLength(1)
  })

  test("deleting the definition keeps what was sent", async () => {
    const { f, define, send, occurrences } = await setup()
    const id = await define("ping")
    await send({ event: "ping", email: "ada@example.com" })
    await f.owner.client.mutation(api.automationEvents.remove, { id })
    expect(await occurrences()).toHaveLength(1)
  })

  test("occurrences are kept 30 days", async () => {
    const { f, send, occurrences } = await setup()
    await send({ event: "old", email: "ada@example.com" })
    vi.setSystemTime(Date.now() + 29 * 86_400_000)
    await send({ event: "recent", email: "ada@example.com" })
    vi.setSystemTime(Date.now() + 2 * 86_400_000)
    await f.t.mutation(internal.automationEvents.prune, {})
    expect((await occurrences()).map((row) => row.name)).toEqual(["recent"])
  })
})

describe("the /events definitions API", () => {
  test("creates, lists, reads, updates and deletes by id or name", async () => {
    const { call } = await setup()
    const created = await call("/events", {
      method: "POST",
      json: { name: "user.created", schema: { plan: "string" } },
    })
    expect(created.status).toBe(201)
    expect(created.body).toEqual({ object: "event", id: expect.any(String) })
    const id = created.body.id as Id<"automationEvents">
    await call("/events", { method: "POST", json: { name: "order.paid" } })
    const listed = await call("/events?limit=1")
    expect(listed.body).toMatchObject({
      object: "list",
      has_more: true,
      data: [{ name: "order.paid", schema: null }],
    })
    const byName = await call("/events/user.created")
    expect(byName.body).toMatchObject({
      object: "event",
      id,
      name: "user.created",
      schema: { plan: "string" },
    })
    expect((await call(`/events/${id}`)).body.name).toBe("user.created")
    const updated = await call("/events/user.created", {
      method: "PATCH",
      json: { schema: { plan: "string", trial: "boolean" } },
    })
    expect(updated.body).toEqual({ object: "event", id })
    expect((await call(`/events/${id}`)).body.schema).toEqual({
      plan: "string",
      trial: "boolean",
    })
    const cleared = await call(`/events/${id}`, {
      method: "PATCH",
      json: { schema: null },
    })
    expect(cleared.status).toBe(200)
    expect((await call(`/events/${id}`)).body.schema).toBeNull()
    expect(
      (await call(`/events/${id}`, { method: "PATCH", json: {} })).status
    ).toBe(422)
    expect(
      (
        await call("/events", {
          method: "POST",
          json: { name: "bad", schema: { plan: "text" } },
        })
      ).status
    ).toBe(422)
    expect(
      (await call("/events", { method: "POST", json: { name: "order.paid" } }))
        .body.message
    ).toContain("already exists")
    const deleted = await call("/events/user.created", { method: "DELETE" })
    expect(deleted.body).toEqual({ object: "event", id, deleted: true })
    expect((await call(`/events/${id}`)).status).toBe(404)
  })

  test("another team's events are not found, and sending keys are refused", async () => {
    const { f, call } = await setup()
    const { token: outsiderToken } = await f.outsider.client.action(
      api.apiKeys.create,
      {
        organizationId: f.outsider.team,
        input: { name: "Other", permission: "full_access", domainId: null },
      }
    )
    await call("/events", { method: "POST", json: { name: "user.created" } })
    expect((await call("/events/user.created", {}, outsiderToken)).status).toBe(
      404
    )
    const { token: sending } = await f.owner.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: { name: "Send", permission: "sending_access", domainId: null },
    })
    const refused = await call(
      "/events/send",
      { method: "POST", json: { event: "ping", email: "a@example.com" } },
      sending
    )
    expect(refused).toMatchObject({
      status: 401,
      body: { name: "restricted_api_key" },
    })
  })
})
