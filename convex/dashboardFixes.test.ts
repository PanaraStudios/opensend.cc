import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow, patchRow } from "./counts"
import { insertExport } from "./exportRows"
import { writeLog } from "./logs"
import { insertEmail, recordEmailStatus } from "./emailRows"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SITE_URL", "https://mail.opensend.test:8443")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  await f.t.run(async (ctx) => {
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
  return { ...f, member }
}
const from = "Opensend <no-reply@mail.example.test>"

test("installation sender is admin-only; UI and CLI share set/clear", async () => {
  const f = await setup()
  for (const actor of [f.member, f.outsider]) {
    await expect(
      actor.client.query(api.systemEmail.settings, {})
    ).rejects.toThrow("installation administrator")
    await expect(
      actor.client.query(api.systemEmail.domains, {})
    ).rejects.toThrow("installation administrator")
    await expect(
      actor.client.mutation(api.systemEmail.setSender, {
        from,
        domainId: f.domain,
      })
    ).rejects.toThrow("installation administrator")
    await expect(
      actor.client.mutation(api.systemEmail.setSender, {})
    ).rejects.toThrow("installation administrator")
  }
  await f.owner.client.mutation(api.systemEmail.setSender, {
    from,
    domainId: f.domain,
  })
  expect(await f.owner.client.query(api.systemEmail.settings, {})).toEqual({
    from,
    domainId: f.domain,
  })
  await f.t.mutation(internal.installationAdmin.setSystemSender, {})
  expect(await f.owner.client.query(api.systemEmail.settings, {})).toBeNull()
  await f.t.mutation(internal.installationAdmin.setSystemSender, { from })
  await f.owner.client.mutation(api.systemEmail.setSender, {})
  expect(await f.owner.client.query(api.systemEmail.settings, {})).toBeNull()
})

test("sender selection includes another team's domain and binds its exact tenant", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "domains", f.domain, {
      organizationId: f.outsider.team,
    })
    await ctx.db.patch("sesTenants", f.tenant, {
      organizationId: f.outsider.team,
    })
  })
  expect(
    await f.owner.client.query(api.systemEmail.domains, { search: "MAIL" })
  ).toEqual([{ _id: f.domain, name: "mail.example.test", region: "us-east-1" }])
  await f.owner.client.mutation(api.systemEmail.setSender, {
    from,
    domainId: f.domain,
  })
  expect(
    (await f.owner.client.query(api.systemEmail.settings, {}))?.domainId
  ).toBe(f.domain)
})

test.each([
  "bad",
  "Hi\r\nBcc: victim@example.test <no-reply@mail.example.test>",
  "hi@wrong.test",
])("sender rejects invalid or mismatched address %s", async (value) => {
  const f = await setup()
  await expect(
    f.owner.client.mutation(api.systemEmail.setSender, {
      from: value,
      domainId: f.domain,
    })
  ).rejects.toThrow()
  await expect(
    f.t.mutation(internal.installationAdmin.setSystemSender, { from: value })
  ).rejects.toThrow()
  expect(await f.owner.client.query(api.systemEmail.settings, {})).toBeNull()
})

test.each(["pending", "deleted", "disabled", "paused", "policy"])(
  "sender refuses unavailable domain: %s",
  async (state) => {
    const f = await setup()
    await f.t.run(async (ctx) => {
      if (state === "pending")
        await patchRow(ctx, "domains", f.domain, { status: "pending" })
      if (state === "deleted")
        await patchRow(ctx, "domains", f.domain, { deleted: true })
      if (state === "disabled")
        await patchRow(ctx, "domains", f.domain, { sending: false })
      if (state === "paused")
        await ctx.db.patch("sesTenants", f.tenant, {
          sendingStatus: "DISABLED",
        })
      if (state === "policy")
        await ctx.db.patch("installation", f.installation, {
          policyRevision: 1,
        })
    })
    await expect(
      f.owner.client.mutation(api.systemEmail.setSender, {
        from,
        domainId: f.domain,
      })
    ).rejects.toThrow()
    await expect(
      f.t.mutation(internal.installationAdmin.setSystemSender, { from })
    ).rejects.toThrow()
    if (["pending", "deleted", "disabled"].includes(state))
      expect(await f.owner.client.query(api.systemEmail.domains, {})).toEqual(
        []
      )
  }
)

async function exportJob(
  f: Awaited<ReturnType<typeof setup>>,
  rows: number,
  extra = {}
) {
  return f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["id\r\n1\r\n"]))
    return insertExport(ctx, {
      organizationId: f.owner.team,
      resource: "contacts",
      status: "ready",
      filters: {},
      rows,
      expiresAt: Date.now() + 7 * 86400000,
      storageId,
      creatorEmail: f.member.user.email,
      ...extra,
    })
  })
}

