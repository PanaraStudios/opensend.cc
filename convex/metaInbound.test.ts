/// <reference types="vite/client" />
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { internal, api } from "./_generated/api"
import { insertRow } from "./counts"
import { upsertContact } from "./audience"
import {
  inboundFixture,
  signedWebhook,
  fakeGraph,
  APP_SECRET,
  PHONE_ID,
  SENDER,
  envelope,
  incoming,
} from "./testHelpers/meta.fixture"
import { mediaDownloadLink } from "./channels/downloads"
import { signedFileLink } from "./fileDownloads"
import { limitedBody, BodyTooLarge } from "./ses/web"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
  vi.stubEnv("BETTER_AUTH_SECRET", "meta-inbound-download-key")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function post(
  f: Awaited<ReturnType<typeof inboundFixture>>,
  payload: unknown
) {
  return f.t.fetch("/meta/webhook", await signedWebhook(APP_SECRET, payload))
}
async function project(
  f: Awaited<ReturnType<typeof inboundFixture>>,
  payload: unknown,
  attempt = 0
) {
  expect((await post(f, payload)).status).toBe(200)
  const event = await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  )
  await f.t.mutation(internal.meta.projection.project, {
    id: event!._id,
    attempt,
  })
  return event!._id
}
async function rows(f: Awaited<ReturnType<typeof inboundFixture>>) {
  return f.t.run(async (ctx) => ({
    contacts: await ctx.db.query("contacts").collect(),
    identities: await ctx.db.query("channelContacts").collect(),
    conversations: await ctx.db.query("conversations").collect(),
    messages: await ctx.db.query("channelMessages").collect(),
    contents: await ctx.db.query("channelMessageContents").collect(),
    timeline: await ctx.db.query("channelMessageEvents").collect(),
    events: await ctx.db.query("events").collect(),
  }))
}
async function outbound(
  f: Awaited<ReturnType<typeof inboundFixture>>,
  externalId: string
) {
  await project(f, incoming())
  const data = await rows(f),
    received = data.messages[0]
  return f.t.run((ctx) =>
    insertRow(
      ctx,
      "channelMessages",
      {
        organizationId: f.owner.team,
        channel: "whatsapp",
        accountId: f.account,
        conversationId: received.conversationId,
        channelContactId: received.channelContactId,
        direction: "outbound",
        from: PHONE_ID,
        to: SENDER,
        type: "text",
        status: "sent",
        externalId,
        preview: "Reply",
        generation: 1,
        attempts: 1,
        search: "Reply",
      },
      true
    )
  )
}
const statusPayload = (id: string, status: string, extra = {}) =>
  envelope({
    metadata: { phone_number_id: PHONE_ID },
    statuses: [
      {
        id,
        status,
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: SENDER,
        ...extra,
      },
    ],
  })

test("missing, wrong and altered signatures refuse storage; raw bytes are capped", async () => {
  const f = await inboundFixture()
  for (const headers of [
    {},
    { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) },
  ] as Record<string, string>[])
    expect(
      (
        await f.t.fetch("/meta/webhook", {
          method: "POST",
          body: JSON.stringify(incoming()),
          headers,
        })
      ).status
    ).toBe(401)
  const signed = await signedWebhook(APP_SECRET, incoming())
  expect(
    (await f.t.fetch("/meta/webhook", { ...signed, body: signed.body + " " }))
      .status
  ).toBe(401)
  expect(
    (
      await f.t.fetch("/meta/webhook", {
        method: "POST",
        body: "x".repeat(1024 * 1024 + 1),
      })
    ).status
  ).toBe(413)
  expect(
    await f.t.run((ctx) => ctx.db.query("metaWebhookEvents").collect())
  ).toEqual([])
  expect((await post(f, "{")).status).toBe(400)
  expect((await post(f, { object: 1 })).status).toBe(400)
})

test("durable storage failure asks Meta to retry", async () => {
  const f = await inboundFixture()
  // Force the storage index invariant to fail after signature verification.
  const payload = incoming(),
    signed = await signedWebhook(APP_SECRET, payload)
  expect((await f.t.fetch("/meta/webhook", signed)).status).toBe(200)
  await f.t.run(async (ctx) => {
    const event = (await ctx.db.query("metaWebhookEvents").first())!
    await ctx.db.insert("metaWebhookEvents", {
      body: event.body,
      bodyHash: event.bodyHash,
      object: event.object,
      receivedAt: event.receivedAt,
    })
  })
  expect((await f.t.fetch("/meta/webhook", signed)).status).toBe(503)
})

