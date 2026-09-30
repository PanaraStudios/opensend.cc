import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { patchRow } from "./counts"
import { EXPORT_SOURCES } from "./exportSources"

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  })
  vi.stubEnv("BETTER_AUTH_SECRET", "receiving-test-secret-at-least-32-bytes")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const page = { cursor: null, numItems: 10 }
const plain = [
  "From: Ada <ada@example.com>",
  "To: inbox@mail.example.test",
  "Cc: cc@example.com",
  "Bcc: bcc@example.com",
  "Reply-To: replies@example.com",
  "Subject: Hello inbound",
  "Message-ID: <inbound@example.com>",
  "Date: Fri, 25 Sep 2026 10:00:00 +0000",
  "Received: from relay.example.com by mail.example.test for <forwarded@example.com>; Fri, 25 Sep 2026 10:00:00 +0000",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hello Ada",
].join("\r\n")
const multipart =
  plain.slice(0, plain.indexOf("Content-Type:")) +
  [
    'Content-Type: multipart/mixed; boundary="mix"',
    "",
    "--mix",
    'Content-Type: multipart/alternative; boundary="alt"',
    "",
    "--alt",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Plain body",
    "--alt",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<p>HTML body<img src="cid:logo" /></p>',
    "--alt--",
    "--mix",
    'Content-Type: image/png; name="logo.png"',
    'Content-Disposition: inline; filename="logo.png"',
    "Content-ID: <logo>",
    "Content-Transfer-Encoding: base64",
    "",
    "aW1hZ2U=",
    "--mix",
    'Content-Type: text/plain; name="notes.txt"',
    'Content-Disposition: attachment; filename="notes.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    "aGVsbG8=",
    "--mix--",
    "",
  ].join("\r\n")
async function setup() {
  const f = await fixture()
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
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Receiving", permission: "full_access", domainId: null },
  })
  await f.t.run((ctx) =>
    patchRow(ctx, "domains", f.domain, { receiving: true })
  )
  return { ...f, member, token }
}
type Setup = Awaited<ReturnType<typeof setup>>
async function store(f: Setup, mime = plain) {
  return f.t.run(async (ctx) => {
    const rawId = await ctx.storage.store(
      new Blob([mime], { type: "message/rfc822" })
    )
    const id = await ctx.db.insert("inboundMessages", {
      organizationId: f.owner.team,
      domainId: f.domain,
      region: "us-east-1",
      topicArn: "topic",
      messageId: crypto.randomUUID(),
      sesMessageId: crypto.randomUUID(),
      bucket: "inbound-bucket",
      objectKey: crypto.randomUUID(),
      storageId: rawId,
      notification: JSON.stringify({
        mail: {
          source: "ada@example.com",
          commonHeaders: { subject: "Fallback" },
        },
        receipt: {
          recipients: ["inbox@mail.example.test"],
          spfVerdict: { status: "PASS" },
          dkimVerdict: { status: "FAIL" },
          dmarcVerdict: { status: "GRAY" },
        },
      }),
    })
    return { id, rawId }
  })
}
async function parse(f: Setup, mime = plain) {
  const inbound = await store(f, mime)
  await f.t.action(internal.receivedParse.parse, { id: inbound.id })
  const email = await f.t.run(
    async (ctx) =>
      (await ctx.db
        .query("receivedEmails")
        .withIndex("by_inboundId", (q) => q.eq("inboundId", inbound.id))
        .unique())!
  )
  return { ...inbound, email }
}
const request = (f: Setup, path: string, token = f.token) =>
  f.t.fetch(path, { headers: { Authorization: `Bearer ${token}` } })