test("large export emails creator once through system sender; link keeps admin download restriction", async () => {
  const f = await setup()
  await f.owner.client.mutation(api.systemEmail.setSender, {
    from,
    domainId: f.domain,
  })
  const id = await exportJob(f, 1001)
  await f.t.mutation(internal.exports.emailCreator, { id })
  await f.t.mutation(internal.exports.emailCreator, { id })
  const [email] = await f.t.run((ctx) => ctx.db.query("emails").collect())
  expect(email).toMatchObject({
    source: "system",
    organizationId: "installation",
    to: [f.member.user.email],
    subject: "Your export is ready",
    domainId: f.domain,
  })
  const content = await f.t.run((ctx) => ctx.db.query("emailContents").first())
  expect(content?.text).toContain(
    `https://mail.opensend.test:8443/settings/exports/${id}`
  )
  expect(content?.html).toBeUndefined()
  expect(await f.t.run((ctx) => ctx.db.query("emails").collect())).toHaveLength(
    1
  )
  await expect(
    f.member.client.query(api.exports.downloadUrl, { id })
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.exports.get, { id })
  ).rejects.toThrow("permission")
  expect(
    await f.owner.client.query(api.exports.downloadUrl, { id })
  ).toBeTruthy()
  expect(
    await f.owner.client.query(api.exports.get, { id })
  ).not.toHaveProperty("notificationEmailId")
})

test.each([
  { rows: 1000, extra: {} },
  { rows: 1001, extra: { status: "failed" } },
  { rows: 1001, extra: { status: "processing" } },
  { rows: 1001, extra: { expiresAt: 0 } },
  { rows: 1001, extra: { creatorEmail: undefined } },
])("export skips ineligible notification %#", async ({ rows, extra }) => {
  const f = await setup()
  await f.owner.client.mutation(api.systemEmail.setSender, {
    from,
    domainId: f.domain,
  })
  const id = await exportJob(f, rows, extra)
  await f.t.mutation(internal.exports.emailCreator, { id })
  expect(await f.t.run((ctx) => ctx.db.query("emails").collect())).toEqual([])
})

test("large export without installation sender stays downloadable and sends nothing", async () => {
  const f = await setup()
  const id = await exportJob(f, 1001)
  vi.stubEnv("SITE_URL", undefined)
  const log = vi.spyOn(console, "log")
  await f.t.mutation(internal.exports.emailCreator, { id })
  expect(await f.t.run((ctx) => ctx.db.query("emails").collect())).toEqual([])
  expect(
    await f.owner.client.query(api.exports.downloadUrl, { id })
  ).toBeTruthy()
  expect(log).not.toHaveBeenCalled()
})

test.each([1000, 1001])(
  "completion schedules a notification only above 1000 rows: %s",
  async (rows) => {
    const f = await setup()
    const id = await exportJob(f, rows, { status: "processing" })
    const job = await f.t.query(internal.exports.job, { id })
    await f.t.mutation(internal.exports.finish, {
      id,
      storageId: job!.storageId,
      rows,
    })
    const scheduled = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    )
    expect(
      scheduled.filter((row) => row.name.includes("exports:emailCreator"))
    ).toHaveLength(rows > 1000 ? 1 : 0)
  }
)

test("metrics selected domain beyond the summary cap is read directly and cannot leak across teams", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    const { _id, _creationTime, ...base } = (await ctx.db.get(
      "domains",
      f.domain
    ))!
    void _id
    void _creationTime
    for (let i = 0; i < 100; i++)
      await insertRow(ctx, "domains", { ...base, name: `a${i}.test` })
    const id = await insertEmail(
      ctx,
      {
        organizationId: f.owner.team,
        domainId: f.domain,
        source: "api",
        from: "hi@mail.example.test",
        to: ["user@example.test"],
        subject: "Test",
        status: "queued",
        generation: 0,
        attempts: 0,
        search: "user@example.test Test",
      },
      { text: "Test" },
      ["user@example.test"]
    )
    // Metrics count emails SES accepted, not ones still queued.
    await recordEmailStatus(ctx, id, "sent")
  })
  const args = { organizationId: f.owner.team, domainId: f.domain }
  expect(
    await f.member.client.query(api.metrics.breakdown, args)
  ).toMatchObject([{ id: f.domain, counts: { sent: 1 } }])
  await expect(
    f.outsider.client.query(api.metrics.breakdown, args)
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.metrics.breakdown, {
      ...args,
      organizationId: f.outsider.team,
    })
  ).rejects.toThrow("Domain not found")
  await expect(
    f.member.client.query(api.metrics.breakdown, { ...args, from: 1, to: 2 })
  ).rejects.toThrow("Invalid metrics")
})

