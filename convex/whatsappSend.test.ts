/// <reference types="vite/client" />
import { Workpool } from "@convex-dev/workpool"
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import type { Id } from "./_generated/dataModel"
import { api, internal } from "./_generated/api"
import {
  inboundFixture,
  signedWebhook,
  fakeGraph,
  graphError,
  APP_SECRET,
  PHONE_ID,
  SENDER,
  envelope,
  incoming,
} from "./testHelpers/meta.fixture"
import { insertRow, patchRow } from "./counts"
import { WHATSAPP_WINDOW_CLOSED as WINDOW_CLOSED } from "../lib/meta/payloads"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
  vi.stubEnv("BETTER_AUTH_SECRET", "whatsapp-test-downloads")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
type Fixture = Awaited<ReturnType<typeof setup>>
async function project(
  f: Awaited<ReturnType<typeof inboundFixture>>,
  body: unknown
) {
  expect(
    (await f.t.fetch("/meta/webhook", await signedWebhook(APP_SECRET, body)))
      .status
  ).toBe(200)
  const event = await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  )
  await f.t.mutation(internal.meta.projection.project, { id: event!._id })
}
async function setup(open = true) {
  const f = await inboundFixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  if (open) await project(f, incoming())
  const { token } = await f.member.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: {
      name: "WhatsApp member",
      permission: "full_access",
      domainId: null,
    },
  })
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    bearer = token,
    key?: string
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  return { ...f, token, call }
}
async function send(
  f: Fixture,
  body: unknown = { text: { body: "Hello", preview_url: true } },
  to = SENDER
) {
  const result = await f.call("/whatsapp/messages", "POST", {
    to,
    ...(body as object),
  })
  expect(result.status, JSON.stringify(await result.clone().json())).toBe(200)
  return (await result.json()).id as Id<"channelMessages">
}
const message = (f: Fixture, id: Id<"channelMessages">) =>
  f.t.run((ctx) => ctx.db.get("channelMessages", id))
const deliver = (f: Fixture, id: Id<"channelMessages">, generation = 0) =>
  f.t.action(internal.channels.deliver.deliver, { id, generation })
const statusBody = (wamid: string, status: string) =>
  envelope({
    metadata: { phone_number_id: PHONE_ID },
    statuses: [
      {
        id: wamid,
        status,
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: SENDER,
      },
    ],
  })

