import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { insertEmailEvent } from "./emailRows"
import { insertRow, patchRow } from "./counts"
import { recipientPage } from "./broadcasts"
import { EXPORT_SOURCES } from "./exportSources"
import { readUnsubscribeToken } from "../lib/unsubscribe/token"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("BETTER_AUTH_SECRET", "broadcast-test-secret-32-characters")
  vi.stubEnv("SITE_URL", "https://opensend.test")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const page = { numItems: 50, cursor: null }
const content = {
  name: "Launch",
  from: "Opensend <hi@mail.example.test>",
  subject: "Hi {{{FIRST_NAME|friend}}}",
  html: '<p>{{{contact.first_name}}} {{{company}}} <a href="{{{OPENSEND_UNSUBSCRIBE_URL}}}">Leave</a></p>',
}
async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
  })
  await storeTestCredentials(f)
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-team-cfg",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 100 },
    })
  })
  const org = f.owner.team
  const create = (input = {}) =>
    f.owner.client.mutation(api.broadcasts.create, {
      organizationId: org,
      ...content,
      ...input,
    })
  const contacts = async (
    inputs: {
      email: string
      firstName?: string
      unsubscribed?: boolean
      properties?: Record<string, string>
    }[],
    segmentIds: Id<"segments">[] = []
  ) =>
    (
      await f.owner.client.mutation(api.contacts.upsert, {
        organizationId: org,
        contacts: inputs,
        segmentIds,
      })
    ).createdIds
  const topic = (defaultSubscription: "opt_in" | "opt_out" = "opt_out") =>
    f.owner.client.mutation(api.topics.create, {
      organizationId: org,
      name: "News",
      description: "",
      defaultSubscription,
      visibility: "public",
    })
  const read = (id: Id<"broadcasts">) =>
    f.t.run((ctx) => ctx.db.get("broadcasts", id))
  const stats = (id: Id<"broadcasts">) =>
    f.owner.client.query(api.broadcastMetrics.stats, {
      organizationId: org,
      id,
    })
  const recipients = (id: Id<"broadcasts">) =>
    f.t.run((ctx) =>
      ctx.db
        .query("broadcastRecipients")
        .withIndex("by_broadcastId_and_email", (q) => q.eq("broadcastId", id))
        .collect()
    )
  const fanout = async (id: Id<"broadcasts">) => {
    vi.setSystemTime(Date.now() + 1000)
    await f.owner.client.mutation(api.broadcasts.send, { id })
    const row = (await read(id))!
    // Drive durable pages without advancing unrelated SES provisioning jobs.
    await f.t.run((ctx) =>
      patchRow(ctx, "broadcasts", id, { audienceBefore: Date.now() })
    )
    while (
      !(await f.t.mutation(internal.broadcastSend.batch, {
        id,
        generation: row.generation,
      }))
    ) {
      /* drain */
    }
    return recipients(id)
  }
  return { ...f, org, create, contacts, topic, read, stats, recipients, fanout }
}
type F = Awaited<ReturnType<typeof setup>>

