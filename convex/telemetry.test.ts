import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { authFixture } from "./testHelpers/ses.fixture"
import { TELEMETRY_DAY } from "../lib/telemetry"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubEnv("OPENSEND_TELEMETRY", "1")
  vi.stubEnv("CONVEX_CLOUD_URL", "https://deployment.convex.cloud")
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
async function installed() {
  const f = await authFixture()
  const owner = await f.actor("owner", true)
  const id = await owner.client.mutation(
    internal.installation.saveEnvironment,
    {
      siteUrl: "https://opensend.test",
      callbackOrigin: "https://api.opensend.test",
    }
  )
  await f.t.run((ctx) =>
    ctx.db.patch("installation", id, { completedAt: Date.now() })
  )
  return { ...f, owner, id }
}
test("POST contains only allowed anonymous fields, stable UUID and bands", async () => {
  const f = await installed()
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal("fetch", fetchMock)
  const preview = await f.owner.client.action(api.telemetry.preview)
  await f.t.action(internal.telemetry.send)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, request] = fetchMock.mock.calls[0]
  expect(url).toBe("https://opensend.cc/api/telemetry")
  expect(request.method).toBe("POST")
  expect(request.headers).toEqual({ "content-type": "application/json" })
  const payload = JSON.parse(request.body)
  expect(payload).toEqual(preview)
  expect(payload.installationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  )
  expect(payload.usage.teams).toBe("1-9")
  expect(payload.usage.members).toBe("1-9")
  expect(payload.usage.sesProduction).toBeNull()
  const forbidden =
    /^(email|name|domain|hostname|ip|organizationId|teamId|userId|content|key|url|userAgent|encryptedSecret)$/i
  function check(value: unknown) {
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        expect(key).not.toMatch(forbidden)
        check(child)
      }
  }
  check(payload)
  expect(request.body).not.toContain("opensend.test")
  expect(Object.keys(payload).sort()).toEqual(
    [
      "schema",
      "installationId",
      "sentAt",
      "version",
      "deployment",
      "installedDays",
      "usage",
    ].sort()
  )
  expect(new TextEncoder().encode(request.body).length).toBeLessThanOrEqual(
    8192
  )
  expect(
    (await f.t.run((ctx) => ctx.db.get("installation", f.id)))?.installationId
  ).toBe(payload.installationId)
})
test("hard off makes no network call, locks settings and schedules nothing", async () => {
  const f = await installed()
  vi.stubEnv("OPENSEND_TELEMETRY", "0")
  const fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  expect(await f.owner.client.query(api.telemetry.settings)).toEqual({
    enabled: false,
    locked: true,
  })
  await f.t.action(internal.telemetry.send)
  await f.t.mutation(internal.telemetry.dispatch)
  expect(fetchMock).not.toHaveBeenCalled()
  expect(
    (await f.t.run((ctx) => ctx.db.get("installation", f.id)))
      ?.telemetryLastAttemptAt
  ).toBeUndefined()
  expect(
    await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(10))
  ).toEqual([])
  await expect(
    f.owner.client.mutation(api.telemetry.setEnabled, { enabled: true })
  ).rejects.toThrow("server environment")
})
test("switch and preview are installation-admin-only", async () => {
  const f = await installed()
  const member = await f.account("member")
  await expect(member.client.query(api.telemetry.settings)).rejects.toThrow(
    "administrator"
  )
  await expect(
    member.client.mutation(api.telemetry.setEnabled, { enabled: false })
  ).rejects.toThrow("administrator")
  await expect(member.client.action(api.telemetry.preview)).rejects.toThrow(
    "administrator"
  )
})
test("turning off cancels the effect of an already queued ping, without goodbye", async () => {
  const f = await installed()
  const fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  await f.t.mutation(internal.telemetry.dispatch)
  const row = await f.t.run((ctx) => ctx.db.get("installation", f.id))
  expect(row?.telemetryScheduledAt).toBeGreaterThanOrEqual(Date.now())
  expect(row?.telemetryScheduledAt).toBeLessThanOrEqual(
    Date.now() + 2 * 60 * 60_000
  )
  await f.owner.client.mutation(api.telemetry.setEnabled, { enabled: false })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(fetchMock).not.toHaveBeenCalled()
})
test("errors are ignored and concurrent sends cannot retry within 24 hours", async () => {
  const f = await installed()
  const fetchMock = vi
    .fn()
    .mockRejectedValue(new Error("collector unavailable"))
  vi.stubGlobal("fetch", fetchMock)
  await Promise.all([
    f.t.action(internal.telemetry.send),
    f.t.action(internal.telemetry.send),
  ])
  expect(fetchMock).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(TELEMETRY_DAY - 1)
  await f.t.action(internal.telemetry.send)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(1)
  await f.t.action(internal.telemetry.send)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
test("setup completion queues exactly one immediate ping", async () => {
  const f = await authFixture()
  const owner = await f.actor("owner", true)
  const id = await owner.client.mutation(
    internal.installation.saveEnvironment,
    {
      siteUrl: "https://opensend.test",
      callbackOrigin: "https://api.opensend.test",
    }
  )
  await f.t.run((ctx) =>
    ctx.db.patch("installation", id, {
      emailDeferredAt: Date.now(),
      setupStep: "team",
    })
  )
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal("fetch", fetchMock)
  await owner.client.mutation(api.installation.complete, {
    organizationId: owner.team,
  })
  await owner.client.mutation(api.installation.complete, {
    organizationId: owner.team,
  })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test("request counters distinguish API, SDK, MCP and SMTP without exporting agents", async () => {
  const f = await installed()
  const { insertRow } = await import("./counts")
  await f.t.run(async (ctx) => {
    for (const [source, userAgent] of [
      ["api", "opensend-node:0.1.1"],
      ["api", "opensend-node:0.1.2"],
      ["api", "opensend-mcp:0.1.1"],
      ["api", "custom client"],
      ["smtp", "smtp client"],
      ["dashboard", "browser"],
    ] as const) {
      await insertRow(ctx, "apiLogs", {
        organizationId: f.owner.team,
        method: "GET",
        path: "/emails",
        status: 200,
        statusClass: "2xx",
        durationMs: 1,
        userAgent,
        source,
        summary: "GET /emails 200",
      })
    }
  })
  vi.advanceTimersByTime(900_000)
  const payload = await f.owner.client.action(api.telemetry.preview)
  expect(payload?.usage).toMatchObject({
    apiRequests24h: "1-9",
    sdkRequests24h: "1-9",
    mcpRequests24h: "1-9",
    smtpUsed30d: true,
  })
  const usage = await f.t.query(internal.telemetry.teamUsage, {
    team: f.owner.team,
    now: Date.now(),
  })
  expect(usage.counts.apiRequests24h).toBe(4)
  const page = await f.t.query(internal.telemetry.rows, {
    kind: "clientRequests",
    team: f.owner.team,
    now: Date.now(),
    userAgent: "opensend-node:0.1.1",
    paginationOpts: { numItems: 100, cursor: null },
  })
  expect(page.count).toBe(1)
  expect(JSON.stringify(payload)).not.toContain("custom client")
  vi.advanceTimersByTime(30 * TELEMETRY_DAY)
  const expired = await f.t.query(internal.telemetry.teamUsage, {
    team: f.owner.team,
    now: Date.now(),
  })
  expect(expired.counts.apiRequests24h).toBe(0)
  expect(expired.smtpUsed30d).toBe(false)
  expect(
    (
      await f.t.query(internal.telemetry.rows, {
        kind: "clientRequests",
        team: f.owner.team,
        now: Date.now(),
        userAgent: "opensend-node:0.1.1",
        paginationOpts: { numItems: 100, cursor: null },
      })
    ).count
  ).toBe(0)
})

test("collector override is honored and a hanging request aborts at three seconds", async () => {
  const f = await installed()
  vi.stubEnv(
    "OPENSEND_TELEMETRY_URL",
    "https://collector.example.test/telemetry"
  )
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let signal: AbortSignal | undefined
  const fetchMock = vi.fn((_url: string, request: RequestInit) => {
    signal = request.signal as AbortSignal
    started()
    return new Promise<Response>((_resolve, reject) =>
      signal!.addEventListener("abort", () => reject(signal!.reason))
    )
  })
  vi.stubGlobal("fetch", fetchMock)
  const send = f.t.action(internal.telemetry.send)
  await ready
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://collector.example.test/telemetry"
  )
  await vi.advanceTimersByTimeAsync(2999)
  expect(signal?.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await send
  expect(signal?.aborted).toBe(true)
})