test("log agents span unloaded and filtered pages, deduplicate, and isolate teams", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 130; i++)
      await writeLog(ctx, f.owner.team, {
        method: "GET",
        path: "/emails",
        status: 200,
        durationMs: 1,
        userAgent: i === 0 ? "old-agent" : "new-agent",
        source: "api",
        requestHeaders: [],
      })
    await writeLog(ctx, f.outsider.team, {
      method: "GET",
      path: "/emails",
      status: 200,
      durationMs: 1,
      userAgent: "other-team",
      source: "api",
      requestHeaders: [],
    })
  })
  const args = { organizationId: f.owner.team }
  expect(await f.member.client.query(api.logs.userAgents, args)).toEqual([
    "new-agent",
    "old-agent",
  ])
  expect(
    (
      await f.member.client.query(api.logs.list, {
        ...args,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).page.every((row) => row.userAgent === "new-agent")
  ).toBe(true)
  await expect(
    f.outsider.client.query(api.logs.userAgents, args)
  ).rejects.toThrow("permission")
})

test("log agent query caps distinct values, not the number of log rows scanned", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 105; i++)
      await writeLog(ctx, f.owner.team, {
        method: "GET",
        path: "/emails",
        status: 200,
        durationMs: 1,
        userAgent: `agent-${String(i).padStart(3, "0")}`,
        source: "api",
        requestHeaders: [],
      })
  })
  const agents = await f.owner.client.query(api.logs.userAgents, {
    organizationId: f.owner.team,
  })
  expect(agents).toHaveLength(100)
  expect(agents[99]).toBe("agent-099")
})

test.each([undefined, "", "  ", "smtp.example.test"])(
  "SMTP host uses public SITE_URL unless overridden: %s",
  async (override) => {
    const f = await setup()
    vi.stubEnv("SMTP_HOST", override)
    expect(
      (
        await f.member.client.query(api.smtp.settings, {
          organizationId: f.owner.team,
        })
      ).host
    ).toBe(override?.trim() || "mail.opensend.test")
    await f.member.client.mutation(api.smtp.update, {
      organizationId: f.owner.team,
      enabled: true,
      port: 587,
    })
    expect(
      (
        await f.member.client.query(api.smtp.settings, {
          organizationId: f.owner.team,
        })
      ).enabled
    ).toBe(true)
    await expect(
      f.outsider.client.query(api.smtp.settings, {
        organizationId: f.owner.team,
      })
    ).rejects.toThrow("permission")
  }
)

test("bounded contact, event, template and domain searches reach options beyond the first 100", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    const domain = (await ctx.db.get("domains", f.domain))!
    const { _id, _creationTime, ...base } = domain
    void _id
    void _creationTime
    for (let i = 0; i < 105; i++) {
      const name = `record${String(i).padStart(3, "0")}`
      await insertRow(ctx, "contacts", {
        organizationId: f.owner.team,
        email: `${name}@example.test`,
        firstName: "",
        lastName: "",
        unsubscribed: false,
        properties: {},
        search: name,
        updatedAt: Date.now(),
      })
      await ctx.db.insert("automationEvents", {
        organizationId: f.owner.team,
        name,
        schema: [],
        searchText: name,
        updatedAt: Date.now(),
      })
      await insertRow(ctx, "templates", {
        organizationId: f.owner.team,
        name,
        alias: name,
        status: "draft",
        subject: "",
        preview: "",
        variables: [],
        updatedAt: Date.now(),
        searchText: name,
      })
      await insertRow(ctx, "domains", { ...base, name: `${name}.test` })
    }
  })
  const args = { organizationId: f.owner.team }
  expect(await f.member.client.query(api.contacts.options, args)).toHaveLength(
    100
  )
  expect(
    await f.member.client.query(api.automationEvents.options, args)
  ).toHaveLength(100)
  expect(await f.member.client.query(api.templates.options, args)).toHaveLength(
    100
  )
  expect(
    await f.member.client.query(api.metrics.domainOptions, args)
  ).toHaveLength(100)
  const search = { ...args, search: "record104" }
  expect(
    await f.member.client.query(api.contacts.options, search)
  ).toMatchObject([{ email: "record104@example.test" }])
  expect(
    await f.member.client.query(api.automationEvents.options, search)
  ).toEqual(["record104"])
  expect(
    await f.member.client.query(api.templates.options, {
      ...args,
      search: "record000",
    })
  ).toMatchObject([{ name: "record000" }])
  expect(
    await f.member.client.query(api.metrics.domainOptions, search)
  ).toMatchObject([{ label: "record104.test" }])
  expect(
    await f.owner.client.query(api.systemEmail.domains, { search: "record104" })
  ).toMatchObject([{ name: "record104.test" }])
  await expect(
    f.outsider.client.query(api.contacts.options, args)
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.automationEvents.options, args)
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.templates.options, args)
  ).rejects.toThrow("permission")
  await expect(
    f.outsider.client.query(api.metrics.domainOptions, args)
  ).rejects.toThrow("permission")
})
