import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { api, components, internal } from "./_generated/api"
import type { PaginationResult } from "convex/server"
import type { Doc, Id } from "./_generated/dataModel"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { insertEmailEvent, patchEmail } from "./emailRows"
import { patchRow } from "./counts"
import { EXPORT_SOURCES } from "./exportSources"

beforeEach(() => {
  /* Scheduled functions and pool runs stay put; tests drive the sender. */
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** A team ready to send from mail.example.test, a plain member, and a
    full-access API key. */
async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await storeTestCredentials(f)
  await f.t.run(async (ctx) => {
    await ctx.db.patch("domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-team-cfg",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 10 },
    })
  })
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
  const key = (patch: Record<string, unknown> = {}) =>
    f.owner.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: {
        name: "Production",
        permission: "full_access" as const,
        domainId: null,
        ...patch,
      },
    })
  const { token } = await key()
  return { ...f, member, token, key }
}
type Setup = Awaited<ReturnType<typeof setup>>

type Sent = { command: string; input: Record<string, unknown> }
/** The SES boundary: records every call and answers with `answer`. */
function ses(answer: (sent: Sent) => unknown = () => ({ MessageId: "m-1" })) {
  const sent: Sent[] = []
  vi.spyOn(SESv2Client.prototype, "send").mockImplementation(
    async (command) => {
      const call = {
        command: command.constructor.name,
        input: command.input as Record<string, unknown>,
      }
      sent.push(call)
      return answer(call) as never
    }
  )
  return sent
}
const awsFailure = (name: string, status: number) =>
  Object.assign(new Error("provider detail"), {
    name,
    $metadata: { httpStatusCode: status },
  })

