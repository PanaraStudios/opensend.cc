import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow } from "./counts"
import { parseAutomationGraph, automationGraph } from "./api/automationGraph"
import { metricsRequest } from "./api/metrics"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-29T12:00:00Z"))
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Unexpected network request"))
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const definition = {
  name: "Welcome",
  steps: [
    { key: "signup", type: "trigger", config: { event_name: "user.created" } },
    { key: "pause", type: "delay", config: { duration: "1 hour" } },
  ],
  connections: [{ from: "signup", to: "pause" }],
}
async function setup() {
  const f = await fixture()
  const member = await f.actor("rest-member")
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
  const makeKey = (
    client: typeof member.client,
    organizationId: string,
    permission: "full_access" | "sending_access"
  ) =>
    client.action(api.apiKeys.create, {
      organizationId,
      input: { name: "REST", permission, domainId: null },
    })
  const { token } = await makeKey(member.client, f.owner.team, "full_access")
  const other = await makeKey(f.outsider.client, f.outsider.team, "full_access")
  const sending = await makeKey(member.client, f.owner.team, "sending_access")
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    options: { token?: string; key?: string } = {}
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    const multipart = body instanceof FormData
    return f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${options.token ?? token}`,
        ...(multipart ? {} : { "Content-Type": "application/json" }),
        ...(options.key ? { "Idempotency-Key": options.key } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: multipart ? body : JSON.stringify(body) }),
    })
  }
  return { ...f, member, call, other: other.token, sending: sending.token }
}
const form = (
  csv = "email,first_name\nada@example.com,Ada\n",
  fields: Record<string, string> = {}
) => {
  const data = new FormData()
  data.append("file", new Blob([csv], { type: "text/csv" }), "contacts.csv")
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}
async function json(response: Promise<Response>, status = 200) {
  const r = await response
  const body = await r.json()
  expect(r.status, JSON.stringify(body)).toBe(status)
  return body
}

test("plain member automation CRUD shares dashboard validation, disabled status and duplication", async () => {
  const f = await setup()
  const { id } = await json(f.call("/automations", "POST", definition), 201)
  const result = await json(f.call(`/automations/${id}`))
  expect(result).toMatchObject({
    ...definition,
    id,
    object: "automation",
    status: "disabled",
  })
  expect(
    await f.member.client.query(api.automations.get, {
      organizationId: f.owner.team,
      id,
    })
  ).toMatchObject({ trigger: "user.created", status: "disabled" })
  await json(f.call(`/automations/${id}`, "PATCH", { status: "enabled" }))
  expect(
    (await json(f.call(`/automations/${id}`, "PATCH", definition), 422)).name
  ).toBe("validation_error")
  const copy = await json(f.call(`/automations/${id}/duplicate`, "POST"), 201)
  expect(await json(f.call(`/automations/${copy.id}`))).toMatchObject({
    status: "disabled",
    name: "Welcome copy",
    steps: definition.steps,
  })
  expect(await json(f.call(`/automations/${id}/stop`, "POST"))).toMatchObject({
    id,
    status: "disabled",
  })
  await json(f.call(`/automations/${id}`, "PATCH", { name: "Changed" }))
  expect(await json(f.call(`/automations/${id}`, "DELETE"))).toEqual({
    object: "automation",
    id,
    deleted: true,
  })
  await json(f.call(`/automations/${id}`), 404)
})

test("all automation POSTs replay transactionally and do not duplicate rows", async () => {
  const f = await setup()
  const first = await json(
    f.call("/automations", "POST", definition, { key: "create" }),
    201
  )
  expect(
    await json(
      f.call("/automations", "POST", definition, { key: "create" }),
      201
    )
  ).toEqual(first)
  const copy = await json(
    f.call(`/automations/${first.id}/duplicate`, "POST", undefined, {
      key: "copy",
    }),
    201
  )
  expect(
    await json(
      f.call(`/automations/${first.id}/duplicate`, "POST", undefined, {
        key: "copy",
      }),
      201
    )
  ).toEqual(copy)
  const stopped = await json(
    f.call(`/automations/${first.id}/stop`, "POST", undefined, { key: "stop" })
  )
  expect(
    await json(
      f.call(`/automations/${first.id}/stop`, "POST", undefined, {
        key: "stop",
      })
    )
  ).toEqual(stopped)
  expect((await json(f.call("/automations"))).data).toHaveLength(2)
  await json(
    f.call(
      "/automations",
      "POST",
      { ...definition, name: "Mismatch" },
      { key: "create" }
    ),
    409
  )
})

test("automation pagination and status filters use team-scoped id cursors", async () => {
  const f = await setup()
  const ids = []
  for (let n = 0; n < 3; n++)
    ids.push(
      (
        await json(
          f.call("/automations", "POST", {
            ...definition,
            name: String(n),
            status: n === 1 ? "enabled" : "disabled",
          }),
          201
        )
      ).id
    )
  const first = await json(f.call("/automations?limit=1"))
  expect(first).toMatchObject({ has_more: true, data: [{ id: ids[2] }] })
  expect(
    await json(f.call(`/automations?limit=1&after=${ids[2]}`))
  ).toMatchObject({ data: [{ id: ids[1] }] })
  expect(
    await json(f.call(`/automations?limit=1&before=${ids[1]}`))
  ).toMatchObject({ data: [{ id: ids[2] }] })
  expect(
    (await json(f.call("/automations?status=disabled"))).data.map(
      (r: { id: string }) => r.id
    )
  ).toEqual([ids[2], ids[0]])
  await json(f.call("/automations?limit=0"), 422)
  await json(f.call(`/automations?after=${ids[2]}&before=${ids[1]}`), 422)
  await json(f.call("/automations?status=draft"), 422)
})

test("automation graph validates cycles, unknown types, unsupported options and publish failures atomically", async () => {
  const f = await setup()
  for (const body of [
    {},
    { ...definition, name: " " },
    { ...definition, connections: [] },
    {
      ...definition,
      steps: [
        ...definition.steps,
        { key: "other", type: "http_request", config: {} },
      ],
      connections: [...definition.connections, { from: "pause", to: "other" }],
    },
    {
      ...definition,
      status: "enabled",
      steps: [
        definition.steps[0],
        { ...definition.steps[1], config: { duration: "forever" } },
      ],
    },
  ]) {
    const error = await json(f.call("/automations", "POST", body), 422)
    expect(["validation_error", "missing_required_field"]).toContain(error.name)
  }
  expect((await json(f.call("/automations"))).data).toEqual([])
  expect(() =>
    parseAutomationGraph(
      [
        { key: "start", type: "trigger", config: { event_name: "x" } },
        {
          key: "a",
          type: "send_email",
          config: { template: { id: "x" }, subject: "override" },
        },
      ],
      [{ from: "start", to: "a" }]
    )
  ).toThrow("subject")
})

test("every automation id including references and run parents is isolated", async () => {
  const f = await setup()
  const { id } = await json(f.call("/automations", "POST", definition), 201)
  for (const [path, method] of [
    [`/automations/${id}`, "GET"],
    [`/automations/${id}`, "PATCH"],
    [`/automations/${id}`, "DELETE"],
    [`/automations/${id}/duplicate`, "POST"],
    [`/automations/${id}/stop`, "POST"],
    [`/automations/${id}/runs`, "GET"],
    [`/automations/${id}/runs/missing`, "GET"],
  ])
    expect(
      (await json(f.call(path, method, undefined, { token: f.other }), 404))
        .name
    ).toBe("not_found")
  await expect(
    f.outsider.client.query(api.automations.get, {
      organizationId: f.owner.team,
      id,
    })
  ).rejects.toThrow("permission")
  const segment = await f.outsider.client.mutation(api.segments.create, {
    organizationId: f.outsider.team,
    name: "Other",
  })
  await json(
    f.call("/automations", "POST", {
      ...definition,
      steps: [
        definition.steps[0],
        {
          key: "pause",
          type: "add_to_segment",
          config: { segment_id: segment },
        },
      ],
    }),
    404
  )
})

test("runs return graph-ordered step history and support comma-separated status pagination", async () => {
  const f = await setup()
  const { id } = await json(f.call("/automations", "POST", definition), 201)
  const contact = await json(
    f.call("/contacts", "POST", { email: "ada@example.com" }),
    201
  )
  const ids: Id<"automationRuns">[] = []
  for (const status of ["completed", "failed", "running"] as const) {
    vi.setSystemTime(Date.now() + 1100)
    ids.push(
      await f.t.run(async (ctx) => {
        const row = (await ctx.db.get("automations", id as Id<"automations">))!
        const run = await insertRow(ctx, "automationRuns", {
          organizationId: f.owner.team,
          automationId: row._id,
          contactId: contact.id,
          contactEmail: "ada@example.com",
          payload: {},
          graph: row.graph,
          trigger: row.trigger,
          apiDefinition: row.apiDefinition,
          status,
          sent: 0,
        })
        for (const [key, type] of [
          ["pause", "delay"],
          ["start", "trigger"],
        ] as const)
          await insertRow(ctx, "automationRunSteps", {
            organizationId: f.owner.team,
            automationId: row._id,
            runId: run,
            key,
            type,
            status,
            startedAt: Date.now(),
            runStartedAt: Date.now(),
            ...(status === "failed" ? { error: "Failed step" } : {}),
          })
        return run
      })
    )
  }
  expect(
    await json(
      f.call(`/automations/${id}/runs?status=failed,completed&limit=1`)
    )
  ).toMatchObject({ has_more: true, data: [{ id: ids[1] }] })
  expect(
    await json(
      f.call(`/automations/${id}/runs?status=failed,completed&after=${ids[1]}`)
    )
  ).toMatchObject({ data: [{ id: ids[0] }] })
  const run = await json(f.call(`/automations/${id}/runs/${ids[1]}`))
  expect(run.steps.map((s: { key: string }) => s.key)).toEqual([
    "signup",
    "pause",
  ])
  expect(run.steps[0].error).toEqual({ message: "Failed step" })
  const other = await json(f.call("/automations", "POST", definition), 201)
  await json(f.call(`/automations/${other.id}/runs/${ids[0]}`), 404)
})

test("branched wire definitions round-trip without changing execution order", () => {
  const steps = [
    definition.steps[0],
    {
      key: "condition",
      type: "condition",
      config: {
        type: "rule",
        field: "event.plan",
        operator: "eq",
        value: "paid",
      },
    },
    definition.steps[1],
    { key: "delete", type: "contact_delete", config: {} },
  ]
  const connections = [
    { from: "signup", to: "condition" },
    { from: "condition", to: "pause", type: "condition_met" },
    { from: "condition", to: "delete", type: "condition_not_met" },
  ]
  const parsed = parseAutomationGraph(steps, connections)
  expect(JSON.parse(parsed.graph)[0]).toMatchObject({
    met: [{ key: "pause" }],
    notMet: [{ key: "delete" }],
  })
  expect(automationGraph(parsed).steps).toEqual(steps)
})

test("multipart imports replay across boundaries, process CSV rows and suppress webhooks", async () => {
  const f = await setup()
  const csv = 'Email,Given,Score\nada@example.com,"Ada, A",12\nbad,,oops\n'
  const fields = {
    column_map: JSON.stringify({
      email: "Email",
      first_name: "Given",
      properties: { score: { column: "Score", type: "number" } },
    }),
  }
  const created = await json(
    f.call("/contacts/imports", "POST", form(csv, fields), { key: "csv" }),
    201
  )
  expect(
    await json(
      f.call("/contacts/imports", "POST", form(csv, fields), { key: "csv" }),
      201
    )
  ).toEqual(created)
  await f.t.mutation(internal.contactImports.step, {
    id: created.id,
    offset: 0,
  })
  expect(await json(f.call(`/contacts/imports/${created.id}`))).toMatchObject({
    status: "completed",
    completed_at: expect.any(String),
    counts: { total: 2, created: 1, updated: 0, skipped: 0, failed: 1 },
  })
  const contacts = await json(f.call("/contacts"))
  expect(contacts.data).toHaveLength(1)
  expect(contacts.data[0].first_name).toBe("Ada, A")
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .take(20)
    )
  ).toEqual([])
  const second = await json(
    f.call(
      "/contacts/imports",
      "POST",
      form("email,first_name\nada@example.com,Changed\n")
    ),
    201
  )
  await f.t.mutation(internal.contactImports.step, { id: second.id, offset: 0 })
  expect(await json(f.call(`/contacts/imports/${second.id}`))).toMatchObject({
    counts: { updated: 1 },
  })
})

test("imports apply segments/topics without contact events and respect skip conflicts", async () => {
  const f = await setup()
  const segment = await f.member.client.mutation(api.segments.create, {
    organizationId: f.owner.team,
    name: "Readers",
  })
  const topic = await json(
    f.call("/topics", "POST", { name: "News", default_subscription: "opt_in" }),
    201
  )
  const fields = {
    segments: JSON.stringify([{ id: segment }]),
    topics: JSON.stringify([{ id: topic.id, subscription: "opt_out" }]),
    on_conflict: "skip",
  }
  const created = await json(
    f.call("/contacts/imports", "POST", form(undefined, fields)),
    201
  )
  await f.t.mutation(internal.contactImports.step, {
    id: created.id,
    offset: 0,
  })
  const contact = (await json(f.call("/contacts"))).data[0]
  expect(
    (await json(f.call(`/contacts/${contact.id}/topics`))).data
  ).toMatchObject([{ id: topic.id, subscription: "opt_out" }])
  expect(
    (await json(f.call(`/segments/${segment}/contacts`))).data
  ).toHaveLength(1)
  const repeat = await json(
    f.call("/contacts/imports", "POST", form(undefined, fields)),
    201
  )
  await f.t.mutation(internal.contactImports.step, { id: repeat.id, offset: 0 })
  expect(await json(f.call(`/contacts/imports/${repeat.id}`))).toMatchObject({
    counts: { skipped: 1, failed: 0 },
  })
})

test("import validation, ownership, metadata pagination and status filters", async () => {
  const f = await setup()
  await json(f.call("/contacts/imports", "POST", {}), 400)
  for (const data of [
    form("first_name\nAda"),
    form('email\n"bad'),
    form(undefined, { column_map: "not-json" }),
    form(undefined, { on_conflict: "overwrite" }),
    form(undefined, {
      column_map: JSON.stringify({
        properties: { flag: { column: "email", type: "boolean" } },
      }),
    }),
  ])
    expect(
      (await json(f.call("/contacts/imports", "POST", data), 422)).name
    ).toBe("validation_error")
  const a = await json(f.call("/contacts/imports", "POST", form()), 201)
  const b = await json(f.call("/contacts/imports", "POST", form()), 201)
  expect(await json(f.call("/contacts/imports?limit=1"))).toMatchObject({
    has_more: true,
    data: [{ id: b.id }],
  })
  expect(await json(f.call(`/contacts/imports?after=${b.id}`))).toMatchObject({
    data: [{ id: a.id }],
  })
  expect(await json(f.call(`/contacts/imports?before=${a.id}`))).toMatchObject({
    data: [{ id: b.id }],
  })
  expect(
    (await json(f.call("/contacts/imports?status=in_progress"))).data
  ).toHaveLength(2)
  expect(
    (await json(f.call("/contacts/imports?status=completed"))).data
  ).toHaveLength(0)
  await json(
    f.call(`/contacts/imports/${a.id}`, "GET", undefined, { token: f.other }),
    404
  )
  await json(f.call("/contacts/imports/missing"), 404)
  await json(f.call("/contacts/imports?limit=101"), 422)
})

test("every new route rejects sending-only credentials", async () => {
  const f = await setup()
  for (const [path, method] of [
    ["/automations", "POST"],
    ["/automations", "GET"],
    ["/automations/id", "GET"],
    ["/automations/id", "PATCH"],
    ["/automations/id", "DELETE"],
    ["/automations/id/duplicate", "POST"],
    ["/automations/id/stop", "POST"],
    ["/automations/id/runs", "GET"],
    ["/automations/id/runs/id", "GET"],
    ["/contacts/imports", "POST"],
    ["/contacts/imports", "GET"],
    ["/contacts/imports/id", "GET"],
    ["/emails/metrics", "GET"],
  ])
    expect(
      (await json(f.call(path, method, undefined, { token: f.sending }), 401))
        .name
    ).toBe("restricted_api_key")
})

test("metrics return existing aggregate counts, percentage rates and period/domain dimensions", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    const email = await insertRow(ctx, "emails", {
      organizationId: f.owner.team,
      domainId: f.domain,
      from: "a@mail.example.test",
      to: ["ada@example.com"],
      subject: "Metrics",
      status: "delivered",
      source: "api",
      generation: 0,
      attempts: 0,
      search: "metrics",
    })
    for (const type of ["sent", "delivered", "opened"] as const)
      await insertRow(ctx, "emailMetrics", {
        organizationId: f.owner.team,
        domainId: f.domain,
        emailId: email,
        type,
        createdAt: Date.now(),
        at: Date.now(),
        recipients: ["ada@example.com"],
      })
  })
  const query = `/emails/metrics?start_date=2026-09-29&end_date=2026-09-29&metrics=sent,delivered&metrics=open_rate&dimensions=period,domain&domain_id=${f.domain}`
  expect(await json(f.call(query))).toMatchObject({
    object: "metrics",
    metrics: ["sent", "delivered", "open_rate"],
    totals: { sent: 1, delivered: 1, open_rate: 100 },
    data: [{ domain_id: f.domain, period: "2026-09-29", sent: 1 }],
  })
  expect(
    (await json(f.call("/emails/metrics?metrics=sent"))).data
  ).toBeUndefined()
  expect(
    (
      await json(
        f.call("/emails/metrics?metrics=sent", "GET", undefined, {
          token: f.other,
        })
      )
    ).totals.sent
  ).toBe(0)
  await json(f.call(query, "GET", undefined, { token: f.other }), 404)
})

test("metrics bound periods, ranges, filters and invalid values with validation_error", async () => {
  const f = await setup()
  for (const query of [
    "start_date=2026-01-01&end_date=2026-03-01&dimensions=period",
    "start_date=2024-01-01",
    "timezone=Invalid/Place",
    "granularity=second",
    "metrics=opened",
    "dimensions=email",
    "email_id=missing",
    "start_date=2026-02-30",
    "start_date=2026-09-29&end_date=2026-09-28",
  ])
    expect((await json(f.call(`/emails/metrics?${query}`), 422)).name).toBe(
      "validation_error"
    )
  await json(f.call("/emails/metrics?domain_id=missing"), 404)
})

test("IANA period bucketing handles half-hour offsets, DST folds and monthly ranges", () => {
  const half = metricsRequest(
    new URLSearchParams(
      "start_date=2026-09-01&end_date=2026-09-02&dimensions=period&timezone=Asia/Kolkata"
    )
  )
  expect(half.spans[0].to + 1).toBe(Date.parse("2026-09-01T18:30:00Z"))
  const dst = metricsRequest(
    new URLSearchParams(
      "start_date=2026-03-08&end_date=2026-03-08&dimensions=period&granularity=hourly&timezone=America/New_York"
    )
  )
  expect(dst.spans).toHaveLength(24)
  expect(dst.spans.some((s) => s.period.startsWith("2026-03-08T02"))).toBe(
    false
  )
  expect(
    metricsRequest(
      new URLSearchParams(
        "start_date=2026-01-01&end_date=2026-09-01&dimensions=period&granularity=monthly"
      )
    ).spans
  ).toHaveLength(9)
})

test("dashboard branch continuations project explicit joins and typed variable references", () => {
  const graph = JSON.stringify([
    {
      key: "branch",
      type: "condition",
      match: "and",
      rules: [{ field: "event.score", operator: "gte", value: "10" }],
      met: [{ key: "left", type: "delay", duration: "1 hour" }],
      notMet: [],
    },
    {
      key: "email",
      type: "send_email",
      templateId: "template",
      from: "",
      replyTo: "",
      variables: { score: "event.score" },
    },
  ])
  const wire = automationGraph({ trigger: "user.created", graph })
  expect(wire.connections).toEqual([
    { from: "start", to: "branch", type: "default" },
    { from: "branch", to: "left", type: "condition_met" },
    { from: "left", to: "email", type: "default" },
    { from: "branch", to: "email", type: "condition_not_met" },
  ])
  expect(wire.steps[1].config).toMatchObject({ rules: [{ value: 10 }] })
  expect(wire.steps[3].config).toMatchObject({
    template: { variables: { score: { var: "event.score" } } },
  })
})

test("import job batches include topic fan-out and normalize mapped property keys", async () => {
  const f = await setup()
  const topics = await f.t.run(async (ctx) => {
    const rows = []
    for (let n = 0; n < 12; n++)
      rows.push({
        id: await insertRow(ctx, "topics", {
          organizationId: f.owner.team,
          name: `Topic ${n}`,
          description: "",
          defaultSubscription: "opt_in",
          visibility: "public",
        }),
        subscription: "opt_out",
      })
    return rows
  })
  const csv =
    "email,Score\n" +
    Array.from({ length: 50 }, (_, n) => `reader${n}@example.com,${n}`).join(
      "\n"
    )
  const created = await json(
    f.call(
      "/contacts/imports",
      "POST",
      form(csv, {
        topics: JSON.stringify(topics),
        column_map: JSON.stringify({
          properties: { Score: { column: "Score", type: "number" } },
        }),
      })
    ),
    201
  )
  await f.t.mutation(internal.contactImports.step, {
    id: created.id,
    offset: 0,
  })
  // 12 topic choices per contact: floor(200 / 12) contacts per transaction.
  expect(await json(f.call(`/contacts/imports/${created.id}`))).toMatchObject({
    status: "in_progress",
    counts: { total: 16, created: 16, failed: 0 },
  })
  for (const offset of [16, 32, 48])
    await f.t.mutation(internal.contactImports.step, {
      id: created.id,
      offset,
    })
  expect(await json(f.call(`/contacts/imports/${created.id}`))).toMatchObject({
    status: "completed",
    counts: { total: 50, created: 50, failed: 0 },
  })
})