test("a text creates phone-only audience, identity, conversation, timeline and both outbox events exactly once", async () => {
  const f = await inboundFixture(),
    at = Math.floor(Date.now() / 1000)
  const payload = incoming("wamid.text", at)
  const id = await project(f, payload)
  await post(f, payload)
  await f.t.mutation(internal.meta.projection.project, { id })
  // Different delivery bytes still dedupe by wamid.
  await project(f, { ...payload, ignored: true })
  const data = await rows(f)
  expect(data.contacts).toHaveLength(1)
  expect(data.contacts[0]).toMatchObject({
    phone: "+16505551234",
    firstName: "Sheena",
    lastName: "Nelson",
  })
  expect(data.contacts[0].email).toBeUndefined()
  expect(data.identities).toHaveLength(1)
  expect(data.identities[0]).toMatchObject({
    contactId: data.contacts[0]._id,
    externalId: SENDER,
    scopeId: "whatsapp",
    profileName: "Sheena Nelson",
    lastInboundAt: at * 1000,
  })
  expect(data.conversations[0]).toMatchObject({
    unread: true,
    unreadCount: 1,
    windowExpiresAt: at * 1000 + 24 * 3600_000,
    lastInboundAt: at * 1000,
  })
  expect(data.messages).toHaveLength(1)
  expect(data.timeline).toHaveLength(1)
  expect(JSON.parse(data.contents[0].payload).text.body).toBe(
    "Does it come in another color?"
  )
  const event = data.events.find(
    (event) => event.type === "whatsapp.message.received"
  )!
  expect(event.data).toMatchObject({
    id: data.messages[0]._id,
    account_id: f.account,
    conversation_id: data.conversations[0]._id,
    channel: "whatsapp",
    from: SENDER,
    to: PHONE_ID,
    type: "text",
    status: "received",
    text: "Does it come in another color?",
    created_at: expect.any(String),
  })
  expect(
    data.events.find(
      (event) => event.type === "custom:opensend:whatsapp.message.received"
    )?.data
  ).toEqual({ contact_id: data.contacts[0]._id, payload: event.data })
  const count = await f.owner.client.query(api.contacts.list, {
    organizationId: f.owner.team,
    paginationOpts: { numItems: 10, cursor: null },
  })
  expect(count.page).toHaveLength(1)
})

test("matches existing contact by normalized phone and never rolls back the window for old deliveries", async () => {
  const f = await inboundFixture()
  const made = await f.t.run((ctx) =>
    upsertContact(
      ctx,
      f.owner.team,
      {
        email: "known@example.test",
        phone: "+1 (650) 555-1234",
        firstName: "Known",
      },
      { properties: [], segmentIds: [] }
    )
  )
  const now = Math.floor(Date.now() / 1000)
  await project(f, incoming("new", now))
  await project(f, incoming("old", now - 3600))
  const data = await rows(f)
  expect(data.contacts).toHaveLength(1)
  // The WhatsApp profile name never overwrites a name the team set.
  expect(data.contacts[0]).toMatchObject({ firstName: "Known", lastName: "" })
  expect(data.identities[0].contactId).toBe(made.id)
  expect(data.conversations[0]).toMatchObject({
    lastMessageAt: now * 1000,
    windowExpiresAt: now * 1000 + 24 * 3600_000,
    unreadCount: 2,
  })
})

test("an early status retries without any partial projection, then applies once the send is recorded", async () => {
  const f = await inboundFixture()
  const payload = statusPayload("wamid.early", "delivered")
  const id = await project(f, payload)
  expect(
    (await f.t.run((ctx) => ctx.db.get("metaWebhookEvents", id)))?.projectedAt
  ).toBeUndefined()
  const scheduled = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect()
  )
  expect(scheduled.some((job) => job.args[0].attempt === 1)).toBe(true)
  const message = await outbound(f, "wamid.early")
  await f.t.mutation(internal.meta.projection.project, { id, attempt: 1 })
  expect(
    (await f.t.run((ctx) => ctx.db.get("channelMessages", message._id)))?.status
  ).toBe("delivered")
  await f.t.mutation(internal.meta.projection.project, { id, attempt: 2 })
  expect(
    (await rows(f)).timeline.filter((e) => e.messageId === message._id)
  ).toHaveLength(1)
})

