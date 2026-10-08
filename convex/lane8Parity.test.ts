import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { insertRow, patchRow } from "./counts"
import { insertEmailEvent } from "./emailRows"
import { recordBroadcastReport } from "./broadcastMetrics"
import { publicFetch } from "../lib/net/public-fetch"

vi.mock("../lib/net/public-fetch", () => ({ publicFetch: vi.fn() }))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-for-file-downloads")
  vi.mocked(publicFetch).mockRejectedValue(
    new Error("Unexpected network request")
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const email = {
  from: "hi@mail.example.test",
  to: "one@example.com",
  subject: "Parity",
  html: "<p>Hello</p>",
}
async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await storeTestCredentials(f)
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "test",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 100 },
    })
  })
  const member = await f.actor("parity-member")
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
  const key = async (
    client: typeof f.owner.client,
    organizationId: string,
    permission: "full_access" | "sending_access"
  ) =>
    client.action(api.apiKeys.create, {
      organizationId,
      input: { name: "Parity", permission },
    })
  const full = await key(member.client, f.owner.team, "full_access")
  const sending = await key(member.client, f.owner.team, "sending_access")
  const foreign = await key(f.outsider.client, f.outsider.team, "full_access")
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    token = full.token,
    headers: Record<string, string> = {}
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  const json = async (
    path: string,
    method = "GET",
    body?: unknown,
    status = 200
  ) => {
    const r = await call(path, method, body)
    const value = await r.json()
    expect(r.status, JSON.stringify(value)).toBe(status)
    return value
  }
  return { ...f, full, sending, foreign, call, json }
}
async function error(response: Response, status: number, name: string) {
  expect(response.status).toBe(status)
  expect(await response.json()).toMatchObject({ statusCode: status, name })
}

test("API-key PATCH uses shared member update logic, validates names, and isolates teams", async () => {
  const f = await setup()
  const key = await f.json("/api-keys", "POST", { name: "Created" }, 201)
  expect(Object.keys(key).sort()).toEqual(["id", "token"])
  expect(
    await f.json(`/api-keys/${key.id}`, "PATCH", { name: "Renamed" })
  ).toEqual({ object: "api_key", id: key.id })
  expect(
    (await f.json("/api-keys")).data.find(
      (k: { id: string }) => k.id === key.id
    ).name
  ).toBe("Renamed")
  await error(
    await f.call(`/api-keys/${key.id}`, "PATCH", {}, f.full.token),
    422,
    "missing_required_field"
  )
  await error(
    await f.call(`/api-keys/${key.id}`, "PATCH", { name: " " }),
    422,
    "validation_error"
  )
  await error(
    await f.call(
      `/api-keys/${key.id}`,
      "PATCH",
      { name: "No" },
      f.foreign.token
    ),
    404,
    "not_found"
  )
  await error(
    await f.call(
      `/api-keys/${key.id}`,
      "PATCH",
      { name: "No" },
      f.sending.token
    ),
    403,
    "restricted_api_key"
  )
})

test("deprecated audiences share segment rows, preserve legacy nouns and replay the exact POST", async () => {
  const f = await setup()
  const first = await f.call(
    "/audiences",
    "POST",
    { name: "Legacy" },
    f.full.token,
    { "Idempotency-Key": "audience" }
  )
  expect(first.status).toBe(201)
  const body = await first.json()
  expect(body.object).toBe("audience")
  const replay = await f.call(
    "/audiences",
    "POST",
    { name: "Legacy" },
    f.full.token,
    { "Idempotency-Key": "audience" }
  )
  expect(replay.status).toBe(201)
  expect(await replay.json()).toEqual(body)
  expect(await f.json(`/segments/${body.id}`)).toMatchObject({
    object: "segment",
    name: "Legacy",
  })
  const second = await f.json("/audiences", "POST", { name: "Second" }, 201)
  const page = await f.json("/audiences?limit=1")
  expect(page).toMatchObject({ has_more: true, data: [{ id: second.id }] })
  expect(
    (await f.json(`/audiences?limit=1&after=${second.id}`)).data[0].id
  ).toBe(body.id)
  expect(
    (await f.json(`/audiences?limit=1&before=${body.id}`)).data[0].id
  ).toBe(second.id)
  const contact = await f.json(
    "/contacts",
    "POST",
    { email: "legacy@example.com", audience_id: body.id },
    201
  )
  expect((await f.json(`/contacts/${contact.id}/segments`)).data[0].id).toBe(
    body.id
  )
  for (const [path, method, payload] of [
    ["/audiences", "POST", { name: "No" }],
    ["/audiences", "GET", undefined],
    [`/audiences/${body.id}`, "GET", undefined],
    [`/audiences/${body.id}`, "DELETE", undefined],
  ] as const)
    await error(
      await f.call(path, method, payload, f.sending.token),
      403,
      "restricted_api_key"
    )
  for (const method of ["GET", "DELETE"])
    await error(
      await f.call(`/audiences/${body.id}`, method, undefined, f.foreign.token),
      404,
      "not_found"
    )
  await error(
    await f.call("/audiences", "POST", {}),
    422,
    "missing_required_field"
  )
  await error(await f.call("/audiences?limit=0"), 422, "validation_error")
  expect(await f.json(`/audiences/${body.id}`, "DELETE")).toEqual({
    object: "audience",
    id: body.id,
    deleted: true,
  })
})