const request = (
  f: Setup,
  path: string,
  init: RequestInit & { token?: string } = {}
) =>
  f.t.fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${init.token ?? f.token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
const post = (
  f: Setup,
  body: unknown,
  init: RequestInit & { token?: string } = {},
  path = "/emails"
) => request(f, path, { method: "POST", body: JSON.stringify(body), ...init })
const EMAIL = {
  from: "Acme <hi@mail.example.test>",
  to: "ada@example.com",
  subject: "Hello",
  html: "<p>Hi <strong>Ada</strong></p>",
}
async function sendOne(f: Setup, body: Record<string, unknown> = {}) {
  const response = await post(f, { ...EMAIL, ...body })
  const json = await response.json()
  expect(response.status, JSON.stringify(json)).toBe(200)
  return json.id as Id<"emails">
}
const email = (f: Setup, id: Id<"emails">) =>
  f.t.run(async (ctx) => (await ctx.db.get("emails", id))!)
const deliver = async (f: Setup, id: Id<"emails">) =>
  f.t.action(internal.emailSend.deliver, {
    id,
    generation: (await email(f, id)).generation,
  })
const timeline = (f: Setup, id: Id<"emails">) =>
  f.t.run(async (ctx) =>
    (
      await ctx.db
        .query("emailEvents")
        .withIndex("by_emailId_and_at", (q) => q.eq("emailId", id))
        .collect()
    ).map((event) => event.type)
  )
const outbox = (f: Setup) => f.t.run((ctx) => ctx.db.query("events").collect())
const sends = (sent: Sent[]) =>
  sent.filter((call) => call.command === "SendEmailCommand")

describe("sending", () => {
  test("POST /emails queues the email; the sender passes the tenant, configuration set and tags", async () => {
    const f = await setup()
    const sent = ses()
    const id = await sendOne(f, {
      cc: ["Grace <grace@example.com>"],
      reply_to: "support@example.com",
      tags: [{ name: "category", value: "welcome" }],
      headers: { "X-Entity-Ref-ID": "42" },
    })
    expect(await email(f, id)).toMatchObject({
      organizationId: f.owner.team,
      status: "queued",
      to: ["ada@example.com"],
      cc: ["Grace <grace@example.com>"],
      source: "api",
    })
    await deliver(f, id)
    const [call] = sends(sent)
    expect(call.input).toMatchObject({
      FromEmailAddress: '"Acme" <hi@mail.example.test>',
      Destination: {
        ToAddresses: ["ada@example.com"],
        CcAddresses: ['"Grace" <grace@example.com>'],
        BccAddresses: [],
      },
      ReplyToAddresses: ["support@example.com"],
      TenantName: f.tenantName,
      ConfigurationSetName: "opensend-team-cfg",
      EmailTags: [
        { Name: "category", Value: "welcome" },
        { Name: "opensend_email", Value: id },
        { Name: "opensend_team", Value: f.owner.team },
      ],
      Content: {
        Simple: {
          Subject: { Data: "Hello", Charset: "UTF-8" },
          Body: {
            Html: { Data: EMAIL.html, Charset: "UTF-8" },
            Text: { Data: "Hi Ada", Charset: "UTF-8" },
          },
          Headers: [{ Name: "X-Entity-Ref-ID", Value: "42" }],
        },
      },
    })
    expect(await email(f, id)).toMatchObject({
      status: "sent",
      messageId: "m-1",
      claimed: false,
      attempts: 1,
    })
    expect(await timeline(f, id)).toEqual(["queued", "sent"])
    const [event] = await outbox(f)
    expect(event).toMatchObject({
      organizationId: f.owner.team,
      type: "email.sent",
      data: {
        email_id: id,
        message_id: "m-1",
        from: EMAIL.from,
        to: ["ada@example.com"],
        subject: "Hello",
        tags: { category: "welcome" },
      },
    })
    expect(event.data.created_at).toMatch(/^\d{4}-\d\d-\d\dT/)
    // A second run of the same generation never sends twice.
    await f.t.action(internal.emailSend.deliver, { id, generation: 0 })
    expect(sends(sent)).toHaveLength(1)
  })

  test("the request log links to the email, and GET returns Resend's shape", async () => {
    const f = await setup()
    ses()
    const id = await sendOne(f)
    const detail = await f.owner.client.query(api.emails.get, { id })
    expect(detail?.log).not.toBeNull()
    expect((await email(f, id)).apiLogId).toBe(detail!.log!._id)
    const log = await f.t.run((ctx) => ctx.db.get("apiLogs", detail!.log!._id))
    expect(log).toMatchObject({ emailId: id, path: "/emails" })
    await deliver(f, id)
    const response = await request(f, `/emails/${id}`)
    expect(await response.json()).toMatchObject({
      object: "email",
      id,
      to: ["ada@example.com"],
      from: EMAIL.from,
      subject: "Hello",
      html: EMAIL.html,
      text: "Hi Ada",
      cc: [],
      bcc: [],
      reply_to: [],
      last_event: "sent",
      scheduled_at: null,
      message_id: "m-1",
      tags: [],
    })
    const list = await (await request(f, "/emails?limit=1")).json()
    expect(list).toMatchObject({
      object: "list",
      has_more: false,
      data: [{ id, last_event: "sent", cc: null }],
    })
    expect(list.data[0]).not.toHaveProperty("html")
  })

  test("an Idempotency-Key replays the first send", async () => {
    const f = await setup()
    const headers = { "Idempotency-Key": "welcome-ada" }
    const first = await (await post(f, EMAIL, { headers })).json()
    const again = await (await post(f, EMAIL, { headers })).json()
    expect(again).toEqual(first)
    expect(
      await f.t.run((ctx) => ctx.db.query("emails").collect())
    ).toHaveLength(1)
  })

  test("validation follows Resend", async () => {
    const f = await setup()
    const refuse = async (body: unknown, status: number, text: string) => {
      const response = await post(f, body)
      const json = await response.json()
      expect(response.status, JSON.stringify(json)).toBe(status)
      expect(json.message).toContain(text)
    }
    await refuse({ ...EMAIL, from: undefined }, 422, "Missing `from` field")
    await refuse({ ...EMAIL, subject: " " }, 422, "Missing `subject` field")
    await refuse({ ...EMAIL, to: "nope" }, 422, "Invalid `to` field")
    await refuse({ ...EMAIL, html: undefined }, 422, "`html` or `text`")
    await refuse(
      { ...EMAIL, to: Array.from({ length: 51 }, (_, i) => `r${i}@x.dev`) },
      422,
      "at most 50 recipients"
    )
    await refuse(
      { ...EMAIL, tags: [{ name: "bad tag", value: "x" }] },
      422,
      "ASCII letters"
    )
    await refuse({ ...EMAIL, scheduled_at: "someday" }, 422, "scheduled_at")
    await refuse(
      { ...EMAIL, scheduled_at: "in 40 days" },
      422,
      "within the next 30 days"
    )
    await refuse({ ...EMAIL, headers: { Subject: "x" } }, 422, "own fields")
    await refuse({ ...EMAIL, topic_id: "t" }, 422, "topic_id")
    expect(
      await f.t.run((ctx) => ctx.db.query("emails").collect())
    ).toHaveLength(0)
  })

  test("the sender must be a verified domain of the team", async () => {
    const f = await setup()
    const other = await f.t.run(async (ctx) => {
      const domain = (await ctx.db.get("domains", f.domain))!
      const { _id, _creationTime, ...fields } = domain
      void _id
      void _creationTime
      return ctx.db.insert("domains", {
        ...fields,
        name: "other.example.test",
        organizationId: f.outsider.team,
      })
    })
    for (const from of ["hi@other.example.test", "hi@unknown.example.test"]) {
      const response = await post(f, { ...EMAIL, from })
      expect(response.status).toBe(403)
      expect((await response.json()).message).toMatch(/is not verified/)
    }
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { status: "pending" })
    )
    const pending = await post(f, EMAIL)
    expect(pending.status).toBe(403)
    expect(await pending.json()).toMatchObject({
      name: "validation_error",
      message: "Domain is not ready to send",
    })
    void other
  })

  test("a sending key only sends from its own domain", async () => {
    const f = await setup()
    const second = await f.t.run(async (ctx) => {
      const { _id, _creationTime, ...fields } = (await ctx.db.get(
        "domains",
        f.domain
      ))!
      void _id
      void _creationTime
      return ctx.db.insert("domains", { ...fields, name: "news.example.test" })
    })
    const { token } = await f.key({
      permission: "sending_access",
      domainId: second,
    })
    const response = await post(f, EMAIL, { token })
    expect(response.status).toBe(403)
    expect((await response.json()).message).toMatch(/its own domain/)
    // And it may not read emails back.
    expect((await request(f, "/emails", { token })).status).toBe(401)
  })

  test("sending is refused until the IAM policy revision is current", async () => {
    const f = await setup()
    await f.t.run((ctx) =>
      ctx.db.patch("installation", f.installation, { policyRevision: 1 })
    )
    const response = await post(f, EMAIL)
    expect(response.status).toBe(403)
    expect((await response.json()).message).toBe(
      "Ask your administrator to update AWS permissions"
    )
  })

  test("the region's send rate holds a send back until it has room", async () => {
    const f = await setup()
    await f.t.run((ctx) =>
      ctx.db.patch("sesRegions", f.region._id, {
        quota: { ...f.region.quota, production: true, rate: 1 },
      })
    )
    const sent = ses()
    const first = await sendOne(f)
    const second = await sendOne(f)
    await deliver(f, first)
    await deliver(f, second)
    expect(sends(sent)).toHaveLength(1)
    expect(await email(f, second)).toMatchObject({
      status: "queued",
      generation: 1,
      attempts: 0,
    })
    vi.advanceTimersByTime(1000)
    await deliver(f, second)
    expect(sends(sent)).toHaveLength(2)
    expect((await email(f, second)).status).toBe("sent")
  })

  test("throttling and server errors retry; a rejection fails for good", async () => {
    const f = await setup()
    let failure = awsFailure("TooManyRequestsException", 429)
    const sent = ses(() => {
      throw failure
    })
    const id = await sendOne(f)
    await deliver(f, id)
    expect(await email(f, id)).toMatchObject({
      status: "queued",
      generation: 1,
      attempts: 1,
      claimed: false,
    })
    failure = awsFailure("InternalFailure", 500)
    await deliver(f, id)
    expect((await email(f, id)).generation).toBe(2)
    failure = awsFailure("MessageRejected", 400)
    await deliver(f, id)
    const failed = await email(f, id)
    expect(failed).toMatchObject({ status: "failed", attempts: 3 })
    expect(failed.error).toMatch(/MessageRejected/)
    expect(failed.error).not.toContain("provider detail")
    expect(sends(sent)).toHaveLength(3)
    expect(await timeline(f, id)).toEqual(["queued", "failed"])
    const [event] = await outbox(f)
    expect(event).toMatchObject({
      type: "email.failed",
      data: { email_id: id, failed: { reason: failed.error } },
    })
  })

  test("a crashed run fails without risking a duplicate send", async () => {
    const f = await setup()
    const id = await sendOne(f)
    await f.t.mutation(internal.emails.deliverDone, {
      workId: "w" as never,
      context: { id, generation: 0 },
      result: { kind: "failed", error: "boom" },
    })
    expect(await email(f, id)).toMatchObject({
      status: "failed",
      generation: 0,
      attempts: 1,
    })
  })
})