test("statuses never regress; failed is final and stores errors, pricing and conversation evidence", async () => {
  const f = await inboundFixture(),
    message = await outbound(f, "wamid.status")
  for (const status of ["read", "delivered", "sent"])
    await project(f, statusPayload("wamid.status", status))
  expect(
    (await f.t.run((ctx) => ctx.db.get("channelMessages", message._id)))?.status
  ).toBe("read")
  const details = {
    errors: [{ code: 131050, title: "Opted out", message: "User opted out" }],
    pricing: { billable: false, category: "marketing" },
    conversation: { id: "conversation-meta" },
  }
  await project(f, statusPayload("wamid.status", "failed", details))
  await project(f, statusPayload("wamid.status", "read", { extra: "late" }))
  expect(
    await f.t.run((ctx) => ctx.db.get("channelMessages", message._id))
  ).toMatchObject({
    status: "failed",
    errorCode: 131050,
    error: "User opted out",
  })
  const data = await rows(f)
  expect(data.timeline.filter((e) => e.messageId === message._id)).toHaveLength(
    5
  )
  expect(
    JSON.parse(data.timeline.find((e) => e.type === "failed")!.details!)
  ).toMatchObject(details)
  expect(data.identities[0].marketingOptOut).toBe(true)
  expect(
    data.events.find((e) => e.type === "whatsapp.message.failed")?.data
  ).toMatchObject(details)
})

test("drops unmatched statuses after backoff and ignores unknown WABA, phone and wrong account statuses", async () => {
  const f = await inboundFixture(),
    log = vi.spyOn(console, "info").mockImplementation(() => {})
  const id = await project(f, statusPayload("missing", "read"), 6)
  expect(
    (await f.t.run((ctx) => ctx.db.get("metaWebhookEvents", id)))?.projectedAt
  ).toBeTypeOf("number")
  await project(
    f,
    envelope({
      metadata: { phone_number_id: "unknown" },
      messages: [{ id: "unknown", from: SENDER, type: "text" }],
    })
  )
  await project(f, envelope({}, "messages", "unknown-waba"))
  expect((await rows(f)).messages).toEqual([])
  expect(log).toHaveBeenCalled()
})

test("official quality/name/account payloads route by WABA and display number; templates emit without metadata", async () => {
  const f = await inboundFixture()
  await project(
    f,
    envelope(
      {
        display_phone_number: "15550783881",
        event: "THROUGHPUT_UPGRADE",
        max_daily_conversations_per_business: "TIER_2K",
        current_limit: "TIER_UNLIMITED",
      },
      "phone_number_quality_update"
    )
  )
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  expect(
    await f.t.run((ctx) => ctx.db.get("channelAccounts", f.account))
  ).toMatchObject({ messagingLimit: "TIER_2K", throughputMps: 1000 })
  await project(
    f,
    envelope(
      {
        display_phone_number: "15550783881",
        decision: "APPROVED",
        requested_verified_name: "New name",
        rejection_reason: null,
      },
      "phone_number_name_update"
    )
  )
  await project(
    f,
    envelope(
      { event: "DISABLED_UPDATE", ban_info: { waba_ban_state: "DISABLE" } },
      "account_update"
    )
  )
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  expect(
    await f.t.run((ctx) => ctx.db.get("channelAccounts", f.account))
  ).toMatchObject({ displayName: "New name", status: "restricted" })
  for (const field of [
    "message_template_status_update",
    "template_category_update",
  ])
    await project(
      f,
      envelope(
        {
          message_template_id: 1689556908129832,
          event: "APPROVED",
          new_category: "UTILITY",
        },
        field
      )
    )
  expect(
    (await rows(f)).events.filter(
      (e) => e.type === "whatsapp.template.status_updated"
    )
  ).toHaveLength(2)
})