test("permissive batch isolates item failures, strict rolls back, replay includes errors and mode", async () => {
  const f = await setup()
  const payload = [
    email,
    { ...email, to: "bad" },
    { ...email, from: 123 },
    { ...email, subject: "Second" },
  ]
  await error(
    await f.call("/emails/batch", "POST", payload),
    422,
    "validation_error"
  )
  expect(await f.t.run((ctx) => ctx.db.query("emails").collect())).toHaveLength(
    0
  )
  const headers = {
    "x-batch-validation": "permissive",
    "Idempotency-Key": "batch",
  }
  const first = await f.call(
    "/emails/batch",
    "POST",
    payload,
    f.sending.token,
    headers
  )
  expect(first.status).toBe(200)
  const result = await first.json()
  expect(result.data).toHaveLength(2)
  expect(result.errors).toEqual([
    { index: 1, message: expect.any(String) },
    { index: 2, message: expect.any(String) },
  ])
  expect(
    await (
      await f.call("/emails/batch", "POST", payload, f.sending.token, headers)
    ).json()
  ).toEqual(result)
  await error(
    await f.call("/emails/batch", "POST", payload, f.sending.token, {
      ...headers,
      "x-batch-validation": "strict",
    }),
    409,
    "invalid_idempotent_request"
  )
  expect(await f.t.run((ctx) => ctx.db.query("emails").collect())).toHaveLength(
    2
  )
  const empty = await f.call("/emails/batch", "POST", [{}], f.sending.token, {
    "x-batch-validation": "permissive",
  })
  expect(await empty.json()).toMatchObject({ data: [], errors: [{ index: 0 }] })
  await error(
    await f.call("/emails/batch", "POST", [email], f.full.token, {
      "x-batch-validation": "typo",
    }),
    422,
    "validation_error"
  )
})

test("topic sends honor every address, topic defaults and preference changes before delivery", async () => {
  const f = await setup()
  const topic = await f.json(
    "/topics",
    "POST",
    { name: "News", default_subscription: "opt_out" },
    201
  )
  const contact = await f.json(
    "/contacts",
    "POST",
    {
      email: "one@example.com",
      topics: [{ id: topic.id, subscription: "opt_in" }],
    },
    201
  )
  const sent = await f.json("/emails", "POST", {
    ...email,
    cc: "unknown@example.com",
    bcc: "another@example.com",
    topic_id: topic.id,
  })
  const claimed = await f.t.mutation(internal.emails.claim, {
    id: sent.id,
    generation: 0,
  })
  expect(claimed).toMatchObject({ to: ["one@example.com"], cc: [], bcc: [] })
  const next = await f.json("/emails", "POST", { ...email, topic_id: topic.id })
  await f.json(`/contacts/${contact.id}/topics`, "PATCH", {
    topics: [{ id: topic.id, subscription: "opt_out" }],
  })
  expect(
    await f.t.mutation(internal.emails.claim, { id: next.id, generation: 0 })
  ).toBeNull()
  expect(await f.t.run((ctx) => ctx.db.get("emails", next.id))).toMatchObject({
    status: "failed",
  })
  const defaultIn = await f.json(
    "/topics",
    "POST",
    { name: "Default in", default_subscription: "opt_in" },
    201
  )
  const unknown = await f.json("/emails", "POST", {
    ...email,
    to: "new@example.com",
    topic_id: defaultIn.id,
  })
  expect(
    await f.t.mutation(internal.emails.claim, { id: unknown.id, generation: 0 })
  ).toMatchObject({ to: ["new@example.com"] })
  await error(
    await f.call(
      "/emails",
      "POST",
      { ...email, topic_id: topic.id },
      f.foreign.token
    ),
    403,
    "validation_error"
  )
  const foreignTopic = await f.outsider.client.mutation(api.topics.create, {
    organizationId: f.outsider.team,
    name: "Other",
    description: "",
    visibility: "private",
    defaultSubscription: "opt_in",
  })
  await error(
    await f.call("/emails", "POST", { ...email, topic_id: foreignTopic }),
    404,
    "not_found"
  )
})

