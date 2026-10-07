/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import {
  componentsGeneric,
  createFunctionHandle,
  defineSchema,
  defineTable,
  internalMutationGeneric,
  makeFunctionReference,
} from "convex/server"
import { Webhook } from "standardwebhooks"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { OpenSend, type SendEmailOptions } from "../client/index.js"
import { register } from "../test.js"
import type { WorkId } from "@convex-dev/workpool"
import type { ComponentApi } from "./_generated/component.js"
import { api, internal } from "./_generated/api.js"
import schema from "./schema.js"
import {
  MAX_EMAIL_BYTES,
  vOnEmailEventArgs,
  type EmailEvent,
  type Status,
} from "./shared.js"

const appSchema = defineSchema({ events: defineTable(vOnEmailEventArgs) })
const callback = internalMutationGeneric({
  args: vOnEmailEventArgs,
  handler: async (ctx, args) => {
    await ctx.db.insert("events", args)
    return null
  },
})
const callbackRef = makeFunctionReference<
  "mutation",
  { id: string; event: EmailEvent }
>("callbacks:record")
const rootModules = {
  ...import.meta.glob("./_generated/**/*.ts"),
  "./callbacks.ts": async () => ({ record: callback }),
}
const modules = import.meta.glob("./**/*.ts")
const component = componentsGeneric().opensend as unknown as ComponentApi
const credentials = { apiKey: "os_test", baseUrl: "https://api.opensend.test" }
const email: SendEmailOptions = {
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
}
const normalized = {
  from: "sender@example.com",
  to: ["recipient@example.com"],
  subject: "Hello",
  html: "<p>Hello</p>",
}
const delivery = { ...credentials, maxAttempts: 3, initialBackoffMs: 10 }
const secret = "whsec_" + btoa("a".repeat(32))
const response = (status = 200) =>
  Response.json(
    status === 200
      ? { id: "os_email_1" }
      : {
          name: "validation_error",
          message: `failure ${status}`,
          statusCode: status,
        },
    { status }
  )

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("NODE_ENV", "production")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
function setup(options = {}, appModules = rootModules) {
  const t = convexTest(appSchema, appModules)
  register(t)
  const client = new OpenSend(component, {
    ...credentials,
    maxAttempts: 3,
    initialBackoffMs: 10,
    ...options,
  })
  const send = (input = email) =>
    t.mutation((ctx) => client.sendEmail(ctx, input))
  const status = (id: string) => t.query((ctx) => client.status(ctx, id))
  const drain = () =>
    t.finishAllScheduledFunctions(vi.runOnlyPendingTimersAsync)
  return { t, client, send, status, drain }
}
async function callWebhook(f: ReturnType<typeof setup>, req: Request) {
  return await f.t.action(async (ctx) => {
    const response = await f.client.handleOpenSendEventWebhook(ctx, req)
    return { status: response.status }
  })
}
function signed(payload: unknown, prefix = "svix", signature?: string) {
  const body = JSON.stringify(payload)
  const timestamp = new Date()
  return new Request("https://app.example.com/opensend/webhook", {
    method: "POST",
    body,
    headers: {
      [`${prefix}-id`]: "evt_1",
      [`${prefix}-timestamp`]: String(Math.floor(timestamp.getTime() / 1000)),
      [`${prefix}-signature`]:
        signature ?? new Webhook(secret).sign("evt_1", timestamp, body),
    },
  })
}
const webhookPayload = (
  type = "email.delivered",
  id = "os_email_1",
  data = {}
) => ({
  type,
  created_at: new Date().toISOString(),
  data: { email_id: id, ...data },
})

