import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { renderTemplate } from "./templates"
import { insertRow } from "./counts"
import { MEMBERSHIP_BATCH, SEGMENT_INPUT_LIMIT } from "./audience"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
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
  const key = (
    client: typeof f.owner.client,
    organizationId: string,
    permission: "full_access" | "sending_access" = "full_access"
  ) =>
    client.action(api.apiKeys.create, {
      organizationId,
      input: { name: "Test", permission, domainId: null },
    })
  const { token } = await key(member.client, f.owner.team)
  const sending = await key(f.owner.client, f.owner.team, "sending_access")
  const foreign = await key(f.outsider.client, f.outsider.team)
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    bearer: string | null = token,
    headers: Record<string, string> = {}
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  const ok = async (path: string, method = "GET", body?: unknown) => {
    const response = await call(path, method, body)
    const result = await response.json()
    expect(response.status, JSON.stringify(result)).toBe(
      method === "POST" && resources.some((resource) => resource.path === path)
        ? 201
        : 200
    )
    return result
  }
  return {
    ...f,
    member,
    token,
    sending: sending.token,
    foreign: foreign.token,
    call,
    ok,
  }
}
const resources = [
  {
    path: "/contacts",
    body: { email: "ada@example.com" },
    patch: { first_name: "Ada" },
    object: "contact",
  },
  {
    path: "/segments",
    body: { name: "Customers" },
    patch: { name: "Members" },
    object: "segment",
  },
  {
    path: "/topics",
    body: { name: "Updates", default_subscription: "opt_in" },
    patch: { description: "News" },
    object: "topic",
  },
  {
    path: "/contact-properties",
    body: { key: "score", type: "number", fallback_value: 3 },
    patch: { fallback_value: 7 },
    object: "contact_property",
  },
  {
    path: "/templates",
    body: { name: "Welcome", html: "<p>Hello</p>" },
    patch: { subject: "Welcome aboard" },
    object: "template",
  },
]

