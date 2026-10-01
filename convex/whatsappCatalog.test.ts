/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import {
  inboundFixture,
  envelope,
  signedWebhook,
  incoming,
  APP_SECRET,
  PHONE_ID,
  SENDER,
  fakeGraph,
} from "./testHelpers/meta.fixture"
import {
  whatsappSendExamples,
  whatsappInboundExamples,
} from "../lib/meta/whatsapp-fixtures"
import { whatsappPayload } from "../lib/meta/payloads"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "catalog-key-".repeat(8))
  vi.stubEnv("BETTER_AUTH_SECRET", "catalog-download-secret")
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
async function setup() {
  const f = await inboundFixture()
  await f.t.run((ctx) =>
    ctx.db.patch("channelAccounts", f.account, { registeredAt: Date.now() })
  )
  const { token } = await f.member.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Catalog", permission: "full_access", domainId: null },
  })
  const call = (path: string, body?: unknown) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  return { ...f, call }
}
function inbound(body: Record<string, unknown>, id: string, bsuid = false) {
  return envelope({
    metadata: { phone_number_id: PHONE_ID },
    contacts: [
      {
        ...(bsuid ? {} : { wa_id: SENDER }),
        user_id: "BSUID-123",
        parent_user_id: "parent",
        identity_key_hash: "identity-hash",
        profile: { name: "Ada Lovelace", username: "ada" },
      },
    ],
    messages: [
      {
        id,
        timestamp: String(Math.floor(Date.now() / 1000)),
        ...(bsuid ? {} : { from: SENDER }),
        from_user_id: "BSUID-123",
        from_parent_user_id: "parent",
        ...body,
      },
    ],
  })
}
async function read(f: Fixture, id: string) {
  return (await f.call(`/whatsapp/messages/${id}`)).json()
}

for (const [name, body] of Object.entries(whatsappSendExamples)) {
  test(`send ${name}: REST queues the exact Cloud API payload and rejects malformed content with 422`, async () => {
    const f = await setup()
    await project(f, incoming())
    const expected = whatsappPayload({ to: SENDER, ...body })
    const graph = fakeGraph([
      {
        path: `/${PHONE_ID}/messages`,
        respond: () => ({
          contacts: [{ input: SENDER, wa_id: SENDER, user_id: "BSUID-123" }],
          messages: [{ id: `wamid.${name}` }],
        }),
      },
    ])
    const response = await f.call("/whatsapp/messages", { to: SENDER, ...body })
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(
      200
    )
    const { id } = await response.json()
    await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
    expect(graph.calls[0].body).toEqual(expected)
    const detail = await read(f, id)
    expect(detail).toMatchObject({
      type: expected.type,
      content: expected[expected.type],
      raw: expected,
    })
    const malformed = { ...body, [Object.keys(body)[0]]: null }
    const bad = await f.call("/whatsapp/messages", { to: SENDER, ...malformed })
    expect(bad.status).toBe(422)
    expect(await bad.json()).toMatchObject({
      name: "validation_error",
      message: expect.any(String),
    })
    expect(graph.calls).toHaveLength(1)
  })
}
for (const [name, body] of Object.entries(whatsappInboundExamples)) {
  test(`receive ${name}: real-shaped webhook yields identical typed content in list/detail/customer event, including BSUID-only users`, async () => {
    const f = await setup()
    await project(f, inbound(body, `wamid.${name}`, true))
    const message = await f.t.run((ctx) =>
      ctx.db.query("channelMessages").first()
    )
    expect(message).toMatchObject({ from: "BSUID-123", type: body.type })
    const detail = await read(f, message!._id)
    expect(detail).toMatchObject({
      type: body.type,
      content: body[String(body.type)],
      identity: {
        user_id: "BSUID-123",
        parent_user_id: "parent",
        username: "ada",
        identity_key_hash: "identity-hash",
      },
      raw: { id: `wamid.${name}`, ...body },
    })
    if (!(body.system as { wa_id?: string } | undefined)?.wa_id)
      expect(detail.identity.wa_id).toBeUndefined()
    const page = await (await f.call("/whatsapp/messages")).json()
    const events = await f.t.run((ctx) => ctx.db.query("events").take(10))
    const event = events.find((e) => e.type === "whatsapp.message.received")!
    for (const result of [page.data[0], event.data]) {
      expect(result).toMatchObject({
        type: detail.type,
        content: detail.content,
        raw: detail.raw,
        identity: detail.identity,
        attachments: detail.attachments.map(
          (file: Record<string, unknown>) => ({
            ...file,
            download_url: expect.any(String),
            expires_at: expect.any(String),
          })
        ),
      })
    }
    if (body.context) expect(detail.context).toEqual(body.context)
    if (body.referral) expect(detail.referral).toEqual(body.referral)
    if (body.errors) expect(detail.errors).toEqual(body.errors)
    if (detail.attachments.length)
      expect(detail.attachments[0].download_url).toContain("/channels/media/")
    if (["flow_reply", "address_reply"].includes(name))
      expect(detail.content.response).toEqual(
        JSON.parse(
          (body.interactive as { nfm_reply: { response_json: string } })
            .nfm_reply.response_json
        )
      )
  })
}

