import { beforeEach, afterEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, internal } from "../_generated/api"
import { patchRow } from "../counts"
import { storeTestCredentials } from "../testHelpers/ses.fixture"
import {
  inboundFixture,
  incoming,
  signedWebhook,
  APP_SECRET,
  PHONE_ID,
  SENDER,
  fakeGraph,
} from "../testHelpers/meta.fixture"
import {
  pageGraphRoutes,
  pageEnvelope,
  PAGE_ID,
  PAGE_TOKEN,
  IG_ID,
  PSID,
  IGSID,
} from "../testHelpers/pages.fixture"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "message-fixture-encryption-".repeat(3))
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("BETTER_AUTH_SECRET", "message-contract-secret")
  vi.stubEnv("SITE_URL", "https://opensend.test")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function setup() {
  const graph = fakeGraph(pageGraphRoutes())
  const f = await inboundFixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await storeTestCredentials(f)
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "channelAccounts", f.account, {
      registeredAt: Date.now(),
    })
    await patchRow(ctx, "domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-team-cfg",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 10 },
    })
  })
  await f.owner.client.action(api.meta.pageConnectActions.connectPageManual, {
    organizationId: f.owner.team,
    pageId: PAGE_ID,
    token: PAGE_TOKEN,
  })
  for (const payload of [
    incoming(),
    pageEnvelope("messenger", {
      message: { mid: "mid.inbound", text: "Hello" },
    }),
    pageEnvelope("instagram", {
      message: { mid: "ig.inbound", text: "Hello" },
    }),
  ]) {
    expect(
      (
        await f.t.fetch(
          "/meta/webhook",
          await signedWebhook(APP_SECRET, payload)
        )
      ).status
    ).toBe(200)
    const event = await f.t.run((ctx) =>
      ctx.db.query("metaWebhookEvents").order("desc").first()
    )
    await f.t.mutation(internal.meta.projection.project, { id: event!._id })
    vi.setSystemTime(Date.now() + 1100)
  }
  const key = async (scopes?: string[], outsider = false, sending = false) =>
    (outsider ? f.outsider : f.owner).client.action(api.apiKeys.create, {
      organizationId: outsider ? f.outsider.team : f.owner.team,
      input: {
        name: "Messages contract",
        permission: sending
          ? "sending_access"
          : scopes
            ? "custom"
            : "full_access",
        domainId: null,
        ...(scopes ? { scopes } : {}),
      },
    })
  const { token } = await key()
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    bearer = token,
    idempotencyKey?: string
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  const email = {
    channel: "email",
    from: "sender@mail.example.test",
    to: "recipient@example.test",
    subject: "Unified email",
    text: "Unified email body",
  }
  return { ...f, call, key, email, graph }
}
const bodies = {
  whatsapp: {
    channel: "whatsapp",
    from: PHONE_ID,
    to: SENDER,
    text: "Unified WhatsApp",
  },
  messenger: {
    channel: "messenger",
    from: PAGE_ID,
    to: PSID,
    text: "Unified Messenger",
  },
  instagram: {
    channel: "instagram",
    from: IG_ID,
    to: IGSID,
    text: "Unified Instagram",
  },
}
async function sent(
  f: Awaited<ReturnType<typeof setup>>,
  body: unknown,
  token?: string,
  key?: string
) {
  const result = await f.call("/messages", "POST", body, token, key)
  expect(result.status, await result.clone().text()).toBe(200)
  return (await result.json()).id as string
}

test("all four channels use their existing senders and the common read shape", async () => {
  const f = await setup()
  for (const body of [f.email, ...Object.values(bodies)]) {
    const id = await sent(f, body)
    const result = await f.call(`/messages/${id}`)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      id,
      object: "message",
      channel: body.channel,
      direction: "outbound",
      status: "queued",
      preview: body.text,
      contact_id: body.channel === "email" ? null : expect.any(String),
    })
    const legacy = await f.call(
      body.channel === "email"
        ? `/emails/${id}`
        : `/${body.channel}/messages/${id}`
    )
    expect(legacy.status).toBe(200)
    expect((await legacy.json()).id).toBe(id)
  }
  const page = await (await f.call("/messages?direction=outbound")).json()
  expect(page.data.map((m: { channel: string }) => m.channel)).toEqual([
    "instagram",
    "messenger",
    "whatsapp",
    "email",
  ])
})