// These exercise the real SDK transport, workpool loop, backoff, and completion callback.
test("queued → sent, status, get, and cancel after acceptance", async () => {
  const fetch = vi.fn().mockResolvedValue(response())
  vi.stubGlobal("fetch", fetch)
  const f = setup()
  const id = await f.send()
  expect(await f.status(id)).toMatchObject({
    status: "queued",
    opened: false,
    clicked: false,
    complained: false,
  })
  await f.drain()
  expect(await f.status(id)).toMatchObject({
    status: "sent",
    opensendId: "os_email_1",
  })
  const detail = await f.t.query((ctx) => f.client.get(ctx, id))
  expect(detail).toMatchObject({
    to: ["recipient@example.com"],
    subject: "Hello",
  })
  expect(detail).not.toHaveProperty("html")
  expect(detail).not.toHaveProperty("idempotencyKey")
  expect(await f.t.mutation((ctx) => f.client.cancelEmail(ctx, id))).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url, options] = fetch.mock.calls[0]
  expect(url).toBe("https://api.opensend.test/emails")
  expect(new Headers(options.headers).get("Authorization")).toBe(
    "Bearer os_test"
  )
  expect(JSON.parse(options.body)).toMatchObject({
    from: email.from,
    to: [email.to],
    html: email.html,
  })
})

test.each([503, 429, 409, "network"] as const)(
  "%s retries with the SAME Idempotency-Key",
  async (failure) => {
    const fetch = vi.fn()
    if (failure === "network")
      fetch.mockRejectedValueOnce(new TypeError("socket disconnected"))
    else if (failure === 409)
      fetch.mockResolvedValueOnce(
        Response.json(
          {
            name: "concurrent_idempotent_requests",
            statusCode: 409,
            message: "In flight",
          },
          { status: 409 }
        )
      )
    else fetch.mockResolvedValueOnce(response(failure))
    fetch.mockResolvedValueOnce(response())
    vi.stubGlobal("fetch", fetch)
    const f = setup()
    const id = await f.send()
    await f.drain()
    expect(await f.status(id)).toMatchObject({ status: "sent" })
    expect(fetch).toHaveBeenCalledTimes(2)
    const keys = fetch.mock.calls.map(([, options]) =>
      new Headers(options.headers).get("Idempotency-Key")
    )
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body)
  }
)

test.each([401, 403, 422])("%s fails once without retrying", async (code) => {
  const fetch = vi.fn().mockResolvedValue(response(code))
  vi.stubGlobal("fetch", fetch)
  const f = setup()
  const id = await f.send()
  await f.drain()
  expect(await f.status(id)).toMatchObject({
    status: "failed",
    errorMessage: expect.stringContaining(String(code)),
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

test("exhausted attempts retain the failure message", async () => {
  const fetch = vi.fn().mockImplementation(async () => response(503))
  vi.stubGlobal("fetch", fetch)
  const f = setup()
  const id = await f.send()
  await f.drain()
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(await f.status(id)).toMatchObject({
    status: "failed",
    errorMessage: expect.stringContaining("failure 503"),
  })
})

test("queued cancellation prevents sending; missing row status is null", async () => {
  const fetch = vi.fn().mockResolvedValue(response())
  vi.stubGlobal("fetch", fetch)
  const f = setup()
  const id = await f.send()
  expect(await f.t.mutation((ctx) => f.client.cancelEmail(ctx, id))).toBe(true)
  expect(await f.status(id)).toMatchObject({ status: "cancelled" })
  await f.drain()
  expect(fetch).not.toHaveBeenCalled()
  await f.t.mutation((ctx) => f.client.cleanupOldEmails(ctx, { olderThan: 0 }))
  await f.drain()
  expect(await f.status(id)).toBeNull()
})

test("template, tags, scheduling, topic and small attachments reach the SDK wire contract", async () => {
  const fetch = vi.fn().mockResolvedValue(response())
  vi.stubGlobal("fetch", fetch)
  const f = setup()
  await f.send({
    to: "a@example.com",
    template: { id: "template_1", variables: { name: "Ada", count: 2 } },
    tags: [{ name: "category", value: "welcome" }],
    scheduledAt: "2030-01-01T00:00:00Z",
    topicId: "topic_1",
    attachments: [
      {
        filename: "hello.txt",
        content: btoa("hello"),
        contentType: "text/plain",
        contentId: "hello",
      },
    ],
    cc: "cc@example.com",
    bcc: ["bcc@example.com"],
    replyTo: "reply@example.com",
    headers: { "X-Test": "yes" },
  })
  await f.drain()
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    template: { id: "template_1", variables: { name: "Ada", count: 2 } },
    scheduled_at: "2030-01-01T00:00:00Z",
    topic_id: "topic_1",
    reply_to: ["reply@example.com"],
    cc: ["cc@example.com"],
    attachments: [
      {
        filename: "hello.txt",
        content: btoa("hello"),
        content_type: "text/plain",
        content_id: "hello",
      },
    ],
    tags: [
      { name: "category", value: "welcome" },
      { name: "opensend_component_email", value: expect.any(String) },
    ],
  })
})

test("caller idempotency key deduplicates enqueues", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()))
  const f = setup()
  const input = { ...email, idempotencyKey: "welcome:user_1" }
  const first = await f.send(input)
  expect(await f.send(input)).toBe(first)
  await f.drain()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await f.send(input)).toBe(first)
})