test("plain MIME parses addresses, headers, date and body; lists omit bodies", async () => {
  const f = await setup()
  const { email } = await parse(f)
  const detail = await f.member.client.query(api.received.get, {
    id: email._id,
  })
  expect(detail?.email).toMatchObject({
    from: "Ada <ada@example.com>",
    sender: "ada@example.com",
    to: ["inbox@mail.example.test"],
    cc: ["cc@example.com"],
    bcc: ["bcc@example.com"],
    replyTo: ["replies@example.com"],
    messageId: "<inbound@example.com>",
  })
  expect(detail?.email.date).toBe(Date.parse("2026-09-25T10:00:00Z"))
  expect(detail?.content?.text).toBe("Hello Ada")
  const list = await f.member.client.query(api.received.list, {
    organizationId: f.owner.team,
    paginationOpts: page,
  })
  expect(list.page).toHaveLength(1)
  expect(list.page[0]).not.toHaveProperty("html")
  expect(
    await f.member.client.query(api.received.count, {
      organizationId: f.owner.team,
    })
  ).toEqual({ total: 1 })
})
test("multipart alternatives and inline/file attachments preserve their bytes", async () => {
  const f = await setup()
  const { email } = await parse(f, multipart)
  const detail = await f.owner.client.query(api.received.get, { id: email._id })
  expect(detail?.content).toMatchObject({
    text: "Plain body",
    html: '<p>HTML body<img src="cid:logo" /></p>',
  })
  const files = await f.t.run((ctx) =>
    ctx.db.query("receivedAttachments").collect()
  )
  expect(files).toHaveLength(2)
  expect(files[0]).toMatchObject({
    filename: "logo.png",
    contentType: "image/png",
    contentId: "logo",
    contentDisposition: "inline",
    size: 5,
  })
  expect(
    await f.t.run(async (ctx) =>
      (await ctx.storage.get(files[0].storageId))?.text()
    )
  ).toBe("image")
})
test("decodes non-UTF-8 charsets", async () => {
  const f = await setup()
  const { email } = await parse(
    f,
    plain
      .replace(
        "charset=utf-8",
        "charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable"
      )
      .replace("Hello Ada", "caf=E9")
  )
  expect(
    (await f.owner.client.query(api.received.get, { id: email._id }))?.content
      ?.text
  ).toBe("café")
})
test("malformed MIME is visible and retains raw storage", async () => {
  const f = await setup()
  const { email, rawId } = await parse(f, "not a MIME message")
  expect(email.parseError).toBeTruthy()
  expect(email.subject).toBe("Fallback")
  expect(
    await f.t.run(async (ctx) => (await ctx.storage.get(rawId))?.size)
  ).toBeGreaterThan(0)
  expect(
    (
      await f.owner.client.query(api.received.list, {
        organizationId: f.owner.team,
        paginationOpts: page,
      })
    ).page
  ).toHaveLength(1)
})
test("oversized parsed content is retained as a failed parse", async () => {
  const f = await setup()
  const { email } = await parse(
    f,
    plain.replace("Hello Ada", "x".repeat(601 * 1024))
  )
  expect(email.parseError).toContain("limits")
})
test("re-running a parser emits one received row and webhook", async () => {
  const f = await setup()
  const { id } = await parse(f, multipart)
  await f.t.action(internal.receivedParse.parse, { id })
  expect(
    await f.t.run((ctx) => ctx.db.query("receivedEmails").collect())
  ).toHaveLength(1)
  expect(
    await f.t.run((ctx) => ctx.db.query("receivedAttachments").collect())
  ).toHaveLength(2)
  const events = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    type: "email.received",
    data: {
      from: "Ada <ada@example.com>",
      received_for: ["forwarded@example.com"],
      message_id: "<inbound@example.com>",
    },
  })
  expect(events[0].data).not.toHaveProperty("html")
  expect(events[0].data).not.toHaveProperty("headers")
  expect(events[0].data.attachments[0]).toEqual({
    id: expect.any(String),
    filename: "logo.png",
    content_type: "image/png",
    content_id: "logo",
    content_disposition: "inline",
  })
})
test("team isolation, plain-member access, and receiving-domain scope", async () => {
  const f = await setup()
  const { email } = await parse(f)
  await expect(
    f.outsider.client.query(api.received.get, { id: email._id })
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.received.list, {
      organizationId: f.owner.team,
      paginationOpts: page,
    })
  ).rejects.toThrow("permission")
  expect(
    await f.member.client.query(api.received.receivingDomain, {
      organizationId: f.owner.team,
    })
  ).toEqual({ name: "mail.example.test" })
  expect(
    await f.outsider.client.query(api.received.receivingDomain, {
      organizationId: f.outsider.team,
    })
  ).toBeNull()
  // Received mail is read-only; members can start its existing export operation.
  expect(
    await f.member.client.mutation(api.exports.start, {
      organizationId: f.owner.team,
      resource: "received",
      filters: {},
      summary: [],
    })
  ).toBeTruthy()
})
test("substring search, date bounds, exact sender and export filters", async () => {
  const f = await setup()
  const { email } = await parse(f)
  await parse(
    f,
    plain
      .replace("Ada <ada@example.com>", "Other <not-ada@example.com>")
      .replace("Hello inbound", "Different")
  )
  const query = (filters: {
    search?: string
    address?: string
    from?: number
    to?: number
  }) =>
    f.owner.client.query(api.received.list, {
      organizationId: f.owner.team,
      paginationOpts: page,
      ...filters,
    })
  expect(
    (await query({ search: "LO INB" })).page.map((row) => row._id)
  ).toEqual([email._id])
  expect(
    (await query({ address: "ADA@example.com" })).page.map((row) => row._id)
  ).toEqual([email._id])
  expect((await query({ from: Date.now() + 1 })).page).toEqual([])
  const csv = await f.t.run((ctx) =>
    EXPORT_SOURCES.received.page(
      ctx,
      f.owner.team,
      { search: "Hello inbound" },
      page,
      []
    )
  )
  expect(csv.rows).toHaveLength(1)
  expect(csv.rows[0][0]).toBe(email._id)
  expect(EXPORT_SOURCES.received.columns).toContain("message_id")
})
test("REST received list/get and paginated attachment shapes", async () => {
  const f = await setup()
  const { email } = await parse(f, multipart)
  const listed = await (await request(f, "/emails/receiving")).json()
  expect(listed).toMatchObject({
    object: "list",
    has_more: false,
    data: [{ id: email._id, attachments: [{ size: 5 }, { size: 5 }] }],
  })
  const result = await (
    await request(f, `/emails/receiving/${email._id}?html_format=cid`)
  ).json()
  expect(result).toMatchObject({
    object: "email",
    html_format: "cid",
    html: '<p>HTML body<img src="cid:logo" /></p>',
    authentication: { spf: "pass", dkim: "fail", dmarc: "gray" },
    raw: { download_url: expect.any(String), expires_at: expect.any(String) },
  })
  const path = `/emails/receiving/${email._id}/attachments`
  const first = await (await request(f, path + "?limit=1")).json()
  expect(first).toMatchObject({
    object: "list",
    has_more: true,
    data: [
      { download_url: expect.any(String), expires_at: expect.any(String) },
    ],
  })
  const second = await (
    await request(f, path + `?limit=1&after=${first.data[0].id}`)
  ).json()
  expect(second.data).toHaveLength(1)
  expect(second.data[0].id).not.toBe(first.data[0].id)
  const attachment = await (
    await request(f, `${path}/${first.data[0].id}`)
  ).json()
  expect(attachment.object).toBe("attachment")
})
test("REST errors reject restricted keys, wrong teams, bad ids and pagination", async () => {
  const f = await setup()
  const { email } = await parse(f)
  const other = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Other", permission: "full_access", domainId: null },
  })
  expect(
    (await request(f, `/emails/receiving/${email._id}`, other.token)).status
  ).toBe(404)
  expect((await request(f, "/emails/receiving/missing")).status).toBe(404)
  expect((await request(f, "/emails/receiving?limit=101")).status).toBe(422)
  expect((await request(f, "/emails/receiving?after=missing")).status).toBe(422)
  const sending = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Send", permission: "sending_access", domainId: null },
  })
  expect((await request(f, "/emails/receiving", sending.token)).status).toBe(
    401
  )
})
test("download URLs expire, reject tampering, and never expose permanent storage URLs", async () => {
  const f = await setup()
  const { email } = await parse(f, multipart)
  const result = await (
    await request(f, `/emails/receiving/${email._id}/attachments`)
  ).json()
  const url = new URL(result.data[0].download_url)
  const response = await f.t.fetch(url.pathname)
  expect(response.status).toBe(200)
  expect(response.headers.get("location")).toBeNull()
  expect(await response.text()).toBe("hello")
  expect((await f.t.fetch(url.pathname + "bad")).status).toBe(404)
  vi.setSystemTime(Date.now() + 3601000)
  expect((await f.t.fetch(url.pathname)).status).toBe(404)
})
test("retention deletes MIME, contents and attachments and keeps SNS tombstones", async () => {
  const f = await setup()
  const { email, rawId, id } = await parse(f, multipart)
  const attachments = await f.t.run((ctx) =>
    ctx.db.query("receivedAttachments").collect()
  )
  await f.t.run((ctx) =>
    patchRow(ctx, "receivedEmails", email._id, { expiresAt: Date.now() - 1 })
  )
  await f.t.mutation(internal.received.prune, {})
  for (const storageId of [rawId, ...attachments.map((row) => row.storageId)])
    expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull()
  expect(
    await f.t.run((ctx) => ctx.db.query("receivedContents").collect())
  ).toEqual([])
  expect(
    await f.t.run((ctx) => ctx.db.query("receivedAttachments").collect())
  ).toEqual([])
  expect(
    await f.owner.client.query(api.received.count, {
      organizationId: f.owner.team,
    })
  ).toEqual({ total: 0 })
  await f.t.action(internal.receivedParse.parse, { id })
  expect(
    await f.t.run((ctx) => ctx.db.query("receivedEmails").collect())
  ).toEqual([])
})
test("duplicate SNS notifications never create another inbound record", async () => {
  const f = await setup()
  await f.t.run((ctx) =>
    ctx.db.insert("inboundRegions", {
      region: "us-east-1",
      operation: "provision",
      phase: "ready",
      generation: 1,
      callbackConfirmed: true,
      bucket: "bucket",
      topicArn: "sns-topic",
    })
  )
  const message = JSON.stringify({
    notificationType: "Received",
    mail: { messageId: "ses-id" },
    receipt: {
      recipients: ["inbox@mail.example.test"],
      action: {
        type: "S3",
        bucketName: "bucket",
        objectKey: `${f.domain}/ses-id`,
      },
    },
  })
  expect(
    await f.t.mutation(internal.ses.inboundMessages.ingest, {
      topicArn: "sns-topic",
      messageId: "sns-id",
      message,
    })
  ).toBe(true)
  expect(
    await f.t.mutation(internal.ses.inboundMessages.ingest, {
      topicArn: "sns-topic",
      messageId: "sns-id",
      message,
    })
  ).toBe(false)
  expect(
    await f.t.mutation(internal.ses.inboundMessages.ingest, {
      topicArn: "sns-topic",
      messageId: "new-sns-id",
      message,
    })
  ).toBe(false)
  expect(
    await f.t.run((ctx) => ctx.db.query("inboundMessages").collect())
  ).toHaveLength(1)
})