test("POST idempotency replays each channel and rejects a changed payload or endpoint", async () => {
  const f = await setup()
  for (const body of [f.email, ...Object.values(bodies)]) {
    const key = `message-${body.channel}`
    const id = await sent(f, body, undefined, key)
    expect(await sent(f, body, undefined, key)).toBe(id)
    expect(
      (
        await f.call(
          "/messages",
          "POST",
          { ...body, text: "Changed" },
          undefined,
          key
        )
      ).status
    ).toBe(409)
    expect(
      (
        await f.call(
          body.channel === "email" ? "/emails" : `/${body.channel}/messages`,
          "POST",
          body,
          undefined,
          key
        )
      ).status
    ).toBe(409)
  }
  expect(
    (await (await f.call("/messages?direction=outbound")).json()).data
  ).toHaveLength(4)
})

test("Custom whatsapp:write sends and reads only WhatsApp, with explicit scopes and tenant isolation", async () => {
  const f = await setup()
  const wa = await f.key(["whatsapp:write"])
  const read = await f.key(["whatsapp:read"])
  const unrelated = await f.key(["contacts:write"])
  const foreign = await f.key(undefined, true)
  const waId = await sent(f, bodies.whatsapp, wa.token)
  const emailId = await sent(f, f.email)
  expect((await f.call("/messages", "POST", f.email, wa.token)).status).toBe(
    403
  )
  expect(
    (await f.call("/messages", "POST", bodies.whatsapp, read.token)).status
  ).toBe(403)
  expect(
    (await f.call("/messages?channel=email", "GET", undefined, wa.token)).status
  ).toBe(403)
  expect(
    (await f.call(`/messages/${emailId}`, "GET", undefined, wa.token)).status
  ).toBe(403)
  expect(
    (await f.call(`/messages/${waId}`, "GET", undefined, foreign.token)).status
  ).toBe(404)
  expect(
    (await f.call("/messages", "GET", undefined, unrelated.token)).status
  ).toBe(403)
  const list = await (
    await f.call("/messages", "GET", undefined, wa.token)
  ).json()
  expect(list.data.length).toBeGreaterThan(0)
  expect(
    list.data.every((m: { channel: string }) => m.channel === "whatsapp")
  ).toBe(true)
  const sending = await f.key(undefined, false, true)
  await sent(f, f.email, sending.token)
  expect(
    (await f.call("/messages", "POST", bodies.whatsapp, sending.token)).status
  ).toBe(403)
})

test("merged cursors stay ordered through inserts and are bound to filters and readable channels", async () => {
  const f = await setup()
  const ids = []
  for (const body of [
    f.email,
    bodies.whatsapp,
    bodies.messenger,
    bodies.instagram,
  ])
    ids.push(await sent(f, body))
  const first = await (
    await f.call("/messages?direction=outbound&limit=2")
  ).json()
  expect(first.data.map((m: { id: string }) => m.id)).toEqual(
    ids.slice(2).reverse()
  )
  expect(first.has_more).toBe(true)
  await sent(f, { ...f.email, text: "New after first page" })
  const next = `/messages?direction=outbound&limit=2&cursor=${encodeURIComponent(first.next_cursor)}`
  const second = await (await f.call(next)).json()
  expect(second.data.map((m: { id: string }) => m.id)).toEqual(
    ids.slice(0, 2).reverse()
  )
  const end = await (
    await f.call(
      `/messages?direction=outbound&limit=2&cursor=${encodeURIComponent(second.next_cursor)}`
    )
  ).json()
  expect(end).toMatchObject({ data: [], has_more: false, next_cursor: null })
  expect((await f.call(next.replace("outbound", "inbound"))).status).toBe(422)
  expect(
    (
      await f.call(
        next,
        "GET",
        undefined,
        (await f.key(["whatsapp:read"])).token
      )
    ).status
  ).toBe(422)
  expect((await f.call("/messages?cursor=invalid")).status).toBe(422)
  const malformed = JSON.parse(first.next_cursor)
  malformed.cursor = "invalid"
  expect(
    (
      await f.call(
        `/messages?direction=outbound&cursor=${encodeURIComponent(JSON.stringify(malformed))}`
      )
    ).status
  ).toBe(422)
})

test("filters cover sender, recipient, contact, status, direction, channel and creation range", async () => {
  const f = await setup()
  const id = await sent(f, bodies.whatsapp)
  const message = await (await f.call(`/messages/${id}`)).json()
  const query = new URLSearchParams({
    channel: "whatsapp",
    direction: "outbound",
    status: "queued",
    contact_id: message.contact_id,
    from: message.from,
    to: message.to,
    created_after: message.created_at,
    created_before: message.created_at,
  })
  expect(
    (await (await f.call(`/messages?${query}`)).json()).data.map(
      (m: { id: string }) => m.id
    )
  ).toEqual([id])
  expect((await (await f.call("/messages?to=unknown")).json()).data).toEqual([])
  expect(
    (await (await f.call("/messages?direction=inbound")).json()).data.every(
      (m: { direction: string }) => m.direction === "inbound"
    )
  ).toBe(true)
})