test("phone and BSUID observations share the same identity and thread; sending recipient keeps to absent and played cannot regress", async () => {
  const f = await setup()
  await project(f, inbound(whatsappInboundExamples.text, "wamid.bsuid", true))
  const response = await f.call("/whatsapp/messages", {
    recipient: "BSUID-123",
    audio: { id: "voice", voice: true },
    biz_opaque_callback_data: "crm-1",
  })
  expect(response.status).toBe(200)
  const { id } = await response.json()
  const graph = fakeGraph([
    {
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: "wamid.sent" }] }),
    },
  ])
  await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
  expect(graph.calls[0].body).toMatchObject({
    recipient: "BSUID-123",
    audio: { voice: true },
    biz_opaque_callback_data: "crm-1",
  })
  expect((graph.calls[0].body as { to?: string }).to).toBeUndefined()
  for (const status of ["played", "read", "delivered", "sent"])
    await project(
      f,
      envelope({
        metadata: { phone_number_id: PHONE_ID },
        statuses: [
          {
            id: "wamid.sent",
            status,
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_user_id: "BSUID-123",
            biz_opaque_callback_data: "crm-1",
          },
        ],
      })
    )
  expect(await read(f, id)).toMatchObject({ status: "played" })
  const played = await f.t.run(async (ctx) =>
    (await ctx.db.query("events").take(100)).find(
      (e) => e.type === "whatsapp.message.played"
    )
  )
  expect(played?.data).toMatchObject({
    status: "played",
    biz_opaque_callback_data: "crm-1",
    status_raw: { recipient_user_id: "BSUID-123" },
  })
  await project(f, inbound(whatsappInboundExamples.text, "wamid.phone"))
  const rows = await f.t.run(async (ctx) => ({
    contacts: await ctx.db.query("contacts").take(10),
    identities: await ctx.db.query("channelContacts").take(10),
    threads: await ctx.db.query("conversations").take(10),
  }))
  expect(rows.identities).toHaveLength(1)
  expect(rows.threads).toHaveLength(1)
  expect(rows.identities[0]).toMatchObject({
    phone: `+${SENDER}`,
    userId: "BSUID-123",
  })
})

test("reactions attach to a same-account target, retain their own rows, remove correctly and tolerate out-of-order targets", async () => {
  const f = await setup()
  await project(
    f,
    inbound(whatsappInboundExamples.reaction, "wamid.reaction", true)
  )
  await project(f, inbound(whatsappInboundExamples.text, "wamid.target", true))
  const target = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessages")
      .withIndex("by_channel_and_externalId", (q) =>
        q.eq("channel", "whatsapp").eq("externalId", "wamid.target")
      )
      .unique()
  )
  expect((await read(f, target!._id)).reactions).toMatchObject([
    { emoji: "👍", external_id: "wamid.reaction" },
  ])
  const reaction = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessages")
      .withIndex("by_channel_and_externalId", (q) =>
        q.eq("channel", "whatsapp").eq("externalId", "wamid.reaction")
      )
      .unique()
  )
  expect(await read(f, reaction!._id)).toMatchObject({
    reaction_target_id: target!._id,
  })
  await project(
    f,
    inbound(whatsappInboundExamples.reaction_removal, "wamid.remove", true)
  )
  expect((await read(f, target!._id)).reactions).toEqual([])
  const bad = await f.call("/whatsapp/messages", {
    recipient: "BSUID-123",
    reaction: { message_id: "wamid.reaction", emoji: "👍" },
  })
  expect(bad.status).toBe(422)
})