describe("attachments, batches and templates", () => {
  test("attachments are stored and sent; unsafe or unsupported ones are refused", async () => {
    const f = await setup()
    const sent = ses()
    const content = btoa("%PDF-1.4 hello")
    const id = await sendOne(f, {
      attachments: [
        { filename: "invoice.pdf", content },
        { filename: "logo.png", content: btoa("png"), content_id: "logo" },
      ],
    })
    await deliver(f, id)
    const simple = (
      sends(sent)[0].input.Content as {
        Simple: {
          Attachments: { RawContent: Uint8Array }[]
          Body: { Html: { Data: string } }
        }
      }
    ).Simple
    expect(simple.Attachments).toHaveLength(2)
    expect(simple.Attachments[0]).toMatchObject({
      FileName: "invoice.pdf",
      ContentType: "application/pdf",
      ContentDisposition: "ATTACHMENT",
    })
    expect(new TextDecoder().decode(simple.Attachments[0].RawContent)).toBe(
      "%PDF-1.4 hello"
    )
    expect(simple.Attachments[1]).toMatchObject({
      ContentId: "logo",
      ContentDisposition: "INLINE",
      ContentType: "image/png",
    })
    const refuse = async (attachment: unknown, text: string) => {
      const response = await post(f, { ...EMAIL, attachments: [attachment] })
      expect(response.status).toBe(422)
      const json = await response.json()
      expect(json.name).toBe("invalid_attachment")
      expect(json.message).toContain(text)
    }
    await refuse({ filename: "run.exe", content }, ".exe cannot be sent")
    await refuse({ filename: "a.pdf", content: "***" }, "base64")
    await refuse({ filename: "a.pdf" }, "either a `content` or `path`")
    await refuse(
      { filename: "a.pdf", path: "https://example.com/a.pdf" },
      "by `path` are not supported"
    )
    await refuse({ content }, "`filename`")
    // Refused sends leave no files behind.
    expect(
      await f.t.run((ctx) => ctx.db.system.query("_storage").collect())
    ).toHaveLength(2)
  })

  test("a batch is validated whole: one bad email sends none", async () => {
    const f = await setup()
    const batch = (body: unknown) => post(f, body, {}, "/emails/batch")
    const ok = await batch([EMAIL, { ...EMAIL, to: ["grace@example.com"] }])
    const { data } = await ok.json()
    expect(data).toHaveLength(2)
    const count = () =>
      f.t.run(async (ctx) => (await ctx.db.query("emails").collect()).length)
    expect(await count()).toBe(2)
    for (const [body, text] of [
      [[EMAIL, { ...EMAIL, to: "nope" }], "Invalid `to` field"],
      [Array.from({ length: 101 }, () => EMAIL), "between 1 and 100"],
      [
        [{ ...EMAIL, attachments: [{ filename: "a.pdf", content: "YQ==" }] }],
        "not supported in batch",
      ],
      [EMAIL, "array of emails"],
    ] as const) {
      const response = await batch(body)
      expect(response.status).toBe(422)
      expect((await response.json()).message).toContain(text)
    }
    expect(await count()).toBe(2)
  })

  test("a published template fills the email; its variables are checked", async () => {
    const f = await setup()
    const sent = ses()
    const template = await f.owner.client.mutation(api.templates.create, {
      organizationId: f.owner.team,
      name: "Welcome",
      subject: "Hi {{{FIRST_NAME|there}}}",
      html: "<p>Welcome, {{{FIRST_NAME}}} ({{{PLAN}}})</p>",
    })
    const unpublished = await post(f, {
      from: EMAIL.from,
      to: EMAIL.to,
      template: { id: template },
    })
    expect(unpublished.status).toBe(404)
    await f.owner.client.mutation(api.templates.publish, { id: template })
    const missing = await post(f, {
      from: EMAIL.from,
      to: EMAIL.to,
      template: { id: "welcome", variables: { FIRST_NAME: "Ada" } },
    })
    expect((await missing.json()).message).toContain("PLAN")
    const both = await post(f, { ...EMAIL, template: { id: "welcome" } })
    expect(both.status).toBe(422)
    const id = await sendOne(f, {
      subject: undefined,
      html: undefined,
      template: { id: "welcome", variables: { FIRST_NAME: "Ada", PLAN: 3 } },
    })
    expect(await email(f, id)).toMatchObject({
      subject: "Hi Ada",
      templateId: template,
    })
    await deliver(f, id)
    const simple = (
      sends(sent)[0].input.Content as {
        Simple: {
          Attachments: { RawContent: Uint8Array }[]
          Body: { Html: { Data: string } }
        }
      }
    ).Simple
    expect(simple.Body.Html.Data).toBe("<p>Welcome, Ada (3)</p>")
  })
})

