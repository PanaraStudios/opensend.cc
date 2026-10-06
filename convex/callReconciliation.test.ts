/// <reference types="vite/client" />
// @vitest-environment node
import { convexTest } from "convex-test"
import aggregateTest from "@convex-dev/aggregate/test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import { minuteUsage } from "./voice/usage"
import { signRequest, HmacVerifier } from "../services/call-gateway/src/auth"

const modules = import.meta.glob("./**/*.ts")
const start = 1_800_000_000_000
const secret = "h".repeat(64)
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(start)
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function fixture(patch: Partial<Doc<"calls">> = {}) {
  const t = convexTest({ schema, modules, transactionLimits: true })
  aggregateTest.register(t, "voiceMinuteUsage")
  const callId = await t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("metaConnections", {
      organizationId: "reconciliation",
      businessId: "test",
      businessName: "Test",
      method: "manual_token",
      encryptedToken: "unused",
      tokenLast4: "none",
      scopes: [],
      status: "active",
    })
    const accountId = await ctx.db.insert("channelAccounts", {
      organizationId: "reconciliation",
      connectionId,
      channel: "whatsapp",
      externalId: "test",
      displayName: "Test",
      handle: "test",
      status: "active",
      throughputMps: 80,
    })
    return ctx.db.insert("calls", {
      organizationId: "reconciliation",
      accountId,
      direction: "inbound",
      mode: "gateway",
      status: "connected",
      observedAt: start,
      connectedAt: start,
      lastActivityAt: start,
      operation: "pending",
      operationUntil: start + 300_000,
      ...patch,
    })
  })
  const read = () => t.run((ctx) => ctx.db.get("calls", callId))
  const reconcile = () =>
    t.mutation(internal.calling.rows.reconcileInactive, {})
  const heartbeat = async () => {
    const path = "/calling/gateway/events"
    const body = JSON.stringify({
      version: 1,
      eventId: crypto.randomUUID(),
      callId,
      event: "heartbeat",
      timestamp: Date.now() - 30_000,
    })
    return t.fetch(path, {
      method: "POST",
      body,
      headers: signRequest(secret, "POST", path, body),
    })
  }
  return { t, callId, read, reconcile, heartbeat }
}

test("stuck call ends at two minutes, frees leases, settles duration and schedules signed best-effort cleanup", async () => {
  const f = await fixture({
    assignedAgent: "agent",
    agentLeaseId: "lease",
    agentExtension: "2000",
  })
  const agentId = await f.t.run((ctx) =>
    ctx.db.insert("callAgents", {
      organizationId: "reconciliation",
      userId: "agent",
      name: "Agent",
      authSessionId: "session",
      browserId: "browser",
      leaseId: "lease",
      status: "online",
      expiresAt: start + 600_000,
      updatedAt: start,
      reservedCallId: f.callId,
      reservationUntil: start + 600_000,
    })
  )
  vi.setSystemTime(start + 119_999)
  await f.reconcile()
  expect((await f.read())?.status).toBe("connected")
  vi.setSystemTime(start + 120_000)
  await f.reconcile()
  expect(await f.read()).toMatchObject({
    status: "completed",
    endedAt: Date.now(),
    duration: 120,
    error: "Ended: no audio for 2 minutes",
    botActive: false,
  })
  expect((await f.read())?.operation).toBeUndefined()
  expect((await f.read())?.agentLeaseId).toBeUndefined()
  const agent = await f.t.run((ctx) => ctx.db.get("callAgents", agentId))
  expect(agent?.reservedCallId).toBeUndefined()
  expect(agent?.reservationUntil).toBeUndefined()
  expect(agent?.status).toBe("online")
  const jobs = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect()
  )
  expect(
    jobs.filter((job) => job.name.includes("callActions:cleanup"))
  ).toHaveLength(1)
  const verifier = new HmacVerifier(secret)
  const fetcher = vi.fn(
    async (_input: string | URL | Request, _options?: RequestInit) => {
      void _input
      void _options
      return new Response(null, { status: 503 })
    }
  )
  function assertSigned(req: Request, body: string) {
    expect(req.url).toBe("http://gateway.test/hangup")
    expect(JSON.parse(body)).toMatchObject({ callId: f.callId })
    expect(() =>
      verifier.verify(
        req.method,
        new URL(req.url).pathname,
        body,
        Object.fromEntries(req.headers)
      )
    ).not.toThrow()
  }
  vi.stubGlobal("fetch", fetcher)
  await f.t.action(internal.calling.callActions.cleanup, { id: f.callId })
  expect(fetcher).toHaveBeenCalledOnce()
  const [input, options] = fetcher.mock.calls[0]
  const request = new Request(input, options)
  assertSigned(request, await request.text())
})