test("CRUD, draft body round-trip, duplicate, scoped pagination and counts", async () => {
  const f = await setup()
  const id = await f.create({ content: { type: "doc", content: [] } })
  await f.owner.client.mutation(api.broadcasts.update, {
    id,
    name: "Renamed",
    preview: "Preview",
    html: "<p>Saved</p>",
  })
  const item = await f.owner.client.query(api.broadcasts.get, {
    organizationId: f.org,
    id,
  })
  expect(item?.row).toMatchObject({
    name: "Renamed",
    preview: "Preview",
    status: "draft",
  })
  expect(item?.body).toMatchObject({
    html: "<p>Saved</p>",
    content: { type: "doc" },
  })
  await f.owner.client.mutation(api.broadcasts.update, {
    id,
    replyTo: "new@example.com",
  })
  expect((await f.read(id))?.replyToAddresses).toEqual(["new@example.com"])
  await f.owner.client.mutation(api.broadcasts.update, { id, replyTo: "" })
  expect((await f.read(id))?.replyToAddresses).toEqual([])
  const copy = await f.owner.client.mutation(api.broadcasts.duplicate, { id })
  expect((await f.read(copy))?.name).toBe("Renamed copy")
  const result = await f.owner.client.query(api.broadcasts.list, {
    organizationId: f.org,
    paginationOpts: { ...page, numItems: 1 },
  })
  expect(result.page).toHaveLength(1)
  expect(result.isDone).toBe(false)
  expect(
    (
      await f.owner.client.query(api.broadcasts.count, {
        organizationId: f.org,
      })
    ).total
  ).toBe(2)
  await f.owner.client.mutation(api.broadcasts.remove, { id })
  expect(await f.read(id)).toBeNull()
  expect(
    (
      await f.owner.client.query(api.broadcasts.count, {
        organizationId: f.org,
      })
    ).total
  ).toBe(1)
})
test("team isolation refuses queries, updates, sends, review and stats", async () => {
  const f = await setup()
  const id = await f.create()
  for (const call of [
    () =>
      f.outsider.client.query(api.broadcasts.list, {
        organizationId: f.org,
        paginationOpts: page,
      }),
    () =>
      f.outsider.client.mutation(api.broadcasts.update, { id, name: "stolen" }),
    () => f.outsider.client.mutation(api.broadcasts.send, { id }),
    () =>
      f.outsider.client.action(api.broadcasts.review, {
        organizationId: f.org,
        segmentId: null,
        topicId: null,
      }),
    () =>
      f.outsider.client.query(api.broadcastMetrics.stats, {
        organizationId: f.org,
        id,
      }),
  ])
    await expect(call()).rejects.toThrow(/permission/i)
  expect(
    (
      await f.outsider.client.query(api.broadcasts.list, {
        organizationId: f.outsider.team,
        paginationOpts: page,
      })
    ).page
  ).toEqual([])
})
test("a plain member can create, edit and send", async () => {
  const f = await setup()
  const member = await f.actor("member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: f.org,
        userId: member.user._id,
        role: "member",
        createdAt: Date.now(),
      },
    },
  })
  const id = await member.client.mutation(api.broadcasts.create, {
    organizationId: f.org,
    ...content,
  })
  await member.client.mutation(api.broadcasts.update, { id, name: "Member" })
  await member.client.mutation(api.broadcasts.send, { id })
  expect((await f.read(id))?.status).toBe("queued")
})
test("validates sizes, addresses, cross-team targets and empty content", async () => {
  const f = await setup()
  await expect(f.create({ html: "x".repeat(256 * 1024 + 1) })).rejects.toThrow(
    /256 KB/
  )
  await expect(f.create({ from: "invalid" })).rejects.toThrow(/Invalid from/)
  const foreign = await f.outsider.client.mutation(api.segments.create, {
    organizationId: f.outsider.team,
    name: "Private",
  })
  await expect(f.create({ segmentId: foreign })).rejects.toThrow(/not found/)
  const empty = await f.create({ subject: "" })
  await expect(
    f.owner.client.mutation(api.broadcasts.send, { id: empty })
  ).rejects.toThrow(/subject/)
  const badDomain = await f.create({ from: "me@unverified.test" })
  await expect(
    f.owner.client.mutation(api.broadcasts.send, { id: badDomain })
  ).rejects.toThrow(/not verified/)
})
test("segment, global opt-out, topic opt-out and suppression resolve server-side", async () => {
  const f = await setup()
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.org,
    name: "News",
  })
  const topicId = await f.topic()
  const ids = await f.contacts(
    [
      { email: "yes@example.com" },
      { email: "global@example.com", unsubscribed: true },
      { email: "topic@example.com" },
      { email: "suppressed@example.com" },
    ],
    [segmentId]
  )
  await f.contacts([{ email: "outside@example.com" }])
  await f.owner.client.mutation(api.contacts.setTopic, {
    id: ids[2],
    topicId,
    subscription: "unsubscribed",
  })
  await f.t.mutation(internal.suppressions.record, {
    organizationId: f.org,
    email: "suppressed@example.com",
    reason: "manual",
  })
  expect(
    await f.owner.client.action(api.broadcasts.review, {
      organizationId: f.org,
      segmentId,
      topicId,
    })
  ).toBe(1)
  const id = await f.create({ segmentId, topicId })
  const recipients = await f.fanout(id)
  // As on Resend, a suppressed address gets a suppressed email, not a send.
  expect(recipients.map((r) => r.email).sort()).toEqual([
    "suppressed@example.com",
    "yes@example.com",
  ])
  await f.t.action(internal.emailSend.deliver, {
    id: recipients.find((r) => r.email === "suppressed@example.com")!.emailId,
    generation: 0,
  })
  expect(await f.stats(id)).toMatchObject({ recipients: 2, suppressed: 1 })
})
test("an opt-in topic excludes implicit choices and includes explicit opt-ins", async () => {
  const f = await setup()
  const topicId = await f.topic("opt_in")
  const ids = await f.contacts([
    { email: "yes@example.com" },
    { email: "no@example.com" },
  ])
  await f.owner.client.mutation(api.contacts.setTopic, {
    id: ids[0],
    topicId,
    subscription: "subscribed",
  })
  expect(
    (await f.fanout(await f.create({ topicId }))).map((r) => r.email)
  ).toEqual(["yes@example.com"])
})
test("review counts more than the newest 100 contacts and fan-out spans pages", async () => {
  const f = await setup()
  for (let batch = 0; batch < 2; batch++)
    await f.contacts(
      Array.from({ length: 60 }, (_, i) => ({
        email: `person${batch * 60 + i}@example.com`,
      }))
    )
  expect(
    await f.owner.client.action(api.broadcasts.review, {
      organizationId: f.org,
      segmentId: null,
      topicId: null,
    })
  ).toBe(120)
  const id = await f.create()
  expect(await f.fanout(id)).toHaveLength(120)
  expect((await f.stats(id)).recipients).toBe(120)
})
test("recipient copies escape merge tags, fill properties, and carry topic unsubscribe headers", async () => {
  const f = await setup()
  await f.owner.client.mutation(api.contactProperties.create, {
    organizationId: f.org,
    key: "company",
    name: "Company",
    type: "string",
    fallbackValue: "Default",
  })
  const [contactId] = await f.contacts([
    {
      email: "ada@example.com",
      firstName: "Ada <3",
      properties: { company: "A&B" },
    },
  ])
  const topicId = await f.topic()
  const id = await f.create({ topicId })
  const [recipient] = await f.fanout(id)
  const body = await f.t.run((ctx) =>
    ctx.db
      .query("emailContents")
      .withIndex("by_emailId", (q) => q.eq("emailId", recipient.emailId))
      .unique()
  )
  const row = await f.t.run((ctx) => ctx.db.get("emails", recipient.emailId))
  expect(row).toMatchObject({ broadcastId: id, subject: "Hi Ada <3" })
  expect(body?.html).toContain("Ada &lt;3 A&amp;B")
  expect(body?.html).not.toContain("{{{")
  const headers = Object.fromEntries(
    body!.headers!.map((h) => [h.name, h.value])
  )
  expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
  const token = headers["List-Unsubscribe"].slice(1, -1).split("/").pop()!
  expect(
    await readUnsubscribeToken(token, "broadcast-test-secret-32-characters")
  ).toMatchObject({ contactId, topicId, broadcastId: id })
  await f.t.mutation(internal.unsubscribe.oneClick, { token })
  await f.t.mutation(internal.unsubscribe.oneClick, { token })
  expect((await f.stats(id)).unsubscribed).toBe(1)
})
test("fan-out retry and a replayed cursor never enqueue a recipient twice", async () => {
  const f = await setup()
  await f.contacts([{ email: "one@example.com" }, { email: "two@example.com" }])
  const id = await f.create()
  await f.fanout(id)
  const generation = (await f.read(id))!.generation
  await f.t.run((ctx) =>
    patchRow(ctx, "broadcasts", id, { audienceDone: false, cursor: undefined })
  )
  await f.t.mutation(internal.broadcastSend.batch, { id, generation })
  await f.t.mutation(internal.broadcastSend.batch, { id, generation })
  expect(await f.recipients(id)).toHaveLength(2)
  expect(await f.t.run((ctx) => ctx.db.query("emails").collect())).toHaveLength(
    2
  )
})
test("schedule, cancel, stale release and deleting a scheduled broadcast", async () => {
  const f = await setup()
  const id = await f.create()
  await f.owner.client.mutation(api.broadcasts.send, {
    id,
    scheduledAt: Date.now() + 60_000,
  })
  expect((await f.read(id))?.status).toBe("scheduled")
  const oldGeneration = (await f.read(id))!.generation
  await f.owner.client.mutation(api.broadcasts.cancel, { id })
  await f.t.mutation(internal.broadcastSend.start, {
    id,
    generation: oldGeneration,
  })
  expect((await f.read(id))?.status).toBe("canceled")
  await f.owner.client.mutation(api.broadcasts.update, {
    id,
    subject: "Edited",
  })
  await f.owner.client.mutation(api.broadcasts.send, {
    id,
    scheduledAt: Date.now() + 60_000,
  })
  await f.owner.client.mutation(api.broadcasts.remove, { id })
  await f.t.mutation(internal.broadcastSend.start, {
    id,
    generation: (await f.read(id))?.generation ?? 3,
  })
  expect(await f.read(id)).toBeNull()
})
test("deleted segment or topic refuses review and send without widening", async () => {
  const f = await setup()
  for (const kind of ["segment", "topic"] as const) {
    const target =
      kind === "segment"
        ? await f.owner.client.mutation(api.segments.create, {
            organizationId: f.org,
            name: "Deleted",
          })
        : await f.topic()
    const input =
      kind === "segment"
        ? { segmentId: target as Id<"segments"> }
        : { topicId: target as Id<"topics"> }
    const id = await f.create(input)
    if (kind === "segment")
      await f.owner.client.mutation(api.segments.remove, {
        id: target as Id<"segments">,
      })
    else
      await f.owner.client.mutation(api.topics.remove, {
        id: target as Id<"topics">,
      })
    await expect(
      f.owner.client.mutation(api.broadcasts.send, { id })
    ).rejects.toThrow()
    await expect(
      f.owner.client.action(api.broadcasts.review, {
        organizationId: f.org,
        segmentId: null,
        topicId: null,
        ...input,
      })
    ).rejects.toThrow()
    expect((await f.read(id))?.status).toBe("draft")
  }
})
test("a deleted audience between scheduling and fan-out fails the durable run", async () => {
  const f = await setup()
  const topicId = await f.topic()
  const id = await f.create({ topicId })
  await f.owner.client.mutation(api.broadcasts.send, { id })
  await f.owner.client.mutation(api.topics.remove, { id: topicId })
  const generation = (await f.read(id))!.generation
  await expect(
    f.t.mutation(internal.broadcastSend.batch, { id, generation })
  ).rejects.toThrow()
  expect(await f.recipients(id)).toEqual([])
})
test("SES send keeps tenant tags and broadcast webhook data; unique metrics survive retention", async () => {
  const f = await setup()
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockResolvedValue({ MessageId: "broadcast-message" } as never)
  await f.contacts([{ email: "ada@example.com" }])
  const id = await f.create()
  const [recipient] = await f.fanout(id)
  await f.t.action(internal.emailSend.deliver, {
    id: recipient.emailId,
    generation: 0,
  })
  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0][0].input).toMatchObject({
    TenantName: f.tenantName,
    ConfigurationSetName: "opensend-team-cfg",
  })
  expect((await f.read(id))?.status).toBe("sent")
  await f.t.run(async (ctx) => {
    for (const type of [
      "delivered",
      "opened",
      "clicked",
      "opened",
      "bounced",
      "complained",
    ] as const)
      await insertEmailEvent(ctx, recipient.emailId, type)
  })
  expect(await f.stats(id)).toMatchObject({
    recipients: 1,
    delivered: 1,
    opened: 1,
    clicked: 1,
    bounced: 1,
    complained: 1,
  })
  const events = await f.owner.client.query(api.broadcasts.eventList, {
    id,
    type: "bounced",
    paginationOpts: page,
  })
  expect(events.page.map((e) => e.email)).toEqual(["ada@example.com"])
  const history = await f.owner.client.query(api.broadcasts.history, {
    organizationId: f.org,
    email: "ada@example.com",
    paginationOpts: page,
  })
  expect(history.page.map((b) => b._id)).toEqual([id])
  const outbox = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(outbox.find((e) => e.type === "email.sent")?.data).toMatchObject({
    broadcast_id: id,
  })
  await expect(
    f.owner.client.mutation(api.broadcasts.remove, { id })
  ).rejects.toThrow(/unsent/)
  await f.t.run((ctx) =>
    patchRow(ctx, "emails", recipient.emailId, { expiresAt: Date.now() - 1 })
  )
  await f.t.mutation(internal.emails.prune, {})
  expect((await f.stats(id)).opened).toBe(1)
})
test("permanent sender failure settles the broadcast as failed", async () => {
  const f = await setup()
  await f.contacts([{ email: "ada@example.com" }])
  const id = await f.create()
  const [recipient] = await f.fanout(id)
  await f.t.mutation(internal.emails.record, {
    id: recipient.emailId,
    generation: 0,
    outcome: { kind: "failed", error: "Rejected", retryable: false },
  })
  expect((await f.read(id))?.status).toBe("failed")
})
async function rest(f: F) {
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.org,
    input: { name: "Broadcasts", permission: "full_access", domainId: null },
  })
  return (path: string, method = "GET", body?: unknown) =>
    f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
}
test("REST CRUD shapes, natural-language scheduling, cancel and delete", async () => {
  const f = await setup()
  const request = await rest(f)
  const response = await request("/broadcasts", "POST", {
    ...content,
    preview_text: "Preview",
    reply_to: ["reply@example.com"],
  })
  expect(response.status).toBe(201)
  const created = await response.json()
  expect(created.object).toBe("broadcast")
  const url = `/broadcasts/${created.id}`
  expect(await (await request(url)).json()).toMatchObject({
    id: created.id,
    name: "Launch",
    status: "draft",
    segment_id: null,
    scheduled_at: null,
    topic_id: null,
    preview_text: "Preview",
    reply_to: ["reply@example.com"],
    html: content.html,
  })
  expect(await (await request(url, "PATCH", { name: "New" })).json()).toEqual({
    object: "broadcast",
    id: created.id,
  })
  expect(await (await request("/broadcasts")).json()).toMatchObject({
    object: "list",
    has_more: false,
    data: [{ id: created.id, name: "New" }],
  })
  expect(
    (await request(url + "/send", "POST", { scheduled_at: "in 1 hour" })).status
  ).toBe(200)
  expect((await f.read(created.id))?.status).toBe("scheduled")
  expect((await request(url + "/cancel", "POST", {})).status).toBe(200)
  expect(await (await request(url, "DELETE")).json()).toEqual({
    object: "broadcast",
    id: created.id,
    deleted: true,
  })
  expect((await request(url)).status).toBe(404)
})
test("REST rejects malformed inputs and returns validation errors", async () => {
  const f = await setup()
  const request = await rest(f)
  for (const body of [
    {},
    { ...content, segment_id: "missing" },
    { ...content, reply_to: 2 },
    { ...content, send: "yes" },
    { ...content, send: true, scheduled_at: "not a date" },
  ]) {
    const response = await request("/broadcasts", "POST", body)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      name: expect.stringMatching(/validation_error|missing_required_field/),
    })
  }
})
test("export source uses paginated real rows and the same status/search filters", async () => {
  const f = await setup()
  const id = await f.create()
  const result = await f.t.run((ctx) =>
    EXPORT_SOURCES.broadcasts.page(
      ctx,
      f.org,
      { search: "Launch", status: "draft" },
      page,
      []
    )
  )
  expect(EXPORT_SOURCES.broadcasts.columns).toContain("segment_id")
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0][0]).toBe(id)
})
test("the scheduled durable workflow releases, fans out and completes through the send pool", async () => {
  const f = await setup()
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockImplementation(
      async () => ({ MessageId: crypto.randomUUID() }) as never
    )
  await f.contacts(
    Array.from({ length: 12 }, (_, i) => ({
      email: `workflow${i}@example.com`,
    }))
  )
  const id = await f.create()
  await f.owner.client.mutation(api.broadcasts.send, {
    id,
    scheduledAt: Date.now() + 1000,
  })
  for (let i = 0; i < 80 && (await f.read(id))?.status !== "sent"; i++) {
    vi.advanceTimersByTime(100)
    await f.t.finishInProgressScheduledFunctions()
  }
  expect((await f.read(id))?.status).toBe("sent")
  expect(send).toHaveBeenCalledTimes(12)
  expect(await f.recipients(id)).toHaveLength(12)
})
test("a test email uses the current draft and leaves audience and broadcast status alone", async () => {
  const f = await setup()
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockResolvedValue({ MessageId: "test" } as never)
  const id = await f.create()
  const emailId = await f.owner.client.mutation(api.testEmails.send, {
    organizationId: f.org,
    from: content.from,
    to: "test@example.com",
    subject: "[Test] Current",
    html: "<p>Current draft</p>",
  })
  await f.t.action(internal.emailSend.deliver, { id: emailId, generation: 0 })
  expect(send).toHaveBeenCalledTimes(1)
  expect((await f.read(id))?.status).toBe("draft")
  expect(await f.recipients(id)).toEqual([])
})
test("an opt-out during the SES queue prevents delivery and is counted once", async () => {
  const f = await setup()
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockResolvedValue({ MessageId: "never" } as never)
  const topicId = await f.topic()
  const [contactId] = await f.contacts([{ email: "person@example.com" }])
  const id = await f.create({ topicId })
  const [recipient] = await f.fanout(id)
  await f.owner.client.mutation(api.contacts.setTopic, {
    id: contactId,
    topicId,
    subscription: "unsubscribed",
  })
  await f.t.action(internal.emailSend.deliver, {
    id: recipient.emailId,
    generation: 0,
  })
  await f.t.action(internal.emailSend.deliver, {
    id: recipient.emailId,
    generation: 0,
  })
  expect(send).not.toHaveBeenCalled()
  expect((await f.stats(id)).suppressed).toBe(1)
  expect((await f.read(id))?.status).toBe("sent")
})
test("large excluded audiences rotate workflow history and still finish", async () => {
  const f = await setup()
  const send = vi
    .spyOn(SESv2Client.prototype, "send")
    .mockResolvedValue({ MessageId: "never" } as never)
  for (let batch = 0; batch < 11; batch++)
    await f.contacts(
      Array.from({ length: 100 }, (_, i) => ({
        email: `excluded${batch * 100 + i}@example.com`,
        unsubscribed: true,
      }))
    )
  const id = await f.create()
  await f.owner.client.mutation(api.broadcasts.send, { id })
  let firstWorkflow: string | undefined
  for (let i = 0; i < 800 && (await f.read(id))?.status !== "sent"; i++) {
    vi.advanceTimersByTime(100)
    await f.t.finishInProgressScheduledFunctions()
    firstWorkflow ??= (await f.read(id))?.workflowId
  }
  expect((await f.read(id))?.status).toBe("sent")
  expect((await f.read(id))?.workflowId).not.toBe(firstWorkflow)
  expect(send).not.toHaveBeenCalled()
}, 30_000)
test("search, audience/status filters, history and event counts match their pages", async () => {
  const f = await setup()
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.org,
    name: "Customers",
  })
  const first = await f.create({ name: "Find me", segmentId })
  await f.create({ name: "Other" })
  await f.create({ name: "Also", segmentId })
  for (const filters of [
    { status: "draft" as const, audience: segmentId },
    { audience: "everyone" },
    { search: "Find" },
  ]) {
    const result = await f.owner.client.query(api.broadcasts.list, {
      organizationId: f.org,
      paginationOpts: page,
      ...filters,
    })
    const count = await f.owner.client.query(api.broadcasts.count, {
      organizationId: f.org,
      ...filters,
    })
    expect(result.page.length).toBe(filters.audience === segmentId ? 2 : 1)
    if (!filters.search) expect(count.total).toBe(result.page.length)
    else expect(result.page[0]._id).toBe(first)
  }
  await f.contacts([{ email: "history@example.com" }], [segmentId])
  const [recipient] = await f.fanout(first)
  await f.t.run((ctx) => insertEmailEvent(ctx, recipient.emailId, "bounced"))
  expect(
    await f.owner.client.query(api.broadcasts.historyCount, {
      organizationId: f.org,
      email: "history@example.com",
    })
  ).toEqual({ total: 1 })
  expect(
    await f.owner.client.query(api.broadcasts.eventCount, {
      id: first,
      type: "bounced",
    })
  ).toEqual({ total: 1 })
})
test("REST full-access permission and POST idempotency protect broadcast writes", async () => {
  const f = await setup()
  const makeKey = (permission: "full_access" | "sending_access") =>
    f.owner.client.action(api.apiKeys.create, {
      organizationId: f.org,
      input: { name: permission, permission, domainId: null },
    })
  const { token } = await makeKey("sending_access")
  expect(
    (
      await f.t.fetch("/broadcasts", {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status
  ).toBe(401)
  const full = await makeKey("full_access")
  const post = (name: string) =>
    f.t.fetch("/broadcasts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${full.token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "broadcast-once",
      },
      body: JSON.stringify({ ...content, name }),
    })
  const first = await (await post("one")).json()
  expect(await (await post("one")).json()).toEqual(first)
  expect((await post("different")).status).toBe(409)
  expect(
    (
      await f.owner.client.query(api.broadcasts.count, {
        organizationId: f.org,
      })
    ).total
  ).toBe(1)
})

test("segment pages preserve contact cutoff and skip missing or foreign contacts", async () => {
  const f = await setup()
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.org,
    name: "Members",
  })
  const [older] = await f.contacts([{ email: "older@example.com" }])
  const [deleted] = await f.contacts(
    [{ email: "deleted@example.com" }],
    [segmentId]
  )
  const before = await f.t.run(
    async (ctx) => (await ctx.db.get("contacts", deleted))!._creationTime
  )
  vi.setSystemTime(Date.now() + 1000)
  // The contact cutoff must not be applied to the membership's creation time.
  await f.contacts([{ email: "older@example.com" }], [segmentId])
  await f.contacts([{ email: "newer@example.com" }], [segmentId])
  await f.t.run(async (ctx) => {
    await ctx.db.delete("contacts", deleted)
    const foreign = await insertRow(ctx, "contacts", {
      organizationId: f.outsider.team,
      email: "foreign@example.com",
      firstName: "",
      lastName: "",
      unsubscribed: false,
      properties: {},
      search: "foreign",
      updatedAt: Date.now(),
    })
    await insertRow(ctx, "segmentMembers", {
      organizationId: f.org,
      segmentId,
      contactId: foreign,
    })
  })
  let cursor: string | null = null
  const found: Id<"contacts">[] = []
  for (;;) {
    const result = await f.t.run((ctx) =>
      recipientPage(
        ctx,
        { organizationId: f.org, segmentId, topicId: null },
        cursor,
        before,
        1
      )
    )
    found.push(...result.page.map((contact) => contact._id))
    if (result.isDone) break
    cursor = result.continueCursor
  }
  expect(found).toEqual([older])
})

test("segment review and sending span membership pages", async () => {
  const f = await setup()
  const segmentId = await f.owner.client.mutation(api.segments.create, {
    organizationId: f.org,
    name: "Paged members",
  })
  for (let batch = 0; batch < 2; batch++)
    await f.contacts(
      Array.from({ length: 55 }, (_, i) => ({
        email: `member${batch * 55 + i}@example.com`,
      })),
      [segmentId]
    )
  await f.contacts([{ email: "outside@example.com" }])
  expect(
    await f.owner.client.action(api.broadcasts.review, {
      organizationId: f.org,
      segmentId,
      topicId: null,
    })
  ).toBe(110)
  expect(await f.fanout(await f.create({ segmentId }))).toHaveLength(110)
})