test("workpool sends once with wamid and event; later delivered/read webhooks and duplicate sent do not regress", async () => {
  const f = await setup()
  const graph = fakeGraph([
    {
      method: "POST",
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: "wamid.sent" }] }),
    },
  ])
  const id = await send(f)
  expect(await message(f, id)).toMatchObject({
    status: "queued",
    direction: "outbound",
    attempts: 0,
  })
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100))
  expect(await message(f, id)).toMatchObject({
    status: "sent",
    externalId: "wamid.sent",
    attempts: 1,
    claimed: false,
  })
  expect(graph.to(`/${PHONE_ID}/messages`)).toHaveLength(1)
  expect(graph.calls[0]).toMatchObject({
    authorization: "Bearer connection-test-token",
    version: "v25.0",
    body: {
      messaging_product: "whatsapp",
      type: "text",
      to: SENDER,
      text: { body: "Hello", preview_url: true },
    },
  })
  for (const status of ["delivered", "read", "sent"])
    await project(f, statusBody("wamid.sent", status))
  expect(await message(f, id)).toMatchObject({ status: "read" })
  const sentEvents = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(
    sentEvents.filter(
      (e) =>
        e.type === "whatsapp.message.sent" &&
        (e.data as { id?: string }).id === id
    )
  ).toHaveLength(1)
  const detail = await (await f.call(`/whatsapp/messages/${id}`)).json()
  expect(detail).toMatchObject({
    id,
    status: "read",
    last_event: "read",
    text: "Hello",
    external_id: "wamid.sent",
    media: [],
  })
  expect(detail.events.map((e: { type: string }) => e.type)).toEqual([
    "queued",
    "sent",
    "delivered",
    "read",
  ])
})
test("idempotency replays the same id and rejects a changed body", async () => {
  const f = await setup()
  const body = { to: SENDER, text: "Hi" }
  const first = await (
    await f.call("/whatsapp/messages", "POST", body, f.token, "same")
  ).json()
  expect(
    await (
      await f.call("/whatsapp/messages", "POST", body, f.token, "same")
    ).json()
  ).toEqual(first)
  expect(
    (
      await f.call(
        "/whatsapp/messages",
        "POST",
        { ...body, text: "Changed" },
        f.token,
        "same"
      )
    ).status
  ).toBe(409)
})
test("window rejects every free-form type while templates are allowed; an inbound message opens it", async () => {
  const f = await setup(false)
  const result = await f.call("/whatsapp/messages", "POST", {
    to: SENDER,
    text: "Hi",
  })
  expect(result.status).toBe(422)
  expect(await result.json()).toMatchObject({
    name: "validation_error",
    message: WINDOW_CLOSED,
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("conversations").collect())
  ).toHaveLength(0)
  const id = await send(f, {
    template: {
      name: "hello_world",
      language: "en_US",
      variables: { "1": "Ada" },
    },
  })
  const thread = await f.t.run((ctx) => ctx.db.query("conversations").first())
  expect(thread?.windowExpiresAt).toBeUndefined()
  expect(await message(f, id)).toMatchObject({ type: "template" })
  const content = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", id))
      .unique()
  )
  expect(content?.rendered).toBeUndefined()
  expect(await f.member.client.query(api.messages.get, { id })).toMatchObject({
    rendered: { body: "Template: hello_world", buttons: [] },
  })
  await project(f, incoming())
  const text = await send(f)
  expect(await message(f, text)).toMatchObject({ status: "queued" })
  const identity = await f.t.run((ctx) =>
    ctx.db.query("channelContacts").collect()
  )
  expect(identity).toHaveLength(1)
})
test("from resolves phone id/account id, requires one live number, refuses inactive or unregistered accounts", async () => {
  const f = await setup()
  for (const from of [PHONE_ID, f.account])
    expect(
      (
        await f.call("/whatsapp/messages", "POST", {
          from,
          to: SENDER,
          text: "Hi",
        })
      ).status
    ).toBe(200)
  const second = await f.t.run(async (ctx) => {
    const row = (await ctx.db.get("channelAccounts", f.account))!
    return insertRow(ctx, "channelAccounts", {
      organizationId: row.organizationId,
      connectionId: row.connectionId,
      channel: "whatsapp",
      externalId: "second-phone",
      handle: "+15555555555",
      displayName: "Second",
      status: "active",
      throughputMps: 80,
      registeredAt: Date.now(),
    })
  })
  const ambiguous = await f.call("/whatsapp/messages", "POST", {
    to: SENDER,
    text: "Hi",
  })
  expect(ambiguous.status).toBe(422)
  expect(await ambiguous.json()).toMatchObject({ message: "from is required" })
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", second, {
      disconnectedAt: Date.now(),
      status: "disconnected",
    })
  )
  expect(
    (await f.call("/whatsapp/messages", "POST", { to: SENDER, text: "Hi" }))
      .status
  ).toBe(200)
  for (const patch of [
    { status: "restricted" as const },
    { status: "active" as const, registeredAt: undefined },
  ]) {
    await f.t.run((ctx) => patchRow(ctx, "channelAccounts", f.account, patch))
    expect(
      (
        await f.call("/whatsapp/messages", "POST", {
          from: f.account,
          to: SENDER,
          text: "Hi",
        })
      ).status
    ).toBe(422)
  }
})
for (const code of [130429, 131056, 131047, 131050, 190])
  test(`Graph ${code} follows retry/final/opt-out/token policy`, async () => {
    const f = await setup()
    const graph = fakeGraph([
      {
        path: `/${PHONE_ID}/messages`,
        respond: () => graphError(`Failure ${code}`, code),
      },
    ])
    const enqueue = vi.spyOn(Workpool.prototype, "enqueueAction")
    const id = await send(f)
    await deliver(f, id)
    const row = (await message(f, id))!
    if ([130429, 131056].includes(code)) {
      expect(row).toMatchObject({
        status: "queued",
        generation: 1,
        claimed: false,
        attempts: 1,
      })
      expect(enqueue.mock.calls.at(-1)?.[3]).toMatchObject({
        runAfter: 30_000,
        context: { id, generation: 1 },
      })
      graph.use({
        path: `/${PHONE_ID}/messages`,
        respond: () => ({ messages: [{ id: "wamid.retry" }] }),
      })
      await deliver(f, id, 0)
      expect(graph.calls).toHaveLength(1)
      await deliver(f, id, 1)
      expect(await message(f, id)).toMatchObject({
        status: "sent",
        attempts: 2,
      })
    } else {
      expect(row).toMatchObject({
        status: "failed",
        errorCode: code,
        error: `Failure ${code}`,
      })
      expect(
        (await f.t.run((ctx) => ctx.db.query("events").collect())).some(
          (e) => e.type === "whatsapp.message.failed"
        )
      ).toBe(true)
    }
    if (code === 131050)
      expect(
        await f.t.run((ctx) =>
          ctx.db.get("channelContacts", row.channelContactId)
        )
      ).toMatchObject({ marketingOptOut: true })
    if (code === 190)
      expect(
        await f.t.run((ctx) => ctx.db.query("metaConnections").first())
      ).toMatchObject({ status: "error" })
  })