test("signed activity is throttled, protects suppressed recent activity and ignores terminal rows", async () => {
  const f = await fixture()
  vi.setSystemTime(start + 100_000)
  expect((await f.heartbeat()).status).toBe(200)
  expect((await f.read())?.lastActivityAt).toBe(start + 130_000)
  vi.setSystemTime(start + 129_999)
  expect((await f.heartbeat()).status).toBe(200)
  expect((await f.read())?.lastActivityAt).toBe(start + 130_000)
  vi.setSystemTime(start + 249_998)
  await f.reconcile()
  expect((await f.read())?.status).toBe("connected")
  vi.setSystemTime(start + 250_000)
  await f.reconcile()
  expect((await f.read())?.status).toBe("completed")
  expect((await f.heartbeat()).status).toBe(200)
  expect((await f.read())?.lastActivityAt).toBe(start + 130_000)
})

test.each(["reconcile", "hangup"] as const)(
  "%s wins the terminal race once",
  async (first) => {
    const f = await fixture()
    vi.setSystemTime(start + 120_000)
    const hangup = () =>
      f.t.mutation(internal.calling.rows.endLocally, {
        id: f.callId,
        kind: "hangup",
        at: Date.now(),
        reason: "Caller hung up",
      })
    if (first === "reconcile") {
      await f.reconcile()
      expect(await hangup()).toBeNull()
    } else {
      expect(await hangup()).not.toBeNull()
      await f.reconcile()
    }
    const before = await f.read()
    vi.setSystemTime(Date.now() + 60_000)
    await f.reconcile()
    expect(await hangup()).toBeNull()
    expect(await f.read()).toEqual(before)
    const events = await f.t.run((ctx) => ctx.db.query("events").collect())
    expect(
      events.filter((event) => event.type === "whatsapp.call.completed")
    ).toHaveLength(1)
  }
)

test("an expiry claim made after a fresh heartbeat cannot end the call", async () => {
  const f = await fixture()
  vi.setSystemTime(start + 120_000)
  expect((await f.heartbeat()).status).toBe(200)
  expect(
    await f.t.mutation(internal.calling.rows.endLocally, {
      id: f.callId,
      kind: "inactive",
      reason: "Ended: no audio for 2 minutes",
    })
  ).toBeNull()
  expect((await f.read())?.status).toBe("connected")
})

test.each(["transcript", "media", "playback_done"] as const)(
  "%s callbacks refresh activity without trusting the gateway clock",
  async (type) => {
    const f = await fixture()
    vi.setSystemTime(start + 119_000)
    const path = "/calling/gateway/voice/events"
    const body = JSON.stringify({
      version: 1,
      eventId: crypto.randomUUID(),
      callId: f.callId,
      type,
      timestamp: start,
      ...(type === "transcript"
        ? {
            transcript: {
              role: "caller",
              text: "Hello",
              final: true,
              timestampMs: 1000,
            },
          }
        : type === "media"
          ? {
              codec: "L16",
              received: 1,
              sent: 1,
              playedMs: 20,
              lost: 0,
              late: 0,
              maxTickDelayMs: 0,
            }
          : { turnId: "turn", playedMs: 20 }),
    })
    expect(
      (
        await f.t.fetch(path, {
          method: "POST",
          body,
          headers: signRequest(secret, "POST", path, body),
        })
      ).status
    ).toBe(200)
    vi.setSystemTime(start + 120_000)
    await f.reconcile()
    expect((await f.read())?.status).toBe("connected")
    expect((await f.read())?.lastActivityAt).toBe(start + 149_000)
  }
)