describe("suppressions", () => {
  test("suppressed recipients are skipped; an email with none left is suppressed", async () => {
    const f = await setup()
    const sent = ses()
    await f.member.client.mutation(api.suppressions.add, {
      organizationId: f.owner.team,
      email: "  Ada@Example.com ",
      reason: "manual",
    })
    const partial = await sendOne(f, {
      to: ["Ada <ada@example.com>", "grace@example.com"],
    })
    await deliver(f, partial)
    expect(
      (sends(sent)[0].input.Destination as { ToAddresses: string[] })
        .ToAddresses
    ).toEqual(["grace@example.com"])
    expect(await email(f, partial)).toMatchObject({
      status: "sent",
      suppressed: ["ada@example.com"],
    })
    const whole = await sendOne(f)
    await deliver(f, whole)
    expect(sends(sent)).toHaveLength(1)
    expect((await email(f, whole)).status).toBe("suppressed")
    expect(await timeline(f, whole)).toEqual(["queued", "suppressed"])
    const events = await outbox(f)
    expect(events.map((event) => event.type)).toEqual([
      "suppression.added",
      "email.sent",
      "email.suppressed",
    ])
    expect(events[2].data).toMatchObject({
      email_id: whole,
      suppressed: { type: "OnTeamSuppressionList" },
    })
  })

  test("members add, list and remove; removing a bounce clears the SES tenant list", async () => {
    const f = await setup()
    const sent = ses(() => ({}))
    const team = { organizationId: f.owner.team }
    await expect(
      f.member.client.mutation(api.suppressions.add, {
        ...team,
        email: "not-an-email",
        reason: "manual",
      })
    ).rejects.toThrow("Enter a valid email")
    const bounced = await f.t.mutation(internal.suppressions.record, {
      ...team,
      email: "Gone@Example.com",
      reason: "bounced",
    })
    // The same address again updates the one entry.
    await f.member.client.mutation(api.suppressions.add, {
      ...team,
      email: "gone@example.com",
      reason: "bounced",
    })
    await f.member.client.mutation(api.suppressions.add, {
      ...team,
      email: "manual@example.com",
      reason: "manual",
    })
    const list = (filters: Record<string, unknown> = {}) =>
      f.member.client.query(api.suppressions.list, {
        ...team,
        paginationOpts: { numItems: 10, cursor: null },
        ...filters,
      })
    expect((await list()).page.map((row) => row.email)).toEqual([
      "manual@example.com",
      "gone@example.com",
    ])
    expect((await list({ reason: "bounced" })).page).toHaveLength(1)
    expect(
      (await list({ search: "manual" })).page.map((row) => row.email)
    ).toEqual(["manual@example.com"])
    await f.member.client.mutation(api.suppressions.remove, { id: bounced })
    await f.t.action(internal.emailSend.releaseSuppression, {
      ...team,
      email: "gone@example.com",
    })
    expect(sent).toEqual([
      {
        command: "DeleteSuppressedDestinationCommand",
        input: { EmailAddress: "gone@example.com", TenantName: f.tenantName },
      },
    ])
    expect((await list()).page).toHaveLength(1)
  })
})