test("REST inlines images by default and validates html_format", async () => {
  const f = await setup()
  const { email } = await parse(f, multipart)
  const result = await (
    await request(f, `/emails/receiving/${email._id}`)
  ).json()
  expect(result.html_format).toBe("data_uri")
  expect(result.html).toContain('src="data:image/png;base64,aW1hZ2U="')
  expect(
    (await request(f, `/emails/receiving/${email._id}?html_format=invalid`))
      .status
  ).toBe(422)
})
test("storage handoff schedules parsing and redundant handoffs discard their extra file", async () => {
  const f = await setup()
  const { id, rawId } = await store(f)
  await f.t.run((ctx) =>
    ctx.db.patch("inboundMessages", id, { storageId: undefined })
  )
  await f.t.mutation(internal.ses.inboundMessages.stored, {
    id,
    storageId: rawId,
    size: plain.length,
  })
  const redundant = await f.t.run((ctx) => ctx.storage.store(new Blob([plain])))
  await f.t.mutation(internal.ses.inboundMessages.stored, {
    id,
    storageId: redundant,
    size: plain.length,
  })
  expect(await f.t.run((ctx) => ctx.storage.get(redundant))).toBeNull()
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  expect(
    await f.t.run((ctx) => ctx.db.query("receivedEmails").collect())
  ).toHaveLength(1)
  expect(await f.t.run((ctx) => ctx.db.query("events").collect())).toHaveLength(
    1
  )
})
test("attachments cannot be retrieved through another email", async () => {
  const f = await setup()
  const first = await parse(f, multipart)
  const second = await parse(f)
  const files = await f.t.run((ctx) =>
    ctx.db
      .query("receivedAttachments")
      .withIndex("by_emailId", (q) => q.eq("emailId", first.email._id))
      .collect()
  )
  expect(
    (
      await request(
        f,
        `/emails/receiving/${second.email._id}/attachments/${files[0]._id}`
      )
    ).status
  ).toBe(404)
  expect(
    (
      await request(
        f,
        `/emails/receiving/${second.email._id}/attachments?after=${files[0]._id}`
      )
    ).status
  ).toBe(422)
})
test("SES feedback copies remain real received email", async () => {
  const f = await setup()
  const { email } = await parse(
    f,
    plain
      .replace(
        "Ada <ada@example.com>",
        "MAILER-DAEMON <complaints@example.com>"
      )
      .replace("Hello inbound", "FW: Delivery Status Notification")
  )
  expect(email.subject).toBe("FW: Delivery Status Notification")
  expect(email.parseError).toBeUndefined()
})

test("a late transfer cannot recreate files after retention", async () => {
  const f = await setup()
  const { email, id } = await parse(f)
  await f.t.run((ctx) =>
    patchRow(ctx, "receivedEmails", email._id, { expiresAt: Date.now() - 1 })
  )
  await f.t.mutation(internal.received.prune, {})
  const lateFile = await f.t.run((ctx) => ctx.storage.store(new Blob([plain])))
  await f.t.mutation(internal.ses.inboundMessages.stored, {
    id,
    storageId: lateFile,
    size: plain.length,
  })
  expect(await f.t.run((ctx) => ctx.storage.get(lateFile))).toBeNull()
  expect(
    (await f.t.run((ctx) => ctx.db.get("inboundMessages", id)))?.storageId
  ).toBeUndefined()
})