test("outbound attachments have stable cursors, signed downloads, expiration and team isolation", async () => {
  const f = await setup()
  const { id } = await f.json("/emails", "POST", {
    ...email,
    attachments: [
      { filename: "a.txt", content: btoa("first") },
      { filename: "b.txt", content: btoa("second"), content_id: "inline-b" },
    ],
  })
  const path = `/emails/${id}/attachments`
  const list = await f.json(path + "?limit=1")
  expect(list).toMatchObject({
    object: "list",
    has_more: true,
    data: [
      {
        filename: "a.txt",
        size: 5,
        content_disposition: "attachment",
        content_id: null,
      },
    ],
  })
  const a = list.data[0]
  const b = (await f.json(`${path}?after=${a.id}&limit=1`)).data[0]
  expect(b).toMatchObject({
    filename: "b.txt",
    content_disposition: "inline",
    content_id: "inline-b",
  })
  expect((await f.json(`${path}?before=${b.id}&limit=1`)).data[0].id).toBe(a.id)
  expect(await f.json(`${path}/${a.id}?limit=invalid`)).toMatchObject({
    object: "attachment",
    id: a.id,
  })
  const downloadPath = new URL(a.download_url).pathname
  expect(await (await f.t.fetch(downloadPath)).text()).toBe("first")
  for (const route of [path, `${path}/${a.id}`]) {
    await error(
      await f.call(route, "GET", undefined, f.foreign.token),
      404,
      "not_found"
    )
    await error(
      await f.call(route, "GET", undefined, f.sending.token),
      403,
      "restricted_api_key"
    )
  }
  await error(await f.call(`${path}/unknown`), 404, "not_found")
  await error(await f.call(`${path}?after=unknown`), 422, "validation_error")
  const wrong = await f.json("/emails", "POST", email)
  await error(
    await f.call(`/emails/${wrong.id}/attachments/${a.id}`),
    404,
    "not_found"
  )
  vi.setSystemTime(Date.now() + 3600001)
  expect((await f.t.fetch(downloadPath)).status).toBe(404)
  const fresh = await f.json(`${path}/${a.id}`)
  await f.t.run((ctx) =>
    patchRow(ctx, "emails", id, { expiresAt: Date.now() - 1 })
  )
  expect((await f.t.fetch(new URL(fresh.download_url).pathname)).status).toBe(
    404
  )
})

test("path attachments revalidate redirects, derive filenames and clean up after validation failures", async () => {
  const f = await setup()
  vi.mocked(publicFetch)
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.com/file.txt" },
      })
    )
    .mockResolvedValueOnce(new Response("downloaded"))
  const sent = await f.json("/emails", "POST", {
    ...email,
    attachments: [{ path: "https://files.example.com/file.txt" }],
  })
  expect(publicFetch).toHaveBeenNthCalledWith(
    2,
    "https://cdn.example.com/file.txt",
    expect.objectContaining({ maxBytes: expect.any(Number) })
  )
  expect(
    (await f.json(`/emails/${sent.id}/attachments`)).data[0]
  ).toMatchObject({ filename: "file.txt", size: 10 })
  vi.mocked(publicFetch).mockResolvedValueOnce(new Response("refused"))
  const before = await f.t.run((ctx) =>
    ctx.db.system.query("_storage").collect()
  )
  await error(
    await f.call("/emails", "POST", {
      ...email,
      to: "bad",
      attachments: [{ path: "https://files.example.com/file.txt" }],
    }),
    422,
    "validation_error"
  )
  expect(
    await f.t.run((ctx) => ctx.db.system.query("_storage").collect())
  ).toHaveLength(before.length)
})