const invalidExamples = [
  { text: { body: "x".repeat(4097) } },
  { image: { id: "id", caption: "x".repeat(1025) } },
  { audio: { id: "id", caption: "bad" } },
  { sticker: { id: "id", link: "https://example.com" } },
  { location: { latitude: 91, longitude: 0 } },
  {
    contacts: Array.from({ length: 258 }, () => ({
      name: { formatted_name: "Ada" },
    })),
  },
  { reaction: { message_id: "wamid.target", emoji: "👍👍" } },
  {
    interactive: {
      type: "button",
      body: { text: "Pick" },
      action: {
        buttons: [0, 1].map((i) => ({
          type: "reply",
          reply: { id: String(i), title: "Same" },
        })),
      },
    },
  },
  {
    interactive: {
      type: "list",
      body: { text: "Pick" },
      action: {
        button: "Options",
        sections: [0, 1].map((i) => ({
          title: "Section",
          rows: Array.from({ length: 6 }, (_, j) => ({
            id: `${i}-${j}`,
            title: "Row",
          })),
        })),
      },
    },
  },
  {
    interactive: {
      type: "flow",
      body: { text: "Pick" },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: "token",
          flow_cta: "Open",
          flow_id: "1",
          flow_name: "both",
        },
      },
    },
  },
  {
    interactive: {
      type: "address_message",
      body: { text: "Address" },
      action: { name: "address_message", parameters: { country: "US" } },
    },
  },
  {
    template: {
      name: "offer",
      language: "en",
      components: [
        {
          type: "button",
          sub_type: "copy_code",
          index: "0",
          parameters: [{ type: "coupon_code", coupon_code: "x".repeat(21) }],
        },
      ],
    },
  },
  { type: "poll", poll: { body: "Not a Cloud API type" } },
]
test.each(invalidExamples)(
  "catalog boundary returns an actionable 422 before writes: %j",
  async (body) => {
    const f = await setup()
    await project(f, incoming())
    const result = await f.call("/whatsapp/messages", { to: SENDER, ...body })
    expect(result.status).toBe(422)
    expect(await result.json()).toMatchObject({
      name: "validation_error",
      message: expect.stringMatching(/.{8}/),
    })
    expect(
      await f.t.run((ctx) => ctx.db.query("channelMessages").take(10))
    ).toHaveLength(1)
  }
)

test("authentication templates reject BSUIDs locally, while phone routing takes precedence", async () => {
  const f = await setup()
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    organizationId: f.owner.team,
    wabaId: "102290129340398",
    syncedAt: Date.now(),
    templates: [
      {
        id: "12345",
        name: "auth_code",
        language: "en_US",
        category: "AUTHENTICATION",
        status: "APPROVED",
        parameterFormat: "positional",
        components: [{ type: "BODY", text: "Your code is {{1}}" }],
      },
    ],
  })
  const template = {
    name: "auth_code",
    language: "en_US",
    variables: { "1": "123456" },
  }
  const blocked = await f.call("/whatsapp/messages", {
    recipient: "BSUID-123",
    template,
  })
  expect(blocked.status).toBe(422)
  expect(await blocked.json()).toMatchObject({
    message: expect.stringContaining("Authentication templates"),
  })
  const manual = await f.call("/whatsapp/messages", {
    recipient: "BSUID-123",
    template: {
      name: "auth_code",
      language: "en_US",
      components: [
        { type: "body", parameters: [{ type: "text", text: "123456" }] },
      ],
    },
  })
  expect(manual.status).toBe(422)
  const allowed = await f.call("/whatsapp/messages", {
    to: SENDER,
    recipient: "BSUID-123",
    template,
  })
  expect(allowed.status).toBe(200)
})

test("payment statuses remain separate from delivery and preserve their complete Meta payload", async () => {
  const f = await setup()
  await project(f, incoming())
  const response = await f.call("/whatsapp/messages", {
    to: SENDER,
    ...whatsappSendExamples.interactive_order_details,
  })
  const { id } = await response.json()
  fakeGraph([
    {
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: "wamid.payment" }] }),
    },
  ])
  await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
  const payment = {
    id: "wamid.payment",
    type: "payment",
    status: "captured",
    timestamp: String(Math.floor(Date.now() / 1000)),
    recipient_user_id: "BSUID-123",
    payment: {
      reference_id: "order-1",
      amount: { value: 10000, offset: 100 },
      currency: "INR",
    },
  }
  await project(
    f,
    envelope({ metadata: { phone_number_id: PHONE_ID }, statuses: [payment] })
  )
  expect(await read(f, id)).toMatchObject({
    status: "sent",
    payment,
    events: expect.arrayContaining([
      expect.objectContaining({ type: "payment_updated", details: payment }),
    ]),
  })
  const event = await f.t.run(async (ctx) =>
    (await ctx.db.query("events").take(100)).find(
      (e) => e.type === "whatsapp.message.payment_updated"
    )
  )
  expect(event?.data).toMatchObject({
    payment,
    status_raw: payment,
    type: "interactive",
  })
})