describe("audience and template REST resources", () => {
  for (const resource of resources) {
    test(`${resource.path}: every CRUD route authenticates, rejects sending keys and isolates teams`, async () => {
      const f = await setup()
      const { id } = await f.ok(resource.path, "POST", resource.body)
      for (const [path, method, body] of [
        [resource.path, "GET", undefined],
        [resource.path, "POST", resource.body],
        [`${resource.path}/${id}`, "GET", undefined],
        [`${resource.path}/${id}`, "PATCH", resource.patch],
        [`${resource.path}/${id}`, "DELETE", undefined],
      ] as const) {
        expect((await f.call(path, method, body, null)).status).toBe(401)
        expect((await f.call(path, method, body, f.sending)).status).toBe(401)
        if (path.endsWith(id))
          expect((await f.call(path, method, body, f.foreign)).status).toBe(404)
      }
      expect(
        (await f.call(resource.path, "GET", undefined, f.foreign)).status
      ).toBe(200)
      expect(
        (
          await (
            await f.call(resource.path, "GET", undefined, f.foreign)
          ).json()
        ).data
      ).toEqual([])
      expect(await f.ok(`${resource.path}/${id}`)).toMatchObject({
        id,
        object: resource.object,
      })
      expect(
        await f.ok(`${resource.path}/${id}`, "PATCH", resource.patch)
      ).toEqual({ object: resource.object, id })
      expect(await f.ok(`${resource.path}/${id}`, "DELETE")).toMatchObject({
        deleted: true,
      })
      expect((await f.call(`${resource.path}/${id}`)).status).toBe(404)
    })
    test(`${resource.path}: validation, bidirectional pagination, foreign cursors, POST idempotency`, async () => {
      const f = await setup()
      expect((await f.call(resource.path, "POST", [])).status).toBe(422)
      expect((await f.call(resource.path, "POST", {})).status).toBe(422)
      for (const query of [
        "limit=0",
        "limit=101",
        "after=x&before=y",
        "after=missing",
      ])
        expect((await f.call(`${resource.path}?${query}`)).status).toBe(422)
      const response = await f.call(
        resource.path,
        "POST",
        resource.body,
        f.token,
        { "Idempotency-Key": "new-resource" }
      )
      const first = await response.json()
      expect(response.status, JSON.stringify(first)).toBe(201)
      expect(
        await (
          await f.call(resource.path, "POST", resource.body, f.token, {
            "Idempotency-Key": "new-resource",
          })
        ).json()
      ).toEqual(first)
      const body = {
        ...resource.body,
        ...(resource.path === "/contacts"
          ? { email: "grace@example.com" }
          : resource.path === "/contact-properties"
            ? { key: "second" }
            : { name: "Second" }),
      }
      const second = await f.ok(resource.path, "POST", body)
      const page = await f.ok(`${resource.path}?limit=1`)
      expect(page).toMatchObject({
        object: "list",
        has_more: true,
        data: [{ id: second.id }],
      })
      const next = await f.ok(`${resource.path}?limit=1&after=${second.id}`)
      expect(next).toMatchObject({ has_more: false, data: [{ id: first.id }] })
      expect(
        await f.ok(`${resource.path}?limit=1&before=${first.id}`)
      ).toMatchObject({ data: [{ id: second.id }] })
      expect(
        (
          await f.call(
            `${resource.path}?after=${first.id}`,
            "GET",
            undefined,
            f.foreign
          )
        ).status
      ).toBe(422)
    })
  }

  test("missing contact names read as null, as in Resend's API and webhooks", async () => {
    const f = await setup()
    const { id } = await f.ok("/contacts", "POST", {
      email: "nameless@example.com",
    })
    const contact = await f.ok(`/contacts/${id}`)
    expect(contact).toMatchObject({ first_name: null, last_name: null })
    const list = await f.ok("/contacts")
    expect(list.data[0]).toMatchObject({ first_name: null, last_name: null })
  })
  test("contact properties, email lookup, atomic relations, topic defaults and contact webhooks", async () => {
    const f = await setup()
    await f.ok("/contact-properties", "POST", {
      key: "score",
      type: "number",
      fallback_value: 0,
    })
    const segment = await f.ok("/segments", "POST", { name: "Members" })
    const topic = await f.ok("/topics", "POST", {
      name: "News",
      default_subscription: "opt_out",
    })
    const { id } = await f.ok("/contacts", "POST", {
      email: "Ada@example.com",
      properties: { score: 42 },
      segments: [{ id: segment.id }],
      topics: [{ id: topic.id, subscription: "opt_in" }],
    })
    expect(await f.ok("/contacts/ada%40example.com")).toMatchObject({
      id,
      properties: { score: { type: "number", value: 42 } },
    })
    expect(await f.ok(`/contacts/${id}/segments`)).toMatchObject({
      data: [{ id: segment.id }],
    })
    expect(await f.ok(`/segments/${segment.id}/contacts`)).toMatchObject({
      data: [{ id }],
    })
    expect(await f.ok(`/contacts?segment_id=${segment.id}`)).toMatchObject({
      data: [{ id }],
    })
    expect(await f.ok(`/contacts/${id}/topics`)).toMatchObject({
      data: [{ id: topic.id, subscription: "opt_in" }],
    })
    await f.ok(`/contacts/${id}/topics`, "PATCH", {
      topics: [{ id: topic.id, subscription: "opt_out" }],
    })
    await f.ok(`/contacts/${id}`, "PATCH", { properties: { score: null } })
    expect(await f.ok(`/contacts/${id}`)).toMatchObject({
      properties: { score: { value: 0 } },
    })
    expect(
      (
        await f.call(`/contacts/${id}`, "PATCH", {
          properties: { score: "bad" },
        })
      ).status
    ).toBe(422)
    expect(
      (
        await f.call("/contacts", "POST", {
          email: "rollback@example.com",
          segments: [{ id: "missing" }],
        })
      ).status
    ).toBe(404)
    expect((await f.call("/contacts/rollback@example.com")).status).toBe(404)
    await f.ok(`/contacts/${id}`, "DELETE")
    const events = await f.t.run((ctx) => ctx.db.query("events").collect())
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "contact.created",
        "contact.updated",
        "contact.deleted",
      ])
    )
  })

  test("all relation routes authenticate, enforce scope and validate bodies and pagination", async () => {
    const f = await setup()
    const contact = await f.ok("/contacts", "POST", {
      email: "one@example.com",
    })
    const segment = await f.ok("/segments", "POST", { name: "One" })
    const topic = await f.ok("/topics", "POST", {
      name: "One",
      default_subscription: "opt_in",
    })
    const routes = [
      [`/contacts/${contact.id}/segments`, "GET", undefined],
      [`/contacts/${contact.id}/topics`, "GET", undefined],
      [`/segments/${segment.id}/contacts`, "GET", undefined],
      [`/contacts/${contact.id}/segments/${segment.id}`, "POST", undefined],
      [`/contacts/${contact.id}/segments/${segment.id}`, "DELETE", undefined],
      [
        `/contacts/${contact.id}/topics`,
        "PATCH",
        { topics: [{ id: topic.id, subscription: "opt_out" }] },
      ],
    ] as const
    for (const [path, method, body] of routes) {
      expect((await f.call(path, method, body, null)).status).toBe(401)
      expect((await f.call(path, method, body, f.sending)).status).toBe(401)
      expect((await f.call(path, method, body, f.foreign)).status).toBe(404)
      if (method === "GET")
        expect((await f.call(`${path}?limit=101`)).status).toBe(422)
      await f.ok(path, method, body)
    }
    const path = `/contacts/${contact.id}/segments/${segment.id}`
    const first = await f.call(path, "POST", undefined, f.token, {
      "Idempotency-Key": "membership",
    })
    expect(
      await (
        await f.call(path, "POST", undefined, f.token, {
          "Idempotency-Key": "membership",
        })
      ).json()
    ).toEqual(await first.json())
    expect(
      (
        await f.call(`/contacts/${contact.id}/topics`, "PATCH", {
          topics: [{ id: topic.id, subscription: "bad" }],
        })
      ).status
    ).toBe(422)
    expect(
      (await f.call(`/contacts/${contact.id}/segments/missing`, "POST")).status
    ).toBe(404)
    const otherContact = await f.ok("/contacts", "POST", {
      email: "two@example.com",
    })
    await f.ok(`/contacts/${otherContact.id}/segments/${segment.id}`, "POST")
    expect(
      await f.ok(`/segments/${segment.id}/contacts?limit=1`)
    ).toMatchObject({ has_more: true, data: [{ id: otherContact.id }] })
    expect(
      await f.ok(
        `/segments/${segment.id}/contacts?limit=1&after=${otherContact.id}`
      )
    ).toMatchObject({ has_more: false, data: [{ id: contact.id }] })
    const otherSegment = await f.ok("/segments", "POST", { name: "Two" })
    await f.ok(`/contacts/${contact.id}/segments/${otherSegment.id}`, "POST")
    expect(
      await f.ok(
        `/contacts/${contact.id}/segments?limit=1&after=${otherSegment.id}`
      )
    ).toMatchObject({ data: [{ id: segment.id }] })
    const otherTopic = await f.ok("/topics", "POST", {
      name: "Two",
      default_subscription: "opt_in",
    })
    expect(
      await f.ok(
        `/contacts/${contact.id}/topics?limit=1&after=${otherTopic.id}`
      )
    ).toMatchObject({ data: [{ id: topic.id }] })
  })

  test("contact segments page by membership, newest joined first, past one transaction's share", async () => {
    const f = await setup()
    const segments = await f.t.run(async (ctx) => {
      const ids: Id<"segments">[] = []
      for (let i = 0; i < MEMBERSHIP_BATCH + 50; i++)
        ids.push(
          await insertRow(ctx, "segments", {
            organizationId: f.owner.team,
            name: `Segment ${i}`,
          })
        )
      return ids
    })
    const { id } = await f.ok("/contacts", "POST", {
      email: "paged@example.com",
      segments: segments.map((segment) => ({ id: segment })),
    })
    // Memberships past the first transaction's share join in scheduled steps.
    await f.t.finishAllScheduledFunctions(vi.runAllTimers)
    const seen: { id: string; created_at: string }[] = []
    let after: string | undefined
    for (;;) {
      const page = await f.ok(
        `/contacts/${id}/segments?limit=100${after ? `&after=${after}` : ""}`
      )
      seen.push(...page.data)
      if (!page.has_more) break
      after = page.data.at(-1).id
    }
    expect(new Set(seen.map((row) => row.id)).size).toBe(segments.length)
    const joined = seen.map((row) => Date.parse(row.created_at))
    expect([...joined].sort((a, b) => b - a)).toEqual(joined)
    expect(
      (
        await f.ok(`/contacts/${id}/segments?limit=100&before=${seen[100].id}`)
      ).data.map((row: { id: string }) => row.id)
    ).toEqual(seen.slice(0, 100).map((row) => row.id))
    expect(
      (
        await f.call("/contacts", "POST", {
          email: "limit@example.com",
          segments: Array.from({ length: SEGMENT_INPUT_LIMIT + 1 }, () => ({
            id: segments[0],
          })),
        })
      ).status
    ).toBe(422)
  })

  test("publish and duplicate use draft snapshots, aliases, typed fallbacks and permission checks", async () => {
    const f = await setup()
    const { id } = await f.ok("/templates", "POST", {
      name: "Order",
      alias: "receipt",
      html: "<p>{{{PRICE}}} {{{NAME}}}</p>",
      text: "Total {{{PRICE}}}",
      subject: "Order",
      variables: [
        { key: "PRICE", type: "number", fallback_value: 0 },
        { key: "NAME", type: "string", fallback_value: "Friend" },
      ],
    })
    for (const operation of ["publish", "duplicate"]) {
      const path = `/templates/${id}/${operation}`
      expect((await f.call(path, "POST", undefined, null)).status).toBe(401)
      expect((await f.call(path, "POST", undefined, f.sending)).status).toBe(
        401
      )
      expect((await f.call(path, "POST", undefined, f.foreign)).status).toBe(
        404
      )
      expect(
        (await f.call(`/templates/missing/${operation}`, "POST")).status
      ).toBe(404)
      const first = await f.call(path, "POST", undefined, f.token, {
        "Idempotency-Key": operation,
      })
      expect(first.status).toBe(200)
      expect(
        await (
          await f.call(path, "POST", undefined, f.token, {
            "Idempotency-Key": operation,
          })
        ).json()
      ).toEqual(await first.json())
    }
    const live = await f.t.query(internal.templates.published, {
      organizationId: f.owner.team,
      idOrAlias: "receipt",
    })
    expect(renderTemplate(live!, {})).toMatchObject({
      html: "<p>0 Friend</p>",
      text: "Total 0",
    })
    expect(() => renderTemplate(live!, { PRICE: "4" })).toThrow("type")
    expect(renderTemplate(live!, { PRICE: 4, NAME: "<Ada>" }).html).toBe(
      "<p>4 &lt;Ada&gt;</p>"
    )
    await f.member.client.mutation(api.templates.update, {
      id,
      content: { type: "doc", content: [] },
    })
    await f.ok("/templates/receipt", "PATCH", {
      html: "<p>New</p>",
      variables: [{ key: "PRICE", type: "number", fallback_value: 7 }],
    })
    expect(
      (
        await f.member.client.query(api.templates.get, {
          organizationId: f.owner.team,
          id,
        })
      )?.content
    ).toBeUndefined()
    expect(await f.ok(`/templates/${id}`)).toMatchObject({
      html: "<p>New</p>",
      has_unpublished_versions: true,
    })
    expect(
      (
        await f.t.query(internal.templates.published, {
          organizationId: f.owner.team,
          idOrAlias: id,
        })
      )?.html
    ).toBe(live!.html)
    const duplicate = await f.ok("/templates/receipt/duplicate", "POST")
    expect(await f.ok(`/templates/${duplicate.id}`)).toMatchObject({
      status: "draft",
      html: "<p>New</p>",
    })
    for (const key of [
      "FIRST_NAME",
      "LAST_NAME",
      "EMAIL",
      "RESEND_UNSUBSCRIBE_URL",
      "contact",
      "this",
    ])
      expect(
        (
          await f.call("/templates", "POST", {
            name: "Bad",
            html: "<p>x</p>",
            variables: [{ key, type: "string" }],
          })
        ).status
      ).toBe(422)
    expect(
      (
        await f.call("/templates/receipt", "PATCH", {
          variables: [{ key: "PRICE", type: "number", fallback_value: "bad" }],
        })
      ).status
    ).toBe(422)
    expect(
      (
        await f.call("/templates", "POST", {
          name: "Duplicate alias",
          alias: "receipt",
          html: "<p>x</p>",
        })
      ).status
    ).toBe(422)
  })

  test("test sends accept plain members, render the current draft, reach mocked SES and respect suppressions", async () => {
    const f = await setup()
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
    const send = vi
      .spyOn(SESv2Client.prototype, "send")
      .mockResolvedValue({ MessageId: "test-message" } as never)
    const draft = await f.ok("/templates", "POST", {
      name: "Draft",
      html: "<p>old</p>",
      variables: [{ key: "NAME", type: "string", fallback_value: "Ada" }],
    })
    const input = {
      organizationId: f.owner.team,
      templateId: draft.id as Id<"templates">,
      from: "hi@mail.example.test",
      to: "ada@example.com",
      subject: "[Test] {{{NAME}}}",
      html: "<p>Current {{{NAME}}}</p>",
    }
    await expect(
      f.outsider.client.mutation(api.testEmails.send, input)
    ).rejects.toThrow("permission")
    await expect(
      f.member.client.mutation(api.testEmails.send, {
        ...input,
        organizationId: f.outsider.team,
      })
    ).rejects.toThrow("permission")
    await expect(
      f.member.client.mutation(api.testEmails.send, { ...input, to: "invalid" })
    ).rejects.toThrow()
    await expect(
      f.member.client.mutation(api.testEmails.send, {
        ...input,
        html: "x".repeat(262145),
      })
    ).rejects.toThrow("256 KB")
    const id = await f.member.client.mutation(api.testEmails.send, input)
    await f.t.action(internal.emailSend.deliver, { id, generation: 0 })
    expect(send).toHaveBeenCalled()
    const command = send.mock.calls.find(
      ([command]) => command.constructor.name === "SendEmailCommand"
    )![0]
    expect(command.input).toMatchObject({
      TenantName: expect.any(String),
      ConfigurationSetName: "opensend-team-cfg",
      Content: {
        Simple: {
          Subject: { Data: "[Test] Ada" },
          Body: { Html: { Data: "<p>Current Ada</p>" } },
        },
      },
    })
    expect(command.input).toHaveProperty("ReplyToAddresses", [])
    await f.t.mutation(internal.suppressions.record, {
      organizationId: f.owner.team,
      email: input.to,
      reason: "bounced",
    })
    const suppressed = await f.member.client.mutation(api.testEmails.send, {
      ...input,
      templateId: undefined,
      html: "<p>Broadcast {{{contact.first_name|friend}}}</p>",
    })
    const before = send.mock.calls.length
    await f.t.action(internal.emailSend.deliver, {
      id: suppressed,
      generation: 0,
    })
    expect(
      await f.t.run((ctx) => ctx.db.get("emails", suppressed))
    ).toMatchObject({ status: "suppressed", source: "dashboard" })
    expect(send.mock.calls).toHaveLength(before)
  })
  test("foreign related ids cannot be attached and topic changes roll back together", async () => {
    const f = await setup()
    const contact = await f.ok("/contacts", "POST", {
      email: "owner@example.com",
    })
    const topic = await f.ok("/topics", "POST", {
      name: "Owner",
      default_subscription: "opt_out",
    })
    const foreignSegment = await f.outsider.client.mutation(
      api.segments.create,
      { organizationId: f.outsider.team, name: "Foreign" }
    )
    const foreignTopic = await f.outsider.client.mutation(api.topics.create, {
      organizationId: f.outsider.team,
      name: "Foreign",
      description: "",
      defaultSubscription: "opt_out",
      visibility: "private",
    })
    expect(
      (
        await f.call(
          `/contacts/${contact.id}/segments/${foreignSegment}`,
          "POST"
        )
      ).status
    ).toBe(404)
    expect(
      (
        await f.call(`/contacts/${contact.id}/topics`, "PATCH", {
          topics: [
            { id: topic.id, subscription: "opt_in" },
            { id: foreignTopic, subscription: "opt_in" },
          ],
        })
      ).status
    ).toBe(404)
    expect(await f.ok(`/contacts/${contact.id}/topics`)).toMatchObject({
      data: [{ id: topic.id, subscription: "opt_out" }],
    })
    expect(
      (
        await f.call(`/contacts/${contact.id}`, "PATCH", {
          properties: { $invalid: "value" },
        })
      ).status
    ).toBe(422)
    const eventsBefore = await f.t.run((ctx) =>
      ctx.db.query("events").collect()
    )
    await f.member.client.mutation(api.contacts.setTopic, {
      id: contact.id,
      topicId: topic.id,
      subscription: "subscribed",
    })
    await f.member.client.mutation(api.contacts.setTopic, {
      id: contact.id,
      topicId: topic.id,
      subscription: "subscribed",
    })
    const eventsAfter = await f.t.run((ctx) => ctx.db.query("events").collect())
    expect(eventsAfter.length).toBe(eventsBefore.length + 1)
    expect(eventsAfter.at(-1)?.type).toBe("contact.updated")
  })

  test("template sends retain numeric types, text and reply-to lists through publication", async () => {
    const f = await setup()
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
    const { id } = await f.ok("/templates", "POST", {
      name: "Typed",
      from: "hi@mail.example.test",
      subject: "Total {{{TOTAL}}}",
      html: "<p>{{{TOTAL}}}</p>",
      text: "",
      reply_to: ["one@example.com", "two@example.com"],
      variables: [{ key: "TOTAL", type: "number" }],
    })
    await f.ok(`/templates/${id}/publish`, "POST")
    for (const variables of [{}, { TOTAL: "3" }])
      expect(
        (
          await f.call("/emails", "POST", {
            to: "ada@example.com",
            template: { id, variables },
          })
        ).status
      ).toBe(422)
    const email = await f.ok("/emails", "POST", {
      to: "ada@example.com",
      template: { id, variables: { TOTAL: 0 } },
    })
    expect(await f.ok(`/emails/${email.id}`)).toMatchObject({
      subject: "Total 0",
      html: "<p>0</p>",
      text: "",
      reply_to: ["one@example.com", "two@example.com"],
    })
    const input = {
      organizationId: f.owner.team,
      templateId: id,
      from: "hi@mail.example.test",
      to: "ada@example.com",
      subject: "Test",
      html: "<p>{{{TOTAL}}}</p>",
    }
    await expect(
      f.member.client.mutation(api.testEmails.send, input)
    ).rejects.toThrow("Missing template variables")
    const foreign = await f.outsider.client.mutation(api.templates.create, {
      organizationId: f.outsider.team,
      name: "Other",
      html: "<p>Other</p>",
    })
    await expect(
      f.member.client.mutation(api.testEmails.send, {
        ...input,
        templateId: foreign,
      })
    ).rejects.toThrow("permission")
    await f.ok(`/templates/${id}`, "PATCH", {
      variables: [{ key: "TOTAL", type: "number", fallback_value: 4 }],
    })
    expect(await f.ok(`/templates/${id}`)).toMatchObject({
      has_unpublished_versions: true,
    })
    expect(
      (
        await f.call("/emails", "POST", {
          to: "ada@example.com",
          template: { id },
        })
      ).status
    ).toBe(422)
    await f.ok(`/templates/${id}/publish`, "POST")
    const next = await f.ok("/emails", "POST", {
      to: "ada@example.com",
      template: { id },
    })
    expect(await f.ok(`/emails/${next.id}`)).toMatchObject({
      subject: "Total 4",
    })
  })
  test("Resend topic defaults translate to the dashboard consent model", async () => {
    const f = await setup()
    const contact = await f.ok("/contacts", "POST", {
      email: "default@example.com",
    })
    for (const subscription of ["opt_in", "opt_out"] as const) {
      const topic = await f.ok("/topics", "POST", {
        name: subscription,
        default_subscription: subscription,
      })
      expect(await f.ok(`/topics/${topic.id}`)).toMatchObject({
        default_subscription: subscription,
      })
      const stored = await f.t.run((ctx) => ctx.db.get("topics", topic.id))
      expect(stored?.defaultSubscription).toBe(
        subscription === "opt_in" ? "opt_out" : "opt_in"
      )
      const result = await f.ok(`/contacts/${contact.id}/topics`)
      expect(result.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: topic.id, subscription }),
        ])
      )
    }
  })

  test("template variables treat prototype names as data, never inherited values", () => {
    const snapshot = {
      subject: "Hello",
      html: "<p>{{{constructor}}} {{{__proto__}}}</p>",
      variables: [
        { key: "constructor", type: "string" as const },
        { key: "__proto__", type: "string" as const },
      ],
    }
    expect(() => renderTemplate(snapshot, {})).toThrow(
      "Missing template variables"
    )
    expect(
      renderTemplate(
        snapshot,
        Object.fromEntries([
          ["constructor", "Ada"],
          ["__proto__", "<safe>"],
        ])
      ).html
    ).toBe("<p>Ada &lt;safe&gt;</p>")
  })
})