test("per-channel validation is readable and rejected sends leave no outbound messages", async () => {
  const f = await setup()
  for (const body of [
    { channel: "sms", to: "recipient", text: "Hello" },
    { ...bodies.whatsapp, subject: "Email only" },
    { ...bodies.messenger, html: "<p>Email only</p>" },
    { ...bodies.instagram, text: 123 },
    { ...bodies.whatsapp, template: { alias: "x" } },
    { ...bodies.messenger, template: { id: "x", alias: "y" }, text: undefined },
    {
      ...bodies.whatsapp,
      text: undefined,
      media: [
        { type: "image", url: "https://example.test/i" },
        { type: "image", url: "https://example.test/j" },
      ],
    },
  ]) {
    const response = await f.call("/messages", "POST", body)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      name: "validation_error",
      message: expect.any(String),
    })
  }
  expect(
    (await (await f.call("/messages?direction=outbound")).json()).data
  ).toEqual([])
})

test("adjacent creation timestamps stay ordered across tables and one-item pages", async () => {
  const f = await setup()
  const emailId = await sent(f, f.email)
  const channelId = await sent(f, bodies.whatsapp)
  const clones = await f.t.run(async (ctx) => {
    const email = await ctx.db.get(
      "emails",
      ctx.db.normalizeId("emails", emailId)!
    )
    const message = await ctx.db.get(
      "channelMessages",
      ctx.db.normalizeId("channelMessages", channelId)!
    )
    const {
      _id: emailIgnored,
      _creationTime: timeIgnored,
      ...emailFields
    } = email!
    const {
      _id: messageIgnored,
      _creationTime: messageTimeIgnored,
      ...messageFields
    } = message!
    void [emailIgnored, timeIgnored, messageIgnored, messageTimeIgnored]
    const a = await ctx.db.insert("emails", emailFields)
    const b = await ctx.db.insert("channelMessages", messageFields)
    const c = await ctx.db.insert("emails", emailFields)
    return [a, b, c]
  })
  const all = await (await f.call("/messages?direction=outbound")).json()
  expect(all.data.slice(0, 3).map((m: { id: string }) => m.id)).toEqual(
    [...clones].reverse()
  )
  const seen = []
  let cursor: string | null = null
  for (let page = 0; page < 10; page++) {
    const result = await (
      await f.call(
        `/messages?direction=outbound&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      )
    ).json()
    seen.push(...result.data.map((m: { id: string }) => m.id))
    cursor = result.next_cursor
    if (!cursor) break
  }
  expect(cursor).toBeNull()
  expect(seen).toEqual(all.data.map((m: { id: string }) => m.id))
  expect(new Set(seen).size).toBe(5)
})

test("neutral media delegates to existing content validation and email attachments", async () => {
  const f = await setup()
  const id = await sent(f, {
    ...f.email,
    media: [
      {
        type: "file",
        filename: "hello.txt",
        content: btoa("hello"),
        content_type: "text/plain",
      },
    ],
  })
  const legacy = await (await f.call(`/emails/${id}/attachments`)).json()
  expect(legacy.data[0]).toMatchObject({ filename: "hello.txt", size: 5 })
  for (const channel of ["whatsapp", "messenger", "instagram"] as const) {
    const id = await sent(f, {
      ...bodies[channel],
      text: undefined,
      media: [{ type: "image", url: "https://example.test/image.png" }],
    })
    const result = await (await f.call(`/messages/${id}`)).json()
    expect(result).toMatchObject({
      object: "message",
      channel,
      type: "image",
      status: "queued",
    })
  }
})

test("inbound Meta webhook payloads retain their content and add every common message field", async () => {
  const f = await setup()
  const events = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.owner.team)
      )
      .take(100)
  )
  const received = events.filter(
    (e) => !e.type.startsWith("custom:") && e.type.endsWith(".message.received")
  )
  expect(new Set(received.map((event) => event.type))).toEqual(
    new Set([
      "whatsapp.message.received",
      "messenger.message.received",
      "instagram.message.received",
    ])
  )
  for (const event of received) {
    expect(event.data).toMatchObject({
      id: expect.any(String),
      object: "message",
      channel: event.type.split(".")[0],
      direction: "inbound",
      status: "received",
      from: expect.any(String),
      to: expect.any(String),
      preview: expect.any(String),
      created_at: expect.any(String),
      contact_id: expect.any(String),
      conversation_id: expect.any(String),
    })
  }
})

test("email template aliases render the preview; webhooks share fields without the body", async () => {
  const f = await setup()
  const template = await f.owner.client.mutation(api.templates.create, {
    organizationId: f.owner.team,
    name: "Unified welcome",
    subject: "Hello {{{NAME}}}",
    html: "<p>Welcome {{{NAME}}}</p>",
  })
  await f.owner.client.mutation(api.templates.publish, { id: template })
  const id = await sent(f, {
    channel: "email",
    from: f.email.from,
    to: f.email.to,
    template: { alias: "unified-welcome", variables: { NAME: "Ada" } },
    tags: [{ name: "flow", value: "welcome" }],
  })
  const message = await (await f.call(`/messages/${id}`)).json()
  expect(message).toMatchObject({
    subject: "Hello Ada",
    preview: "Welcome Ada",
  })
  const { emailEventData } = await import("../emails")
  const event = await f.t.run(async (ctx) =>
    emailEventData(
      ctx,
      (await ctx.db.get("emails", ctx.db.normalizeId("emails", id)!))!
    )
  )
  expect(event).toMatchObject({
    id,
    object: "message",
    channel: "email",
    direction: "outbound",
    from: f.email.from,
    to: [f.email.to],
    status: "queued",
    // Webhooks carry email metadata only: the subject, never body text.
    preview: "Hello Ada",
    contact_id: null,
    email_id: id,
    tags: { flow: "welcome" },
  })
})

test("received email merges with sent channels, links its sender contact and adds webhook base fields", async () => {
  const f = await setup()
  const contactResult = await f.call("/contacts", "POST", {
    email: "inbound@example.test",
  })
  expect(contactResult.status).toBe(201)
  const contact = await contactResult.json()
  const inboundId = await f.t.run(async (ctx) =>
    ctx.db.insert("inboundMessages", {
      organizationId: f.owner.team,
      domainId: f.domain,
      region: "us-east-1",
      topicArn: "topic",
      messageId: "inbound-notification",
      sesMessageId: "inbound-provider-id",
      bucket: "inbound-bucket",
      objectKey: "inbound-object",
      storageId: await ctx.storage.store(new Blob(["Inbound body"])),
      notification: "{}",
    })
  )
  const id = await f.t.mutation(internal.received.complete, {
    id: inboundId,
    metadata: {
      from: "inbound@example.test",
      sender: "inbound@example.test",
      to: ["inbox@mail.example.test"],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "Inbound",
      messageId: "inbound-mail-id",
    },
    content: { text: "Inbound body", html: "", headers: {} },
    attachments: [],
  })
  const result = await (await f.call(`/messages/${id}`)).json()
  expect(result).toMatchObject({
    object: "message",
    channel: "email",
    direction: "inbound",
    status: "received",
    preview: "Inbound body",
    contact_id: contact.id,
  })
  await sent(f, bodies.whatsapp)
  const list = await (await f.call("/messages")).json()
  expect(list.data.map((m: { id: string }) => m.id)).toContain(id)
  const filtered = await (
    await f.call(`/messages?contact_id=${contact.id}`)
  ).json()
  expect(filtered.data.map((m: { id: string }) => m.id)).toEqual([id])
  const events = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.owner.team)
      )
      .take(100)
  )
  expect(
    events.find((event) => event.type === "email.received")?.data
  ).toMatchObject({
    id,
    email_id: id,
    object: "message",
    channel: "email",
    direction: "inbound",
    status: "received",
    preview: "Inbound",
    contact_id: contact.id,
  })
  expect(
    JSON.stringify(events.find((event) => event.type === "email.received"))
  ).not.toContain("Inbound body")
})

test("legacy channel endpoints share validation, missing-resource and scope error codes", async () => {
  const f = await setup()
  const restricted = await f.key(["contacts:read"])
  for (const channel of [
    "email",
    "whatsapp",
    "messenger",
    "instagram",
  ] as const) {
    const path = channel === "email" ? "/emails" : `/${channel}/messages`
    const body = channel === "email" ? f.email : bodies[channel]
    expect(
      await (await f.call(path, "POST", { ...body, to: 42 })).json()
    ).toMatchObject({
      name: "validation_error",
      statusCode: 422,
      message: expect.any(String),
    })
    expect(
      await (await f.call(`${path}/missing-message`)).json()
    ).toMatchObject({ name: "not_found", statusCode: 404 })
    expect(
      await (await f.call(path, "GET", undefined, restricted.token)).json()
    ).toMatchObject({ name: "restricted_api_key", statusCode: 403 })
  }
})