test("Meta send response keeps pacing and user_id even without wa_id", async () => {
  const f = await setup()
  const response = await f.call("/whatsapp/messages", {
    to: SENDER,
    template: { name: "hello", language: "en_US" },
  })
  const { id } = await response.json()
  const wire = {
    contacts: [{ input: SENDER, user_id: "BSUID-123" }],
    messages: [
      { id: "wamid.paced", message_status: "held_for_quality_assessment" },
    ],
  }
  fakeGraph([{ path: `/${PHONE_ID}/messages`, respond: () => wire }])
  await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
  expect(await read(f, id)).toMatchObject({
    send_response: wire,
    identity: { user_id: "BSUID-123" },
  })
  await project(
    f,
    inbound(whatsappInboundExamples.text, "wamid.username", true)
  )
  expect(
    await f.t.run((ctx) => ctx.db.query("channelContacts").take(10))
  ).toHaveLength(1)
})

test("reaction age uses Meta's timestamp and revoked targets are refused", async () => {
  const f = await setup()
  const old = inbound(whatsappInboundExamples.text, "wamid.old")
  old.entry[0].changes[0].value = {
    metadata: { phone_number_id: PHONE_ID },
    messages: [
      {
        from: SENDER,
        id: "wamid.old",
        type: "text",
        text: { body: "Old" },
        timestamp: String(Math.floor((Date.now() - 31 * 86400_000) / 1000)),
      },
    ],
  }
  await project(f, old)
  await project(f, incoming("wamid.target"))
  expect(
    (
      await f.call("/whatsapp/messages", {
        to: SENDER,
        reaction: { message_id: "wamid.old", emoji: "👍" },
      })
    ).status
  ).toBe(422)
  await project(f, inbound(whatsappInboundExamples.revoke, "wamid.revoke"))
  expect(
    (
      await f.call("/whatsapp/messages", {
        to: SENDER,
        reaction: { message_id: "wamid.target", emoji: "👍" },
      })
    ).status
  ).toBe(422)
})

test("BSUID aliases remain business-scoped while the same phone shares a CRM contact", async () => {
  const f = await setup()
  await project(
    f,
    inbound(whatsappInboundExamples.text, "wamid.first-business")
  )
  const second = await f.t.run(async (ctx) => {
    const firstAccount = (await ctx.db.get("channelAccounts", f.account))!
    const connection = (await ctx.db.get(
      "metaConnections",
      firstAccount.connectionId
    ))!
    const { _id, _creationTime, ...fields } = connection
    void _id
    void _creationTime
    const connectionId = await ctx.db.insert("metaConnections", {
      ...fields,
      businessId: "second-business",
    })
    await ctx.db.insert("whatsappBusinessAccounts", {
      organizationId: f.owner.team,
      wabaId: "second-waba",
      connectionId,
    })
    const {
      _id: accountId,
      _creationTime: created,
      ...accountFields
    } = firstAccount
    void accountId
    void created
    return ctx.db.insert("channelAccounts", {
      ...accountFields,
      connectionId,
      externalId: "second-phone",
      wabaId: "second-waba",
    })
  })
  const message = {
    id: "wamid.second-business",
    timestamp: String(Math.floor(Date.now() / 1000)),
    from: SENDER,
    from_user_id: "BSUID-second",
    type: "text",
    text: { body: "Hi" },
  }
  await project(
    f,
    envelope(
      { metadata: { phone_number_id: "second-phone" }, messages: [message] },
      "messages",
      "second-waba"
    )
  )
  const identities = await f.t.run((ctx) =>
    ctx.db.query("channelContacts").take(10)
  )
  expect(identities).toHaveLength(1)
  const aliases = await f.t.run((ctx) =>
    ctx.db.query("whatsappUserAliases").take(10)
  )
  expect(aliases).toHaveLength(2)
  for (const [from, recipient] of [
    [f.account, "BSUID-123"],
    [second, "BSUID-second"],
  ]) {
    const response = await f.call("/whatsapp/messages", {
      from,
      recipient,
      text: "Reply",
    })
    expect(response.status).toBe(200)
    const { id } = await response.json()
    expect((await read(f, id)).identity.user_id).toBe(recipient)
  }
})