test("broadcast recipients and clicked links preserve repeated counts, unique clicks and cursors", async () => {
  const f = await setup()
  const broadcast = await f.json(
    "/broadcasts",
    "POST",
    { ...email, name: "Report" },
    201
  )
  const a = await f.json("/emails", "POST", email)
  const b = await f.json("/emails", "POST", { ...email, to: "two@example.com" })
  const c = await f.json("/contacts", "POST", { email: "one@example.com" }, 201)
  await f.t.run(async (ctx) => {
    for (const [id, address] of [
      [a.id, "one@example.com"],
      [b.id, "two@example.com"],
    ] as const) {
      await patchRow(ctx, "emails", id, { broadcastId: broadcast.id })
      await insertRow(ctx, "broadcastRecipients", {
        organizationId: f.owner.team,
        broadcastId: broadcast.id,
        emailId: id,
        email: address,
        contactId: c.id,
        settled: false,
        failed: false,
      })
      await insertEmailEvent(ctx, id, "sent")
      await insertEmailEvent(ctx, id, "clicked", Date.now(), {
        details: { link: "https://example.com/a" },
      })
    }
    await insertEmailEvent(ctx, a.id, "clicked", Date.now(), {
      details: { link: "https://example.com/a" },
    })
    await insertEmailEvent(ctx, a.id, "clicked", Date.now(), {
      details: { link: "https://example.com/b" },
    })
    await insertEmailEvent(ctx, b.id, "bounced", Date.now(), {
      details: { bounceType: "Permanent" },
    })
    await insertEmailEvent(ctx, a.id, "opened")
    await insertEmailEvent(ctx, a.id, "opened")
    // A migration replay must not count an event twice.
    const events = await ctx.db
      .query("emailEvents")
      .withIndex("by_emailId_and_at", (q) => q.eq("emailId", a.id))
      .collect()
    for (const event of events)
      await recordBroadcastReport(
        ctx,
        (await ctx.db.get("emails", a.id))!,
        event
      )
  })
  const base = `/broadcasts/${broadcast.id}`
  expect((await f.json(base + "/recipients?type=sent")).data).toHaveLength(2)
  const clicked = await f.json(base + "/recipients?type=clicked&email=one")
  expect(clicked.data).toEqual([
    {
      id: expect.any(String),
      contact_id: c.id,
      email: "one@example.com",
      count: 3,
      clicked_links: expect.arrayContaining([
        { url: "https://example.com/a", clicks: 2 },
        { url: "https://example.com/b", clicks: 1 },
      ]),
    },
  ])
  expect((await f.json(base + "/recipients?type=opened")).data[0].count).toBe(2)
  expect(
    (await f.json(base + "/recipients?type=bounced&bounce_type=permanent"))
      .data[0]
  ).toMatchObject({
    email: "two@example.com",
    contact_id: null,
    bounce_type: "permanent",
  })
  const first = await f.json(base + "/clicked-links?limit=1")
  expect(first).toMatchObject({
    has_more: true,
    data: [{ url: "https://example.com/a", clicks: 3, unique_clicks: 2 }],
  })
  const second = await f.json(
    base + `/clicked-links?limit=1&after=${first.data[0].id}`
  )
  expect(second).toMatchObject({
    has_more: false,
    data: [{ url: "https://example.com/b", clicks: 1, unique_clicks: 1 }],
  })
  expect(
    (await f.json(base + `/clicked-links?before=${second.data[0].id}`)).data[0]
      .id
  ).toBe(first.data[0].id)
  const rp = await f.json(base + "/recipients?type=clicked&limit=1")
  const older = await f.json(
    base + `/recipients?type=clicked&limit=1&after=${rp.data[0].id}`
  )
  expect(older.data).toHaveLength(1)
  expect(
    (
      await f.json(
        base + `/recipients?type=clicked&limit=1&before=${older.data[0].id}`
      )
    ).data.map((row: { id: string }) => row.id)
  ).toEqual([rp.data[0].id])
  for (const route of [
    base + "/recipients?type=sent",
    base + "/clicked-links",
  ]) {
    await error(
      await f.call(route, "GET", undefined, f.foreign.token),
      404,
      "not_found"
    )
    await error(
      await f.call(route, "GET", undefined, f.sending.token),
      403,
      "restricted_api_key"
    )
  }
  await error(await f.call(base + "/recipients"), 422, "missing_required_field")
  await error(
    await f.call(base + "/recipients?type=clicked&bounce_type=permanent"),
    422,
    "validation_error"
  )
  await error(
    await f.call(base + "/clicked-links?after=bad"),
    422,
    "validation_error"
  )
})