test.each(["svix", "webhook"])(
  "valid %s signature applies event and calls app mutation with {id,event}",
  async (prefix) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()))
    const f = setup({ webhookSecret: secret, onEmailEvent: callbackRef })
    const id = await f.send()
    await f.drain()
    const req = signed(webhookPayload(), prefix)
    expect((await callWebhook(f, req)).status).toBe(204)
    expect(await f.status(id)).toMatchObject({ status: "delivered" })
    expect(
      await f.t.query((ctx) => ctx.db.query("events").collect())
    ).toMatchObject([
      { id, event: { type: "email.delivered", opensendId: "os_email_1" } },
    ])
    // Replays and stale lifecycle events don't fire the hook a second time.
    await callWebhook(f, signed(webhookPayload(), prefix))
    await callWebhook(f, signed(webhookPayload("email.sent"), prefix))
    expect(await f.status(id)).toMatchObject({ status: "delivered" })
    expect(
      await f.t.query((ctx) => ctx.db.query("events").collect())
    ).toHaveLength(1)
  }
)

test("bad signature 401; missing secret 503; expired signature 401", async () => {
  const f = setup({ webhookSecret: secret })
  expect(
    (await callWebhook(f, signed(webhookPayload(), "svix", "v1,bad"))).status
  ).toBe(401)
  const noSecret = setup()
  expect((await callWebhook(noSecret, signed(webhookPayload()))).status).toBe(
    503
  )
  const expired = signed(webhookPayload())
  expired.headers.set("svix-timestamp", "1")
  expect((await callWebhook(f, expired)).status).toBe(401)
})

test.each([
  webhookPayload("domain.created"),
  webhookPayload("email.delivered", "unknown"),
  { type: "email.delivered", data: { email_id: 123 } },
  [],
])(
  "unknown event, unknown id, and malformed payloads are ignored",
  async (payload) => {
    const f = setup({ webhookSecret: secret })
    expect((await callWebhook(f, signed(payload))).status).toBe(204)
    expect(await f.t.query((ctx) => ctx.db.query("events").collect())).toEqual(
      []
    )
  }
)

test("opened/clicked/complained flags and bounce message; handle string callback", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()))
  const f = setup({ webhookSecret: secret })
  const handle = await f.t.run(() => createFunctionHandle(callbackRef))
  f.client = new OpenSend(component, {
    ...credentials,
    webhookSecret: secret,
    onEmailEvent: handle,
  })
  const id = await f.t.mutation((ctx) => f.client.sendEmail(ctx, email))
  await f.drain()
  for (const type of [
    "email.opened",
    "email.clicked",
    "email.complained",
    "email.bounced",
  ]) {
    await callWebhook(
      f,
      signed(
        webhookPayload(type, "os_email_1", {
          bounce: { message: "Mailbox missing" },
        })
      )
    )
  }
  expect(await f.status(id)).toMatchObject({
    status: "bounced",
    opened: true,
    clicked: true,
    complained: true,
    errorMessage: "Mailbox missing",
  })
  expect(
    await f.t.query((ctx) => ctx.db.query("events").collect())
  ).toHaveLength(4)
})