test("system user-id changes preserve the CRM identity for future phone-less messages", async () => {
  const f = await setup()
  await project(f, inbound(whatsappInboundExamples.text, "wamid.initial", true))
  await project(
    f,
    inbound(whatsappInboundExamples.system_user_id, "wamid.system", true)
  )
  await project(
    f,
    envelope({
      metadata: { phone_number_id: PHONE_ID },
      messages: [
        {
          id: "wamid.new-user-id",
          from_user_id: "BSUID-new",
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text",
          text: { body: "Hello again" },
        },
      ],
    })
  )
  expect(
    await f.t.run((ctx) => ctx.db.query("channelContacts").take(10))
  ).toHaveLength(1)
  expect(
    await f.t.run((ctx) => ctx.db.query("conversations").take(10))
  ).toHaveLength(1)
})

test("nested interactive media gets a signed download and public links never receive the Meta token", async () => {
  const f = await setup()
  await project(f, incoming())
  const body = {
    ...whatsappSendExamples.interactive_button,
    interactive: {
      ...(whatsappSendExamples.interactive_button.interactive as object),
      header: {
        type: "image",
        image: { link: "https://public.example.test/header.png" },
      },
    },
  }
  const response = await f.call("/whatsapp/messages", { to: SENDER, ...body })
  const { id } = await response.json()
  const bytes = new Uint8Array([1, 2, 3, 4])
  const graph = fakeGraph([
    {
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: "wamid.header" }] }),
    },
    {
      path: "/header.png",
      respond: () =>
        new Response(bytes, { headers: { "content-type": "image/png" } }),
    },
  ])
  await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
  await f.t.action(internal.channels.media.fetch, {
    messageId: id,
    mediaId: "link:0",
  })
  expect(graph.to("/header.png")[0].authorization).toBeUndefined()
  const detail = await read(f, id)
  expect(detail.attachments).toMatchObject([
    {
      id: "link:0",
      content_type: "image/png",
      size: 4,
      download_url: expect.any(String),
    },
  ])
  const download = await f.t.fetch(
    new URL(detail.attachments[0].download_url).pathname
  )
  expect(download.status).toBe(200)
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes)
})

test("inbound documents above the former 25 MB cap download within the catalog's 100 MB limit", async () => {
  const f = await setup()
  await project(
    f,
    inbound(whatsappInboundExamples.document, "wamid.document", true)
  )
  const message = await f.t.run((ctx) =>
    ctx.db.query("channelMessages").first()
  )
  const size = 26 * 1024 * 1024
  const graph = fakeGraph([
    {
      path: "/media.doc",
      respond: () => ({
        url: "https://cdn.example.test/document.pdf",
        file_size: size,
        mime_type: "application/pdf",
      }),
    },
    {
      path: "/document.pdf",
      respond: () => new Response(new Uint8Array(size)),
    },
  ])
  await f.t.action(internal.channels.media.fetch, {
    messageId: message!._id,
    mediaId: "media.doc",
  })
  expect(graph.to("/document.pdf")[0].authorization).toBe(
    "Bearer connection-test-token"
  )
  const detail = await read(f, message!._id)
  expect(detail.attachments[0]).toMatchObject({
    size,
    error: null,
    download_url: expect.any(String),
  })
})

test("owned upload references reject incompatible MIME and voice-note formats with 422", async () => {
  const f = await setup()
  await project(f, incoming())
  await f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(["audio"], { type: "audio/mpeg" })
    )
    await ctx.db.insert("channelMediaUploads", {
      organizationId: f.owner.team,
      accountId: f.account,
      mediaId: "uploaded-audio",
      storageId,
      contentType: "audio/mpeg",
      filename: "audio.mp3",
      size: 5,
      expiresAt: Date.now() + 86400_000,
    })
  })
  for (const body of [
    { image: { id: "uploaded-audio" } },
    { audio: { id: "uploaded-audio", voice: true } },
  ])
    expect(
      (await f.call("/whatsapp/messages", { to: SENDER, ...body })).status
    ).toBe(422)
})