describe("scheduling", () => {
  test("a scheduled email waits; cancel means it is never sent", async () => {
    const f = await setup()
    const sent = ses()
    const id = await sendOne(f, { scheduled_at: "in 1 hour" })
    const row = await email(f, id)
    expect(row).toMatchObject({ status: "scheduled", generation: 0 })
    expect(row.scheduledAt).toBe(Date.now() + 3_600_000)
    expect((await outbox(f))[0]).toMatchObject({ type: "email.scheduled" })
    // Not due yet: the sender ignores a scheduled email.
    await deliver(f, id)
    expect(sends(sent)).toHaveLength(0)
    const cancel = await post(f, {}, {}, `/emails/${id}/cancel`)
    expect(await cancel.json()).toEqual({ object: "email", id })
    expect((await email(f, id)).status).toBe("canceled")
    // A release or run already on its way finds nothing to send.
    await f.t.mutation(internal.emails.release, { id, generation: 0 })
    await f.t.action(internal.emailSend.deliver, { id, generation: 0 })
    await f.t.action(internal.emailSend.deliver, { id, generation: 1 })
    expect(sends(sent)).toHaveLength(0)
    expect(await timeline(f, id)).toEqual(["scheduled", "canceled"])
    const again = await post(f, {}, {}, `/emails/${id}/cancel`)
    expect(again.status).toBe(422)
    expect((await again.json()).message).toBe(
      "Only scheduled emails can be canceled."
    )
  })

  test("once released to the sender, a cancel is refused and the send goes out", async () => {
    const f = await setup()
    const sent = ses()
    const id = await sendOne(f, { scheduled_at: "in 5 min" })
    await f.t.mutation(internal.emails.release, { id, generation: 0 })
    await expect(
      f.member.client.mutation(api.emails.cancel, { id })
    ).rejects.toThrow("Only scheduled emails can be canceled.")
    await deliver(f, id)
    expect(sends(sent)).toHaveLength(1)
  })

  test("a cancel that lands during the send cannot undo it", async () => {
    const f = await setup()
    let cancel: Promise<unknown> | undefined
    const id = await sendOne(f, { scheduled_at: "in 5 min" })
    await f.t.mutation(internal.emails.release, { id, generation: 0 })
    ses(() => {
      cancel = f.member.client
        .mutation(api.emails.cancel, { id })
        .catch((e: Error) => e.message)
      return { MessageId: "m-2" }
    })
    await deliver(f, id)
    expect(await cancel).toBe("Only scheduled emails can be canceled.")
    expect((await email(f, id)).status).toBe("sent")
  })

  test("PATCH reschedules; the old release is a no-op", async () => {
    const f = await setup()
    const id = await sendOne(f, { scheduled_at: "in 1 hour" })
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const response = await request(f, `/emails/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ scheduled_at: at }),
    })
    expect(await response.json()).toEqual({ object: "email", id })
    expect(await email(f, id)).toMatchObject({
      status: "scheduled",
      generation: 1,
      scheduledAt: Date.parse(at),
    })
    await f.t.mutation(internal.emails.release, { id, generation: 0 })
    expect((await email(f, id)).status).toBe("scheduled")
    await f.t.mutation(internal.emails.release, { id, generation: 1 })
    expect((await email(f, id)).status).toBe("queued")
    const late = await request(f, `/emails/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ scheduled_at: at }),
    })
    expect(late.status).toBe(422)
  })
})