test("early webhook correlates via reserved tag; acceptance and completion cannot undo delivered", async () => {
  const t = convexTest(schema, modules)
  const workpool = await import("@convex-dev/workpool/test")
  workpool.register(t)
  const id = await t.mutation(api.lib.sendEmail, {
    email: normalized,
    delivery,
  })
  await t.mutation(api.lib.handleEmailEvent, {
    event: {
      type: "email.delivered",
      opensendId: "early",
      componentEmailId: id,
    },
  })
  await t.mutation(internal.lib.recordAcceptance, {
    emailId: id,
    opensendId: "early",
  })
  const doc = await t.run((ctx) => ctx.db.get("emails", id))
  expect(doc?.status).toBe("delivered")
  expect(doc?.opensendId).toBe("early")
  await t.mutation(internal.lib.onDeliverComplete, {
    workId: doc!.workId! as WorkId,
    context: { emailId: id },
    result: {
      kind: "success",
      returnValue: { sent: true, opensendId: "early" },
    },
  })
  expect(await t.query(api.lib.status, { emailId: id })).toMatchObject({
    status: "delivered",
  })
  await t.finishAllScheduledFunctions(vi.runOnlyPendingTimersAsync)
})

test("cleanup removes only old finalized rows, 100 per transaction, with a fixed cutoff", async () => {
  const t = convexTest(schema, modules)
  const now = Date.now()
  const insert = (status: Status, finalizedAt: number) =>
    t.run((ctx) =>
      ctx.db.insert("emails", {
        ...normalized,
        status,
        finalizedAt,
        idempotencyKey: crypto.randomUUID(),
        opened: false,
        clicked: false,
        complained: false,
      })
    )
  for (let i = 0; i < 205; i++)
    await insert(i % 2 ? "failed" : "delivered", now - 10_000)
  await insert("sent", now - 1000)
  await insert("cancelled", now - 1000)
  await insert("queued", Number.MAX_SAFE_INTEGER)
  await t.mutation(api.lib.cleanupOldEmails, { olderThan: 5000 })
  expect(await t.run((ctx) => ctx.db.query("emails").collect())).toHaveLength(
    108
  )
  await t.finishAllScheduledFunctions(vi.runOnlyPendingTimersAsync)
  expect(await t.run((ctx) => ctx.db.query("emails").collect())).toHaveLength(3)
})

test.each([
  [{}, { ...email, html: undefined }],
  [{ apiKey: "" }, email],
  [{ baseUrl: "" }, email],
  [{ maxAttempts: 0 }, email],
  [{ initialBackoffMs: -1 }, email],
  [{ baseUrl: "file:///tmp" }, email],
  [{}, { ...email, template: { id: "t" } }],
  [{}, { ...email, html: "a".repeat(MAX_EMAIL_BYTES) }],
  [
    {},
    { ...email, tags: [{ name: "opensend_component_email", value: "spoof" }] },
  ],
])(
  "client rejects invalid input before invoking a mutation",
  async (options, input) => {
    const f = setup(options)
    await expect(f.send(input)).rejects.toThrow()
  }
)

test("first sent webhook after API acceptance invokes the hook once", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()))
  const f = setup({ webhookSecret: secret, onEmailEvent: callbackRef })
  const id = await f.send()
  await f.drain()
  await callWebhook(f, signed(webhookPayload("email.sent")))
  await callWebhook(f, signed(webhookPayload("email.sent")))
  expect(
    await f.t.query((ctx) => ctx.db.query("events").collect())
  ).toMatchObject([{ id, event: { type: "email.sent" } }])
  expect(
    await f.t.query((ctx) => ctx.db.query("events").collect())
  ).toHaveLength(1)
})

test("cancel during an in-flight request is best effort and preserves the accepted API id", async () => {
  const t = convexTest(schema, modules)
  const workpool = await import("@convex-dev/workpool/test")
  workpool.register(t)
  const id = await t.mutation(api.lib.sendEmail, {
    email: normalized,
    delivery,
  })
  let notifyStarted!: () => void
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve
  })
  let accept!: (response: Response) => void
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      notifyStarted()
      return new Promise<Response>((resolve) => {
        accept = resolve
      })
    })
  )
  const attempt = t.action(internal.delivery.deliver, {
    emailId: id,
    ...credentials,
  })
  await started
  expect(await t.mutation(api.lib.cancelEmail, { emailId: id })).toBe(true)
  accept(response())
  expect(await attempt).toMatchObject({ sent: true })
  expect(await t.query(api.lib.status, { emailId: id })).toMatchObject({
    status: "cancelled",
    opensendId: "os_email_1",
  })
  await t.finishAllScheduledFunctions(vi.runOnlyPendingTimersAsync)
})