test("system notices do not open a customer service window", async () => {
  const f = await setup()
  await project(
    f,
    inbound(whatsappInboundExamples.system_user_id, "wamid.system-only", true)
  )
  const result = await f.call("/whatsapp/messages", {
    recipient: "BSUID-new",
    text: "Requires a template",
  })
  expect(result.status).toBe(422)
  expect(await result.json()).toMatchObject({
    message: expect.stringContaining("window"),
  })
})

test("a wa_id learned from a BSUID send response links future phone observations", async () => {
  const f = await setup()
  const response = await f.call("/whatsapp/messages", {
    recipient: "BSUID-123",
    template: { name: "hello", language: "en_US" },
  })
  const { id } = await response.json()
  fakeGraph([
    {
      path: `/${PHONE_ID}/messages`,
      respond: () => ({
        contacts: [{ input: "BSUID-123", user_id: "BSUID-123", wa_id: SENDER }],
        messages: [{ id: "wamid.link-phone" }],
      }),
    },
  ])
  await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
  expect((await read(f, id)).identity).toMatchObject({
    user_id: "BSUID-123",
    wa_id: SENDER,
  })
  await project(f, incoming("wamid.phone-after-bsuid"))
  expect(
    await f.t.run((ctx) => ctx.db.query("channelContacts").take(10))
  ).toHaveLength(1)
  expect(
    await f.t.run((ctx) => ctx.db.query("conversations").take(10))
  ).toHaveLength(1)
})

test("approved template footers and static buttons need no invented send parameters and expose the stored snapshot", async () => {
  const f = await setup()
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    organizationId: f.owner.team,
    wabaId: "102290129340398",
    syncedAt: Date.now(),
    templates: [
      {
        id: "footer-template",
        name: "with_footer",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        parameterFormat: "positional",
        components: [
          { type: "BODY", text: "Welcome {{1}}" },
          { type: "FOOTER", text: "Contact us for help" },
          {
            type: "BUTTONS",
            buttons: [
              {
                type: "PHONE_NUMBER",
                text: "Call us",
                phone_number: "+16505551234",
              },
            ],
          },
        ],
      },
    ],
  })
  const response = await f.call("/whatsapp/messages", {
    to: SENDER,
    template: {
      name: "with_footer",
      language: "en_US",
      variables: { "1": "Ada" },
    },
  })
  expect(response.status).toBe(200)
  const { id } = await response.json()
  const detail = await read(f, id)
  expect(detail.rendered).toMatchObject({
    body: "Welcome Ada",
    footer: "Contact us for help",
    buttons: [{ type: "PHONE_NUMBER", text: "Call us" }],
  })
  expect(detail.raw.template.components).toEqual([
    { type: "body", parameters: [{ type: "text", text: "Ada" }] },
  ])
})

test("legacy unsupported rows normalize using the retained Meta type, and legacy reactions resolve their target from raw content", async () => {
  const f = await setup()
  await project(f, inbound(whatsappInboundExamples.order, "wamid.legacy-order"))
  const order = await f.t.run((ctx) => ctx.db.query("channelMessages").first())
  await f.t.run((ctx) =>
    ctx.db.patch("channelMessages", order!._id, { type: "unsupported" })
  )
  expect(await read(f, order!._id)).toMatchObject({
    type: "order",
    content: whatsappInboundExamples.order.order,
    raw: whatsappInboundExamples.order,
  })
  await project(f, inbound(whatsappInboundExamples.text, "wamid.target"))
  await project(
    f,
    inbound(whatsappInboundExamples.reaction, "wamid.legacy-reaction")
  )
  const reaction = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessages")
      .withIndex("by_channel_and_externalId", (q) =>
        q.eq("channel", "whatsapp").eq("externalId", "wamid.legacy-reaction")
      )
      .unique()
  )
  await f.t.run((ctx) =>
    ctx.db.patch("channelMessages", reaction!._id, {
      reactionTargetExternalId: undefined,
    })
  )
  const target = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessages")
      .withIndex("by_channel_and_externalId", (q) =>
        q.eq("channel", "whatsapp").eq("externalId", "wamid.target")
      )
      .unique()
  )
  expect(await read(f, reaction!._id)).toMatchObject({
    reaction_target_id: target!._id,
  })
})