test("media fetch stores bytes and signed downloads reject tampering, expiry, cross-audience tokens and deleted messages", async () => {
  const f = await inboundFixture()
  const stub = fakeGraph([
    {
      path: "/media-1",
      respond: () => ({
        url: "https://media.example.test/file",
        mime_type: "image/png",
        file_size: 3,
      }),
    },
    { path: "/file", respond: () => new Response(new Uint8Array([1, 2, 3])) },
  ])
  const id = await project(
    f,
    envelope({
      metadata: { phone_number_id: PHONE_ID },
      messages: [
        {
          from: SENDER,
          id: "wamid.media",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "image",
          image: { id: "media-1", mime_type: "image/png" },
        },
      ],
    })
  )
  expect(id).toBeTruthy()
  const data = await rows(f),
    messageId = data.messages[0]._id
  expect(data.contents[0].media?.[0]).toMatchObject({ mediaId: "media-1" })
  expect(data.contents[0].media?.[0].storageId).toBeUndefined()
  await f.t.action(internal.channels.media.fetch, {
    messageId,
    mediaId: "media-1",
  })
  const media = (await rows(f)).contents[0].media![0]
  expect(media).toMatchObject({
    storageId: expect.any(String),
    size: 3,
    contentType: "image/png",
  })
  expect(stub.spy.mock.calls[1][1]).toMatchObject({
    headers: { authorization: "Bearer connection-test-token" },
    maxBytes: 25 * 1024 * 1024,
  })
  const link = await f.t.run((ctx) =>
    mediaDownloadLink(ctx, messageId, "media-1")
  )
  const download = await f.t.fetch(new URL(link.download_url).pathname)
  expect(download.status).toBe(200)
  expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual([
    1, 2, 3,
  ])
  expect(
    (await f.t.fetch(new URL(link.download_url).pathname + "bad")).status
  ).toBe(404)
  const wrong = await f.t.run((ctx) =>
    signedFileLink(ctx, "/channels/media/", "received-file", {
      messageId,
      mediaId: "media-1",
    })
  )
  expect((await f.t.fetch(new URL(wrong.download_url).pathname)).status).toBe(
    404
  )
  const fresh = await f.t.run((ctx) =>
    mediaDownloadLink(ctx, messageId, "media-1")
  )
  await f.t.run(async (ctx) => {
    const content = (await ctx.db.query("channelMessageContents").first())!
    await ctx.db.delete("channelMessageContents", content._id)
  })
  expect((await f.t.fetch(new URL(fresh.download_url).pathname)).status).toBe(
    404
  )
  vi.advanceTimersByTime(3601_000)
  expect((await f.t.fetch(new URL(link.download_url).pathname)).status).toBe(
    404
  )
})

test("transient media failures retry; oversized media is final; deletion races remove the stored file", async () => {
  const f = await inboundFixture()
  const payload = envelope({
    metadata: { phone_number_id: PHONE_ID },
    messages: [
      {
        from: SENDER,
        id: "media",
        type: "document",
        document: { id: "media-2" },
      },
    ],
  })
  await project(f, payload)
  const messageId = (await rows(f)).messages[0]._id
  const stub = fakeGraph([
    {
      path: "/media-2",
      respond: () =>
        Response.json(
          { error: { code: 1, message: "Temporary", is_transient: true } },
          { status: 500 }
        ),
    },
  ])
  await f.t.action(internal.channels.media.fetch, {
    messageId,
    mediaId: "media-2",
  })
  expect(
    (
      await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect()
      )
    ).some((job) => job.args[0].attempt === 1)
  ).toBe(true)
  stub.spy.mockResolvedValue(
    Response.json({
      url: "https://media.example.test/file",
      file_size: 26 * 1024 * 1024,
    })
  )
  await f.t.action(internal.channels.media.fetch, {
    messageId,
    mediaId: "media-2",
    attempt: 5,
  })
  expect((await rows(f)).contents[0].media![0].error).toContain("25 MB")
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["orphan"]))
  )
  await f.t.run(async (ctx) => {
    const content = await ctx.db.query("channelMessageContents").first()
    await ctx.db.delete("channelMessageContents", content!._id)
  })
  await f.t.mutation(internal.channels.mediaState.complete, {
    messageId,
    mediaId: "media-2",
    file: { storageId, contentType: "text/plain", size: 6 },
  })
  expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull()
})