describe("dashboard access", () => {
  test("members list, search and open the team's emails; other teams are refused", async () => {
    const f = await setup()
    const first = await sendOne(f)
    await sendOne(f, { to: "grace@example.com", subject: "Invoice ready" })
    const team = { organizationId: f.owner.team }
    const list = (filters: Record<string, unknown> = {}) =>
      f.member.client.query(api.emails.list, {
        ...team,
        paginationOpts: { numItems: 10, cursor: null },
        ...filters,
      })
    expect((await list()).page).toHaveLength(2)
    expect(
      (await list({ search: "invoice" })).page.map((row) => row.subject)
    ).toEqual(["Invoice ready"])
    expect((await list({ status: "sent" })).page).toHaveLength(0)
    expect((await list({ to: Date.now() - 1000 })).page).toHaveLength(0)
    const history = await f.member.client.query(api.emails.byRecipient, {
      ...team,
      address: "ADA@example.com",
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(history.page.map((row) => row._id)).toEqual([first])
    const detail = await f.member.client.query(api.emails.get, { id: first })
    expect(detail).toMatchObject({ html: EMAIL.html, text: "Hi Ada" })
    const trail = await f.member.client.query(api.emails.timeline, {
      id: first,
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(trail.page.map((event) => event.type)).toEqual(["queued"])

    const outsider = f.outsider.client
    await expect(
      outsider.query(api.emails.list, {
        ...team,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toThrow("permission")
    await expect(outsider.query(api.emails.get, { id: first })).rejects.toThrow(
      "permission"
    )
    await expect(
      outsider.mutation(api.emails.cancel, { id: first })
    ).rejects.toThrow("permission")
    await expect(
      outsider.query(api.suppressions.list, {
        ...team,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.suppressions.add, {
        ...team,
        email: "x@example.com",
        reason: "manual",
      })
    ).rejects.toThrow("permission")
    // Another team's key cannot see it either.
    const { token } = await f.outsider.client.action(api.apiKeys.create, {
      organizationId: f.outsider.team,
      input: { name: "Theirs", permission: "full_access", domainId: null },
    })
    expect((await request(f, `/emails/${first}`, { token })).status).toBe(404)
  })

  test("a member cancels a scheduled email from the dashboard", async () => {
    const f = await setup()
    const id = await sendOne(f, { scheduled_at: "in 1 hour" })
    await f.member.client.mutation(api.emails.cancel, { id })
    expect((await email(f, id)).status).toBe("canceled")
  })

  test("emails and suppressions export with the list's filters", async () => {
    const f = await setup()
    await sendOne(f)
    await sendOne(f, { subject: "Invoice ready" })
    await f.t.mutation(internal.suppressions.record, {
      organizationId: f.owner.team,
      email: "gone@example.com",
      reason: "complained",
    })
    const page = { numItems: 10, cursor: null }
    const emails = await f.t.run((ctx) =>
      EXPORT_SOURCES.emails.page(
        ctx,
        f.owner.team,
        { search: "invoice" },
        page,
        []
      )
    )
    expect(emails.rows).toHaveLength(1)
    expect(emails.rows[0][6]).toBe("Invoice ready")
    const suppressions = await f.t.run((ctx) =>
      EXPORT_SOURCES.suppressions.page(
        ctx,
        f.owner.team,
        { reason: "complained" },
        page,
        []
      )
    )
    expect(suppressions.rows.map((row) => row[1])).toEqual(["gone@example.com"])
  })
})

describe("installation sender", () => {
  const FROM = "Opensend <no-reply@mail.example.test>"

  test("set, used for account email, kept out of team lists, and cleared", async () => {
    const f = await setup()
    const sent = ses()
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    await expect(
      f.t.mutation(internal.installationAdmin.setSystemSender, {
        from: "no-reply@unknown.example.test",
      })
    ).rejects.toThrow("verified with sending enabled")
    await f.t.mutation(internal.installationAdmin.setSystemSender, {
      from: FROM,
    })
    await f.owner.client.mutation(api.teams.invite, {
      organizationId: f.owner.team,
      email: "new@example.com",
      role: "member",
    })
    const [row] = await f.t.run((ctx) => ctx.db.query("emails").collect())
    expect(row).toMatchObject({
      organizationId: "installation",
      source: "system",
      to: ["new@example.com"],
      subject: "Join your Opensend team",
    })
    expect(
      (
        await f.owner.client.query(api.emails.list, {
          organizationId: f.owner.team,
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).page
    ).toHaveLength(0)
    expect(
      await f.owner.client.query(api.emails.get, { id: row._id })
    ).toBeNull()
    await deliver(f, row._id)
    expect(sends(sent)[0].input).toMatchObject({
      FromEmailAddress: '"Opensend" <no-reply@mail.example.test>',
      TenantName: f.tenantName,
      ConfigurationSetName: "opensend-team-cfg",
      EmailTags: expect.arrayContaining([
        { Name: "opensend_team", Value: f.owner.team },
      ]),
    })
    // The one-time link leaves the database once the email is sent, and
    // nothing about it reached the log or a team's webhooks.
    expect(
      await f.t.run((ctx) => ctx.db.query("emailContents").collect())
    ).toHaveLength(0)
    expect(log).not.toHaveBeenCalled()
    expect(await outbox(f)).toHaveLength(0)

    await f.t.mutation(internal.installationAdmin.setSystemSender, {})
    await f.t.mutation(internal.systemEmail.send, {
      to: f.owner.user.email,
      kind: "reset",
      url: "https://opensend.test/reset?token=t",
    })
    expect(log).toHaveBeenCalledOnce()
    expect(
      await f.t.run((ctx) => ctx.db.query("emails").collect())
    ).toHaveLength(1)
  })

  test("an account email that cannot be sent logs only the reason", async () => {
    const f = await setup()
    await f.t.mutation(internal.installationAdmin.setSystemSender, {
      from: FROM,
    })
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { status: "pending" })
    )
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await f.t.mutation(internal.systemEmail.send, {
      to: "new@example.com",
      kind: "reset",
      url: "https://opensend.test/reset?token=secret",
    })
    expect(error).toHaveBeenCalledWith(
      "Account email not sent: Domain is not ready to send"
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret")
  })
})

describe("sending regression coverage", () => {
  test("reserves every recipient across seconds without double charging", async () => {
    const f = await setup()
    await f.t.run((ctx) =>
      ctx.db.patch("sesRegions", f.region._id, {
        quota: { ...f.region.quota, production: true, rate: 1 },
      })
    )
    const calls = ses()
    const many = await sendOne(f, { to: ["a@x.dev", "b@x.dev", "c@x.dev"] })
    const one = await sendOne(f)
    await deliver(f, many)
    await deliver(f, one)
    expect(sends(calls)).toHaveLength(0)
    expect((await email(f, many)).rateReadyAt).toBe(Date.now() + 2000)
    expect((await email(f, one)).rateReadyAt).toBe(Date.now() + 3000)
    // An early duplicate run waits on the same reservation.
    await deliver(f, many)
    expect((await email(f, many)).rateReadyAt).toBe(Date.now() + 2000)
    vi.setSystemTime(Date.now() + 2000)
    await deliver(f, many)
    expect(sends(calls)).toHaveLength(1)
    vi.setSystemTime(Date.now() + 1000)
    await deliver(f, one)
    expect(sends(calls)).toHaveLength(2)
  })

  test("an unknown transport outcome and a permanent error without metadata do not retry", async () => {
    const f = await setup()
    for (const name of ["TimeoutError", "MessageRejected"]) {
      ses(() => {
        throw Object.assign(new Error("detail"), { name })
      })
      const id = await sendOne(f)
      await deliver(f, id)
      expect(await email(f, id)).toMatchObject({
        status: "failed",
        generation: 0,
        attempts: 1,
      })
    }
  })

  test("a canceled generation cannot claim, including after a stale worker starts", async () => {
    const f = await setup()
    const calls = ses()
    const id = await sendOne(f, { scheduled_at: "in 1 hour" })
    await f.member.client.mutation(api.emails.cancel, { id })
    await f.t.action(internal.emailSend.deliver, { id, generation: 0 })
    expect(sends(calls)).toHaveLength(0)
  })

  test("does not inject unsubscribe headers; accepts Resend tag characters", async () => {
    const f = await setup()
    const calls = ses()
    const id = await sendOne(f, {
      tags: [{ name: "_category", value: "welcome-v1" }],
    })
    await deliver(f, id)
    expect(
      (sends(calls)[0].input.Content as { Simple: object }).Simple
    ).not.toHaveProperty("Headers")
    expect((await outbox(f))[0].data.tags).toEqual({ _category: "welcome-v1" })
  })

  test("malformed attachment padding and MIME metadata fail with 422", async () => {
    const f = await setup()
    for (const attachment of [
      { filename: "a.txt", content: "a=" },
      {
        filename: "a.txt",
        content: "YQ==",
        content_type: "text/plain\r\nX: bad",
      },
      { filename: "a.txt", content: "YQ==", content_id: "bad id" },
      { filename: "a.txt", content: "a".repeat(40 * 1024 * 1024 + 4) },
    ]) {
      const response = await post(f, { ...EMAIL, attachments: [attachment] })
      expect(response.status).toBe(422)
      expect((await response.json()).name).toBe("invalid_attachment")
    }
  })

  test("counts follow sends, status changes, suppressions and recipient history", async () => {
    const f = await setup()
    const team = { organizationId: f.owner.team }
    const id = await sendOne(f)
    const count = (status?: "queued" | "sent") =>
      f.member.client.query(api.emails.count, { ...team, status })
    expect(await count()).toEqual({ total: 1 })
    expect(await count("queued")).toEqual({ total: 1 })
    ses()
    await deliver(f, id)
    expect(await count("queued")).toEqual({ total: 0 })
    expect(await count("sent")).toEqual({ total: 1 })
    expect(
      await f.member.client.query(api.emails.byRecipientCount, {
        ...team,
        address: "ADA@example.com",
      })
    ).toEqual({ total: 1 })
    const sid = await f.member.client.mutation(api.suppressions.add, {
      ...team,
      email: "a@x.dev",
      reason: "manual",
    })
    expect(await f.member.client.query(api.suppressions.count, team)).toEqual({
      total: 1,
    })
    await f.t.mutation(internal.suppressions.record, {
      ...team,
      email: "a@x.dev",
      reason: "bounced",
    })
    expect(
      await f.member.client.query(api.suppressions.count, {
        ...team,
        reason: "manual",
      })
    ).toEqual({ total: 0 })
    await f.member.client.mutation(api.suppressions.remove, { id: sid })
    expect(await f.member.client.query(api.suppressions.count, team)).toEqual({
      total: 0,
    })
    await expect(
      f.outsider.client.query(api.emails.count, team)
    ).rejects.toThrow("permission")
    await expect(
      f.outsider.client.query(api.suppressions.count, team)
    ).rejects.toThrow("permission")
  })

  test("search requires the whole query and exports use the same filter", async () => {
    const f = await setup()
    await sendOne(f, { subject: "Invoice ready" })
    await sendOne(f, { subject: "Invoice overdue" })
    const filters = {
      organizationId: f.owner.team,
      search: "invoice ready",
      paginationOpts: { cursor: null, numItems: 40 },
    }
    expect(
      (await f.member.client.query(api.emails.list, filters)).page.map(
        (row) => row.subject
      )
    ).toEqual(["Invoice ready"])
    const exported = await f.t.run((ctx) =>
      EXPORT_SOURCES.emails.page(
        ctx,
        f.owner.team,
        { search: filters.search },
        filters.paginationOpts,
        []
      )
    )
    expect(exported.rows).toHaveLength(1)
  })

  test("timeline and insights paginate past 200 events with scoped counts", async () => {
    const f = await setup()
    const id = await sendOne(f)
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 205; i++)
        await insertEmailEvent(
          ctx,
          id,
          i % 2 ? "clicked" : "opened",
          Date.now() + i
        )
    })
    expect(
      await f.member.client.query(api.emails.timelineCount, { id })
    ).toEqual({ total: 206 })
    expect(
      await f.member.client.query(api.emails.timelineCount, {
        id,
        insights: true,
      })
    ).toEqual({ total: 205 })
    let cursor: string | null = null
    const seen = new Set<string>()
    for (;;) {
      const page: PaginationResult<Doc<"emailEvents">> =
        await f.member.client.query(api.emails.timeline, {
          id,
          paginationOpts: { cursor, numItems: 40 },
        })
      for (const row of page.page) seen.add(row._id)
      if (page.isDone) break
      cursor = page.continueCursor
    }
    expect(seen.size).toBe(206)
    await expect(
      f.outsider.client.query(api.emails.timelineCount, { id })
    ).rejects.toThrow("permission")
  })

  test("retention removes content, attachments and children without touching queued work", async () => {
    const f = await setup()
    const id = await sendOne(f, {
      attachments: [{ filename: "a.txt", content: "YQ==" }],
    })
    const queued = await sendOne(f)
    ses()
    await deliver(f, id)
    await f.t.run(async (ctx) => {
      await patchEmail(ctx, id, { expiresAt: Date.now() - 1 })
      await patchEmail(ctx, queued, { expiresAt: Date.now() - 1 })
      for (let i = 0; i < 55; i++) await insertEmailEvent(ctx, id, "opened")
    })
    for (let i = 0; i < 4; i++) await f.t.mutation(internal.emails.prune, {})
    expect(await f.t.run((ctx) => ctx.db.get("emails", id))).toBeNull()
    expect((await email(f, queued)).status).toBe("queued")
    expect(
      await f.member.client.query(api.emails.count, {
        organizationId: f.owner.team,
      })
    ).toEqual({ total: 1 })
    const children = await f.t.run(async (ctx) => ({
      events: await ctx.db
        .query("emailEvents")
        .withIndex("by_emailId_and_at", (q) => q.eq("emailId", id))
        .collect(),
      recipients: await ctx.db
        .query("emailRecipients")
        .withIndex("by_emailId", (q) => q.eq("emailId", id))
        .collect(),
      content: await ctx.db
        .query("emailContents")
        .withIndex("by_emailId", (q) => q.eq("emailId", id))
        .collect(),
      files: await ctx.db.system.query("_storage").collect(),
    }))
    expect(children).toEqual({
      events: [],
      recipients: [],
      content: [],
      files: [],
    })
  })

  test("system emails have no team counters or readable timeline", async () => {
    const f = await setup()
    await f.t.mutation(internal.installationAdmin.setSystemSender, {
      from: "no-reply@mail.example.test",
    })
    await f.t.mutation(internal.systemEmail.send, {
      to: "a@x.dev",
      kind: "verify",
      url: "https://opensend.test/verify?token=secret",
    })
    const [row] = await f.t.run((ctx) => ctx.db.query("emails").collect())
    expect(
      await f.owner.client.query(api.emails.count, {
        organizationId: f.owner.team,
      })
    ).toEqual({ total: 0 })
    await expect(
      f.owner.client.query(api.emails.timeline, {
        id: row._id,
        paginationOpts: { numItems: 40, cursor: null },
      })
    ).rejects.toThrow("Email not found")
    // A subsequently disabled sending capability refuses the worker too.
    await f.t.run((ctx) =>
      patchRow(ctx, "domains", f.domain, { sending: false })
    )
    const calls = ses()
    await deliver(f, row._id)
    expect(sends(calls)).toHaveLength(0)
    expect((await email(f, row._id)).status).toBe("failed")
  })
})

test("REST list cursors visit batch emails without loss", async () => {
  const f = await setup()
  const response = await post(f, [EMAIL, EMAIL, EMAIL], {}, "/emails/batch")
  const batch = await response.json()
  expect(response.status).toBe(200)
  const first = await (await request(f, "/emails?limit=2")).json()
  expect(first.data).toHaveLength(2)
  expect(first.has_more).toBe(true)
  const next = await (
    await request(f, `/emails?limit=2&after=${first.data[1].id}`)
  ).json()
  expect(next.data).toHaveLength(1)
  const ids = [...first.data, ...next.data].map((row: { id: string }) => row.id)
  expect(new Set(ids)).toEqual(
    new Set(batch.data.map((row: { id: string }) => row.id))
  )
  const back = await (
    await request(f, `/emails?limit=2&before=${next.data[0].id}`)
  ).json()
  expect(back.data.map((row: { id: string }) => row.id)).toEqual(
    first.data.map((row: { id: string }) => row.id)
  )
})