test("missing credentials and template-only defaults fail before mutation", async () => {
  const t = convexTest(appSchema, rootModules)
  register(t)
  for (const options of [
    { baseUrl: credentials.baseUrl },
    { apiKey: credentials.apiKey },
    {},
  ]) {
    const client = new OpenSend(component, options)
    await expect(
      t.mutation((ctx) => client.sendEmail(ctx, email))
    ).rejects.toThrow("apiKey and baseUrl")
  }
  const f = setup()
  await expect(f.send({ to: "a@example.com", text: "Hello" })).rejects.toThrow(
    "from and subject"
  )
})

test("cleanup preserves rows exactly on the cutoff and validates retention", async () => {
  const t = convexTest(schema, modules)
  const cutoff = Date.now() - 1000
  const id = await t.run((ctx) =>
    ctx.db.insert("emails", {
      ...normalized,
      status: "sent",
      finalizedAt: cutoff,
      idempotencyKey: "key",
      opened: false,
      clicked: false,
      complained: false,
    })
  )
  await t.mutation(api.lib.cleanupOldEmails, { olderThan: 1000 })
  expect(await t.query(api.lib.status, { emailId: id })).toMatchObject({
    status: "sent",
  })
  await expect(
    t.mutation(api.lib.cleanupOldEmails, { olderThan: -1 })
  ).rejects.toThrow("nonnegative")
})

test("a failed app callback rolls back the webhook and succeeds on redelivery", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()))
  let unavailable = true
  const record = internalMutationGeneric({
    args: vOnEmailEventArgs,
    handler: async (ctx, args) => {
      await ctx.db.insert("events", args)
      if (unavailable) throw new Error("App callback unavailable")
      return null
    },
  })
  const f = setup(
    { webhookSecret: secret, onEmailEvent: callbackRef },
    { ...rootModules, "./callbacks.ts": async () => ({ record }) }
  )
  const id = await f.send()
  await f.drain()
  await expect(callWebhook(f, signed(webhookPayload()))).rejects.toThrow(
    "App callback unavailable"
  )
  expect(await f.status(id)).toMatchObject({ status: "sent" })
  expect(await f.t.query((ctx) => ctx.db.query("events").collect())).toEqual([])
  unavailable = false
  expect((await callWebhook(f, signed(webhookPayload()))).status).toBe(204)
  expect(await f.status(id)).toMatchObject({ status: "delivered" })
  expect(
    await f.t.query((ctx) => ctx.db.query("events").collect())
  ).toHaveLength(1)
})

test("47 caller tags leave room for correlation; 48 are rejected before enqueue", async () => {
  const fetch = vi.fn().mockResolvedValue(response())
  vi.stubGlobal("fetch", fetch)
  const f = setup()
  const tags = Array.from({ length: 48 }, (_, i) => ({
    name: `tag_${i}`,
    value: "yes",
  }))
  await expect(f.send({ ...email, tags })).rejects.toThrow("47 caller tags")
  await f.send({ ...email, tags: tags.slice(0, 47) })
  await f.drain()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetch.mock.calls[0][1].body).tags).toHaveLength(48)
})

test("delivery after an exhausted request correlates by tag and clears the stale failure", async () => {
  const t = convexTest(schema, modules)
  const id = await t.run((ctx) =>
    ctx.db.insert("emails", {
      ...normalized,
      status: "failed",
      finalizedAt: Date.now(),
      errorMessage: "OpenSend no response: socket disconnected",
      idempotencyKey: "stable-key",
      opened: false,
      clicked: false,
      complained: false,
    })
  )
  await t.mutation(api.lib.handleEmailEvent, {
    event: {
      type: "email.delivered",
      opensendId: "accepted_despite_disconnect",
      componentEmailId: id,
    },
  })
  const state = await t.query(api.lib.status, { emailId: id })
  expect(state).toMatchObject({
    status: "delivered",
    opensendId: "accepted_despite_disconnect",
  })
  expect(state?.errorMessage).toBeUndefined()
})