test("window/account rechecked on claim; throttling reserves once and bumps generation", async () => {
  const f = await setup()
  const id = await send(f)
  const row = (await message(f, id))!
  await f.t.run((ctx) =>
    patchRow(ctx, "conversations", row.conversationId, {
      windowExpiresAt: Date.now(),
    })
  )
  expect(
    await f.t.mutation(internal.channels.messages.claim, { id, generation: 0 })
  ).toBeNull()
  expect(await message(f, id)).toMatchObject({
    status: "failed",
    errorCode: 131047,
  })
  await project(f, incoming("wamid.reopen"))
  const active = await send(f)
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, {
      status: "disconnected",
      disconnectedAt: Date.now(),
    })
  )
  expect(
    await f.t.mutation(internal.channels.messages.claim, {
      id: active,
      generation: 0,
    })
  ).toBeNull()
  expect(await message(f, active)).toMatchObject({ status: "failed" })
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, {
      status: "active",
      disconnectedAt: undefined,
      throughputMps: 1,
    })
  )
  const a = await send(f),
    b = await send(f)
  const first = await f.t.mutation(internal.channels.messages.claim, {
    id: a,
    generation: 0,
  })
  expect(first?.token).toBe("connection-test-token")
  expect(
    await f.t.mutation(internal.channels.messages.claim, {
      id: b,
      generation: 0,
    })
  ).toBeNull()
  expect(await message(f, b)).toMatchObject({
    generation: 1,
    attempts: 0,
    status: "queued",
  })
  vi.setSystemTime(Date.now() + 1100)
  expect(
    await f.t.mutation(internal.channels.messages.claim, {
      id: b,
      generation: 1,
    })
  ).not.toBeNull()
  expect(
    await f.t.mutation(internal.channels.messages.claim, {
      id: b,
      generation: 1,
    })
  ).toBeNull()
})
test("ambiguous network crash is never resent; retired generations and late records are fenced", async () => {
  const f = await setup()
  const graph = fakeGraph([
    {
      path: `/${PHONE_ID}/messages`,
      respond: () => {
        throw new Error("Socket lost after send")
      },
    },
  ])
  const id = await send(f)
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100))
  expect(await message(f, id)).toMatchObject({
    status: "failed",
    error: "The send was interrupted",
    attempts: 1,
  })
  expect(graph.calls).toHaveLength(1)
  await deliver(f, id)
  expect(graph.calls).toHaveLength(1)
})
test("status before send response is reconciled without regression or duplicate sent events", async () => {
  const f = await setup(),
    id = await send(f)
  await f.t.mutation(internal.channels.messages.claim, { id, generation: 0 })
  await f.t.run((ctx) =>
    patchRow(ctx, "channelMessages", id, { externalId: "wamid.race" })
  )
  await project(f, statusBody("wamid.race", "read"))
  await project(f, statusBody("wamid.race", "sent"))
  await f.t.mutation(internal.channels.messages.record, {
    id,
    generation: 0,
    outcome: { kind: "sent", externalId: "wamid.race" },
  })
  expect(await message(f, id)).toMatchObject({
    status: "read",
    sentAt: expect.any(Number),
  })
  expect(
    (await f.t.run((ctx) => ctx.db.query("events").collect())).filter(
      (e) => e.type === "whatsapp.message.sent"
    )
  ).toHaveLength(1)
})
test("REST scoped list/get/phone/conversation pagination and domain-restricted sending keys", async () => {
  const f = await setup()
  const ids = [await send(f), await send(f), await send(f)]
  const page = await (
    await f.call(
      `/whatsapp/messages?limit=1&direction=outbound&status=queued&phone_number_id=${PHONE_ID}`
    )
  ).json()
  expect(page.data[0].id).toBe(ids[2])
  expect(page.has_more).toBe(true)
  const next = await (
    await f.call(
      `/whatsapp/messages?limit=1&direction=outbound&after=${ids[2]}`
    )
  ).json()
  expect(next.data[0].id).toBe(ids[1])
  const before = await (
    await f.call(
      `/whatsapp/messages?limit=1&direction=outbound&before=${ids[1]}`
    )
  ).json()
  expect(before.data[0].id).toBe(ids[2])
  const detail = await (await f.call(`/whatsapp/messages/${ids[0]}`)).json()
  expect(
    (await f.call(`/whatsapp/conversations/${detail.conversation_id}/messages`))
      .status
  ).toBe(200)
  expect(
    (await (await f.call("/whatsapp/conversations")).json()).data
  ).toHaveLength(1)
  expect(
    (await (await f.call("/whatsapp/phone-numbers")).json()).data[0]
  ).toMatchObject({ id: f.account, phone_number_id: PHONE_ID, throughput: 80 })
  expect(
    (await (await f.call(`/whatsapp/phone-numbers/${PHONE_ID}`)).json()).id
  ).toBe(f.account)
  const other = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Other", permission: "full_access", domainId: null },
  })
  for (const path of [
    `/whatsapp/messages/${ids[0]}`,
    `/whatsapp/conversations/${detail.conversation_id}/messages`,
    `/whatsapp/phone-numbers/${PHONE_ID}`,
    `/whatsapp/messages?after=${ids[0]}`,
  ]) {
    expect((await f.call(path, "GET", undefined, other.token)).status).toBe(
      path.includes("after=") ? 422 : 404
    )
  }
  expect(
    (
      await f.call(
        "/whatsapp/messages",
        "POST",
        { from: f.account, to: SENDER, text: "No" },
        other.token
      )
    ).status
  ).toBe(404)
  const restricted = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: {
      name: "Email only",
      permission: "sending_access",
      domainId: f.domain,
    },
  })
  expect(
    (
      await f.call(
        "/whatsapp/messages",
        "POST",
        { to: SENDER, text: "No" },
        restricted.token
      )
    ).status
  ).toBe(403)
  expect((await f.call("/whatsapp/messages?status=invalid")).status).toBe(422)
  expect((await f.call("/whatsapp/messages?after=x&before=y")).status).toBe(422)
})
test("media binary upload, stable replay, signed download, isolation and failure cleanup", async () => {
  const f = await setup()
  const graph = fakeGraph([
    {
      method: "POST",
      path: `/${PHONE_ID}/media`,
      respond: (call) => {
        expect(call.body).toContain('name="messaging_product"')
        expect(call.body).toContain("whatsapp")
        return { id: "meta-upload" }
      },
    },
  ])
  const bytes = new Uint8Array([255, 128, 0, 13, 10, 254])
  const upload = (
    data = bytes,
    type = "image/png",
    bearer = f.token,
    key = "upload-key"
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    const form = new FormData()
    form.append("file", new Blob([data], { type }), "image.png")
    form.append("from", PHONE_ID)
    return f.t.fetch("/whatsapp/media", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Idempotency-Key": key },
      body: form,
    })
  }
  const first = await upload()
  expect(first.status, JSON.stringify(await first.clone().json())).toBe(200)
  expect(await first.json()).toEqual({ id: "meta-upload" })
  expect(await (await upload()).json()).toEqual({ id: "meta-upload" })
  expect(graph.calls).toHaveLength(1)
  expect((await upload(new Uint8Array([2]))).status).toBe(409)
  expect(
    (await upload(bytes, "audio/webm", f.token, "unsupported")).status
  ).toBe(422)
  const files = await f.t.run((ctx) =>
    ctx.db.query("channelMediaUploads").collect()
  )
  expect(files).toHaveLength(1)
  expect(
    new Uint8Array(
      await f.t.run(async (ctx) =>
        (await ctx.storage.get(files[0].storageId!))!.arrayBuffer()
      )
    )
  ).toEqual(bytes)
  const id = await send(f, {
    image: { id: "meta-upload", caption: "Uploaded" },
  })
  const detail = await (await f.call(`/whatsapp/messages/${id}`)).json()
  expect(detail.media[0]).toMatchObject({
    id: "meta-upload",
    size: bytes.length,
    filename: "image.png",
    download_url: expect.any(String),
  })
  const download = await f.t.fetch(
    new URL(detail.media[0].download_url).pathname
  )
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes)
  graph.use({
    path: `/${PHONE_ID}/media`,
    respond: () => graphError("Rejected", 100),
  })
  expect((await upload(bytes, "image/png", f.token, "rejected")).status).toBe(
    422
  )
  expect(
    await f.t.run((ctx) => ctx.db.system.query("_storage").collect())
  ).toHaveLength(1)
  const other = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Other media", permission: "full_access", domainId: null },
  })
  expect((await upload(bytes, "image/png", other.token, "other")).status).toBe(
    404
  )
  const restricted = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: {
      name: "Domain media",
      permission: "sending_access",
      domainId: f.domain,
    },
  })
  expect(
    (await upload(bytes, "image/png", restricted.token, "restricted")).status
  ).toBe(403)
  graph.use({
    path: `/${PHONE_ID}/media`,
    respond: () => graphError("Token expired", 190),
  })
  expect(
    (await upload(bytes, "image/png", f.token, "invalid-token")).status
  ).toBe(422)
  expect(
    await f.t.run((ctx) => ctx.db.query("metaConnections").first())
  ).toMatchObject({ status: "error", error: "Token expired" })
  await f.t.run((ctx) =>
    ctx.db.patch("channelMediaUploads", files[0]._id, { expiresAt: Date.now() })
  )
  await f.t.mutation(internal.channels.mediaUploads.prune, {})
  expect(
    await f.t.run((ctx) => ctx.storage.get(files[0].storageId!))
  ).toBeNull()
})