test("OAuth grants use bearer keys, return revocation metadata and paginate within the team", async () => {
  const f = await setup()
  await f.t.mutation(components.betterAuth.oauthClients.register, {
    clientId: "parity",
    name: "Parity client",
    redirects: ["https://client.example.com/callback"],
    scope: "full_access emails:send",
    method: "none",
  })
  const grant = async (actor = f.owner) => {
    const token = crypto.randomUUID()
    await f.t.mutation(components.betterAuth.oauth.start, {
      token,
      browserHash: "browser",
      query: new URLSearchParams({
        client_id: "parity",
        redirect_uri: "https://client.example.com/callback",
        scope: "full_access",
        response_type: "code",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      }).toString(),
    })
    const result = await f.t.mutation(components.betterAuth.oauth.decide, {
      token,
      browserHash: "browser",
      sessionId: actor.session._id,
      organizationId: actor.team,
      accept: true,
    })
    return result.grantId!
  }
  const first = await grant()
  vi.setSystemTime(Date.now() + 1000)
  const second = await grant()
  const foreign = await grant(f.outsider)
  const page = await f.json("/oauth/grants?limit=1")
  expect(page).toMatchObject({
    object: "list",
    has_more: true,
    data: [
      {
        id: second,
        client_id: "parity",
        client: { name: "Parity client" },
        revoked_at: null,
      },
    ],
  })
  expect((await f.json(`/oauth/grants?after=${second}`)).data[0].id).toBe(first)
  expect(
    (await f.json(`/oauth/grants?before=${first}`)).data.map(
      (row: { id: string }) => row.id
    )
  ).toEqual([second])
  await error(
    await f.call(`/oauth/grants/${foreign}`, "DELETE"),
    404,
    "not_found"
  )
  await error(
    await f.call(`/oauth/grants?after=${foreign}`),
    422,
    "validation_error"
  )
  await error(
    await f.call("/oauth/grants", "GET", undefined, f.sending.token),
    403,
    "restricted_api_key"
  )
  await error(
    await f.call(
      `/oauth/grants/${first}`,
      "DELETE",
      undefined,
      f.sending.token
    ),
    403,
    "restricted_api_key"
  )
  expect(await f.json(`/oauth/grants/${first}`, "DELETE")).toEqual({
    object: "oauth_grant",
    id: first,
    revoked_at: expect.any(String),
    revoked_reason: "revoked_from_api",
  })
  expect(
    await f.t.query(components.betterAuth.oauth.checkGrant, { id: first })
  ).toBeNull()
  await error(
    await f.call(`/oauth/grants/${first}`, "DELETE"),
    404,
    "not_found"
  )
  expect(
    (await f.json("/oauth/grants")).data.find(
      (r: { id: string }) => r.id === first
    )
  ).toMatchObject({ revoked_reason: "revoked_from_api" })
})

test("contact email lookup clears null names; domain creates honor TLS and capabilities", async () => {
  const f = await setup()
  await f.json(
    "/contacts",
    "POST",
    { email: "Mixed@example.com", first_name: "First", last_name: "Last" },
    201
  )
  await f.json("/contacts/MIXED%40example.com", "PATCH", {
    first_name: null,
    last_name: null,
  })
  expect(await f.json("/contacts/mixed%40example.com")).toMatchObject({
    email: "mixed@example.com",
    first_name: null,
    last_name: null,
    properties: {},
  })
  const created = await f.json(
    "/domains",
    "POST",
    {
      name: "new.example.com",
      tls: "enforced",
      capabilities: { sending: "disabled", receiving: "enabled" },
    },
    201
  )
  expect(created).toMatchObject({
    tls: "enforced",
    capabilities: { sending: "disabled", receiving: "enabled" },
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("domains", created.id as Id<"domains">))
  ).toMatchObject({ tls: "enforced", sending: false, receiving: true })
})