test.each(["gatewayAt", "mediaUpAt", "connectedAt", "observedAt"] as const)(
  "legacy call uses its latest %s and is normalized out of the legacy scan",
  async (field) => {
    const f = await fixture({ lastActivityAt: undefined })
    await f.t.run((ctx) =>
      ctx.db.patch("calls", f.callId, { [field]: start + 60_000 })
    )
    vi.setSystemTime(start + 120_000)
    await f.reconcile()
    expect((await f.read())?.status).toBe("connected")
    expect((await f.read())?.lastActivityAt).toBe(start + 60_000)
    vi.setSystemTime(start + 180_000)
    await f.reconcile()
    expect((await f.read())?.status).toBe("completed")
  }
)

test("reconciliation processes at most 50 calls and preserves API calls", async () => {
  const f = await fixture({ mode: "api" })
  await f.t.run(async (ctx) => {
    const call = (await ctx.db.get("calls", f.callId))!
    const { _id, _creationTime, ...fields } = call
    void _id
    void _creationTime
    for (let i = 0; i < 55; i++)
      await ctx.db.insert("calls", { ...fields, mode: "gateway", test: true })
  })
  vi.setSystemTime(start + 120_000)
  await f.reconcile()
  const connected = await f.t.run((ctx) => ctx.db.query("calls").collect())
  expect(connected.filter((call) => call.status === "completed")).toHaveLength(
    50
  )
  expect((await f.read())?.status).toBe("connected")
  await f.reconcile()
  expect(
    (await f.t.run((ctx) => ctx.db.query("calls").collect())).filter(
      (call) => call.status === "completed"
    )
  ).toHaveLength(55)
})

test("unfinished bot billing is finalized once and late completion cannot charge again", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    const credentialId = await ctx.db.insert("voiceProviders", {
      organizationId: "reconciliation",
      provider: "gemini",
      label: "Unused",
      encryptedKey: "unused",
      lastFour: "none",
      createdAt: start,
      updatedAt: start,
    })
    const config = {
      engine: "gemini_live" as const,
      name: "Test",
      provider: "gemini" as const,
      credentialId,
      model: "test",
      voice: "test",
      language: "en",
      systemPrompt: "Help",
      greeting: "Hello",
      tools: [],
      handoff: { agents: false },
      maxDurationSeconds: 600,
      silenceTimeoutSeconds: 30,
      recording: false,
      disclosure: "Test",
    }
    const botId = await ctx.db.insert("voiceBots", {
      organizationId: "reconciliation",
      ...config,
      createdAt: start,
      updatedAt: start,
    })
    await ctx.db.patch("calls", f.callId, {
      botId,
      botConfig: config,
      botActive: true,
      botStartedAt: start,
      botSessionStartedAt: start,
    })
    await minuteUsage.insert(ctx, (await ctx.db.get("calls", f.callId))!)
  })
  const sum = () =>
    f.t.run((ctx) => minuteUsage.sum(ctx, { namespace: "reconciliation" }))
  expect(await sum()).toBe(600)
  vi.setSystemTime(start + 120_000)
  await f.reconcile()
  expect(await f.read()).toMatchObject({
    botActive: false,
    botDuration: 120,
    botEndedAt: Date.now(),
  })
  expect(await sum()).toBe(120)
  vi.setSystemTime(start + 180_000)
  await f.t.mutation(internal.voice.gateway.event, {
    nonce: crypto.randomUUID(),
    expiresAt: Date.now() + 60_000,
    data: {
      callId: f.callId,
      eventId: crypto.randomUUID(),
      type: "bot_completed",
      outcome: "caller_hangup",
      summary: "Caller asked for help",
      timestamp: Date.now(),
      usage: {},
    },
  })
  await f.reconcile()
  expect(await sum()).toBe(120)
  expect(await f.read()).toMatchObject({
    botSummary: "Caller asked for help",
    botDuration: 120,
    botEndedAt: start + 120_000,
  })
})