test("retirement and generation fences prevent later claims or records", async () => {
  const f = await setup(),
    id = await send(f)
  expect(
    await f.t.mutation(internal.channels.messages.claim, { id, generation: 99 })
  ).toBeNull()
  await f.t.run((ctx) =>
    ctx.db.insert("teamRetirements", { teamId: f.owner.team })
  )
  expect(
    await f.t.mutation(internal.channels.messages.claim, { id, generation: 0 })
  ).toBeNull()
  await f.t.mutation(internal.channels.messages.record, {
    id,
    generation: 0,
    outcome: { kind: "sent", externalId: "wamid.retired" },
  })
  expect(await message(f, id)).toMatchObject({ status: "queued", attempts: 0 })
})

test("WhatsApp sent fans out a signed customer webhook", async () => {
  const f = await setup()
  const workpoolTest = (await import("@convex-dev/workpool/test")).default
  workpoolTest.register(f.t, "webhookPool")
  const webhookId = await f.owner.client.action(api.webhooks.create, {
    organizationId: f.owner.team,
    endpoint: "https://whatsapp-send.invalid/events",
    events: ["whatsapp.message.sent"],
  })
  const graph = fakeGraph([
    {
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: "wamid.customer" }] }),
    },
    // The customer endpoint, answered by the same publicFetch stub.
    { path: "/events", respond: () => ({ ok: true }) },
  ])
  const id = await send(f)
  await deliver(f, id)
  const event = await f.t.run(async (ctx) =>
    (await ctx.db.query("events").collect()).find(
      (e) => e.type === "whatsapp.message.sent"
    )
  )
  await f.t.mutation(internal.webhooks.deliverEvent, { id: event!._id })
  const delivery = await f.t.run((ctx) =>
    ctx.db
      .query("webhookDeliveries")
      .withIndex("by_webhookId", (q) => q.eq("webhookId", webhookId))
      .first()
  )
  await f.t.action(internal.webhookDelivery.attempt, {
    id: delivery!._id,
    attempt: 0,
  })
  expect(graph.to("/events")[0].body).toMatchObject({
    type: "whatsapp.message.sent",
    data: { id, external_id: "wamid.customer" },
  })
  const call = graph.spy.mock.calls.find(
    ([url]) => new URL(url).pathname === "/events"
  )!
  const headers = call[1]!.headers!
  const secret = (await f.owner.client.query(api.webhooks.signingSecret, {
    id: webhookId,
  }))!
  const { webhookSignature } = await import("../lib/webhooks/signing")
  expect(headers["svix-signature"]).toBe(
    await webhookSignature({
      id: headers["svix-id"],
      timestamp: Number(headers["svix-timestamp"]),
      body: call[1]!.body as string,
      secret,
    })
  )
})