test("seven-day raw webhook retention deletes in bounded batches", async () => {
  const f = await inboundFixture()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 105; i++)
      await ctx.db.insert("metaWebhookEvents", {
        object: "page",
        body: "{}",
        bodyHash: `old-${i}`,
        receivedAt: Date.now() - 8 * 86400_000,
      })
    await ctx.db.insert("metaWebhookEvents", {
      object: "page",
      body: "{}",
      bodyHash: "new",
      receivedAt: Date.now(),
    })
  })
  await f.t.mutation(internal.retention.meta, {})
  expect(
    await f.t.run((ctx) => ctx.db.query("metaWebhookEvents").collect())
  ).toHaveLength(6)
  await f.t.mutation(internal.retention.meta, {})
  expect(
    await f.t.run((ctx) => ctx.db.query("metaWebhookEvents").collect())
  ).toHaveLength(1)
})

test("the reserved reply event starts phone-only automations and resumes wait-for-reply through existing dispatch", async () => {
  const f = await inboundFixture()
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
  })
  const trigger = "opensend:whatsapp.message.received"
  const automationId = await f.t.run((ctx) =>
    insertRow(ctx, "automations", {
      organizationId: f.owner.team,
      name: "Wait for reply",
      status: "enabled",
      deleted: false,
      trigger,
      updatedAt: Date.now(),
      graph: JSON.stringify([
        {
          key: "reply",
          type: "wait_for_event",
          eventName: trigger,
          timeout: "1 hour",
          received: [
            {
              key: "update",
              type: "contact_update",
              fields: [
                {
                  property: "first_name",
                  action: "change",
                  value: "event.text",
                },
              ],
            },
          ],
          timedOut: [],
        },
      ]),
    })
  )
  const tick = async () => {
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(100)
      await f.t.finishInProgressScheduledFunctions()
    }
  }
  await post(f, incoming("first-reply"))
  await tick()
  const runs = () =>
    f.t.run((ctx) =>
      ctx.db
        .query("automationRuns")
        .withIndex("by_organizationId_and_automationId", (q) =>
          q.eq("organizationId", f.owner.team).eq("automationId", automationId)
        )
        .collect()
    )
  const first = (await runs())[0]
  expect(first).toMatchObject({
    trigger,
    waitingName: trigger,
    status: "running",
  })
  expect(first.contactEmail).toBeUndefined()
  await post(f, incoming("second-reply"))
  await tick()
  expect(
    await f.t.run((ctx) => ctx.db.get("automationRuns", first._id))
  ).toMatchObject({ status: "completed" })
  expect((await rows(f)).contacts[0].firstName).toBe(
    "Does it come in another color?"
  )
  expect(await runs()).toHaveLength(2)
})

test("bounded body reader preserves raw bytes across UTF-8 chunk boundaries", async () => {
  const bytes = new TextEncoder().encode("A😀B")
  const response = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 3))
          controller.enqueue(bytes.slice(3))
          controller.close()
        },
      })
    )
  expect(await limitedBody(response(), 10)).toBe("A😀B")
  expect(await limitedBody(response(), 10, { raw: true })).toEqual(bytes)
  expect(
    await limitedBody(response(), 2, { raw: true, truncate: true })
  ).toEqual(bytes.slice(0, 2))
  await expect(
    limitedBody(response(), 2, { raw: true })
  ).rejects.toBeInstanceOf(BodyTooLarge)
  expect(await limitedBody(new Response(null), 2, { raw: true })).toEqual(
    new Uint8Array(0)
  )
})

test("routes a phone number id to its connected team when another team's disconnected row remains", async () => {
  const f = await inboundFixture()
  await f.t.run(async (ctx) => {
    const account = (await ctx.db.get("channelAccounts", f.account))!
    await insertRow(ctx, "channelAccounts", {
      organizationId: f.outsider.team,
      channel: account.channel,
      externalId: account.externalId,
      connectionId: account.connectionId,
      wabaId: account.wabaId,
      displayName: account.displayName,
      handle: account.handle,
      status: account.status,
      throughputMps: account.throughputMps,
      disconnectedAt: Date.now() - 1000,
    })
  })
  await project(f, incoming("wamid.after-reconnect"))
  const { messages } = await rows(f)
  expect(messages).toHaveLength(1)
  expect(messages[0]).toMatchObject({
    organizationId: f.owner.team,
    accountId: f.account,
    direction: "inbound",
  })
})