test("contact properties preserve API keys and string fallbacks, while numeric fallbacks stay typed", async () => {
  const f = await setup()
  const property = await f.json(
    "/contact-properties",
    "POST",
    { key: "_Campaign2", type: "string", fallback_value: "  keep spaces  " },
    201
  )
  expect(await f.json(`/contact-properties/${property.id}`)).toMatchObject({
    key: "_Campaign2",
    fallback_value: "  keep spaces  ",
  })
  await f.json(`/contact-properties/${property.id}`, "PATCH", {
    fallback_value: "",
  })
  expect(await f.json(`/contact-properties/${property.id}`)).toMatchObject({
    fallback_value: "",
  })
  await f.json(
    "/contacts",
    "POST",
    { email: "properties@example.com", properties: { _Campaign2: "Value" } },
    201
  )
  expect(await f.json("/contacts/properties%40example.com")).toMatchObject({
    properties: { _Campaign2: { type: "string", value: "Value" } },
  })
})

test("template variable metadata survives unrelated edits and version ids advance only on draft edits", async () => {
  const f = await setup()
  const created = await f.json(
    "/templates",
    "POST",
    {
      name: "Metadata",
      html: "<p>{{{value}}}</p>",
      variables: [{ key: "value", type: "string", fallback_value: "first" }],
    },
    201
  )
  const initial = await f.json(`/templates/${created.id}`)
  await f.json(`/templates/${created.id}`, "PATCH", { subject: "Changed" })
  const edited = await f.json(`/templates/${created.id}`)
  expect(edited.current_version_id).not.toBe(initial.current_version_id)
  expect(edited.variables).toEqual(initial.variables)
  await f.json(`/templates/${created.id}`, "PATCH", {
    variables: [{ key: "value", type: "string", fallback_value: "second" }],
  })
  const changed = await f.json(`/templates/${created.id}`)
  expect(changed.variables[0]).toMatchObject({
    id: initial.variables[0].id,
    created_at: initial.variables[0].created_at,
    fallback_value: "second",
  })
  expect(changed.variables[0].updated_at).not.toBe(
    initial.variables[0].updated_at
  )
  await f.json(`/templates/${created.id}/publish`, "POST")
  expect((await f.json(`/templates/${created.id}`)).current_version_id).toBe(
    changed.current_version_id
  )
})

test("list cursors retain equal timestamps and receiving timestamps use ISO", async () => {
  const f = await setup()
  const receivedAt = Date.now()
  const ids = await f.t.run(async (ctx) => {
    const rawId = await ctx.storage.store(new Blob(["raw"]))
    const ids: Id<"receivedEmails">[] = []
    for (const subject of ["First", "Second", "Third"]) {
      const inboundId = await ctx.db.insert("inboundMessages", {
        organizationId: f.owner.team,
        domainId: f.domain,
        region: "us-east-1",
        topicArn: "test",
        messageId: subject,
        sesMessageId: subject,
        bucket: "test",
        objectKey: subject,
        notification: "{}",
      })
      ids.push(
        await insertRow(ctx, "receivedEmails", {
          organizationId: f.owner.team,
          domainId: f.domain,
          inboundId,
          rawId,
          receivedAt,
          expiresAt: receivedAt + 86400000,
          from: "sender@example.com",
          sender: "sender@example.com",
          to: ["hi@mail.example.test"],
          cc: [],
          bcc: [],
          replyTo: [],
          receivedFor: [],
          authentication: {},
          subject,
          messageId: subject,
        })
      )
    }
    return ids
  })
  const first = await f.json("/emails/receiving?limit=1")
  expect(first.data[0]).toMatchObject({
    id: ids[2],
    created_at: new Date(receivedAt).toISOString(),
  })
  const second = await f.json(`/emails/receiving?limit=1&after=${ids[2]}`)
  expect(second).toMatchObject({ has_more: true, data: [{ id: ids[1] }] })
  expect(
    (await f.json(`/emails/receiving?limit=1&after=${ids[1]}`)).data[0].id
  ).toBe(ids[0])
  expect(
    (await f.json(`/emails/receiving?limit=1&before=${ids[1]}`)).data[0].id
  ).toBe(ids[2])
})

test("bounded relation sets use id tie-breaks in both directions", async () => {
  const { cursorPage } = await import("./api/paging")
  const rows = ["a", "b", "c"].map((_id) => ({ _id, _creationTime: 100 }))
  const anchor = async (id: string) =>
    rows.find((row) => row._id === id) ?? null
  const after = await cursorPage({ limit: 1, after: "c" }, anchor, () => rows)
  expect(after).toEqual({ has_more: true, data: [rows[1]] })
  expect(
    await cursorPage({ limit: 1, before: "b" }, anchor, () => rows)
  ).toEqual({ has_more: false, data: [rows[2]] })
})
