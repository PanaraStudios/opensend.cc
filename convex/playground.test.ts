// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { minuteUsage } from "./voice/usage"
import { api, internal } from "./_generated/api"
import { inboundFixture } from "./testHelpers/meta.fixture"
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-key-".repeat(6))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
async function setup() {
  const f = await inboundFixture(),
    args = { organizationId: f.owner.team, browserId: "playground" }
  const agent = await f.owner.client.mutation(
    internal.calling.softphoneState.begin,
    args
  )
  await f.owner.client.mutation(internal.calling.softphoneState.provisioned, {
    ...args,
    leaseId: agent.leaseId,
    extension: "2000",
    expiresAt: Date.now() + 120000,
  })
  await f.owner.client.mutation(api.calling.softphoneState.presence, {
    ...args,
    status: "online",
  })
  const ivrId = await f.t.run((ctx) =>
    ctx.db.insert("ivrs", {
      organizationId: args.organizationId,
      name: "Reception",
      language: "en",
      entryMenuId: "main",
      menus: [
        {
          id: "main",
          name: "Main",
          prompt: { kind: "tts", text: "Hello" },
          options: {},
          noInputAction: { kind: "hangup" },
          failureAction: { kind: "hangup" },
          timeoutSeconds: 5,
          retries: 2,
          maxDigits: 1,
        },
      ],
      webhookSecret: "unused",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
  return {
    ...f,
    args,
    ivrId,
    createArgs: { ...args, accountId: f.account, ivrId },
  }
}
test("playground calls reserve the browser, are marked test and are isolated", async () => {
  const f = await setup()
  const call = await f.owner.client.mutation(
    internal.calling.playgroundState.create,
    f.createArgs
  )
  expect(call.test).toBe(true)
  expect(call.status).toBe("ringing")
  expect(call.connectedAt).toBeUndefined()
  expect(call.wacid).toBeUndefined()
  expect(call.agentExtension).toBe("2000")
  await f.t.mutation(internal.calling.gatewayState.consume, {
    nonce: "test-media",
    expiresAt: Date.now() + 60000,
    data: {
      eventId: "test-media-event",
      callId: call._id,
      event: "media_up",
      timestamp: Date.now(),
    },
  })
  expect((await f.t.run((ctx) => ctx.db.get("calls", call._id)))?.status).toBe(
    "connected"
  )

  // A test route is authorized by its saved target, independently of live number routing.
  const decision = await f.t.mutation(internal.ivr.runtime.start, {
    callId: call._id,
    ivrId: f.ivrId,
    origin: "https://backend.test",
    nonce: "playground-start",
    expiresAt: Date.now() + 60000,
  })
  expect(decision.action.kind).toBe("hangup") // Legacy typed prompt is not rendered yet.
  await f.t.run((ctx) =>
    ctx.db.patch("calls", call._id, {
      assignedAgent: "transfer-agent",
      agentLeaseId: "transfer-lease",
    })
  )
  expect(
    (
      await f.owner.client.query(internal.calling.playgroundState.owned, {
        ...f.args,
        id: call._id,
      })
    )._id
  ).toBe(call._id)

  await expect(
    f.owner.client.mutation(
      internal.calling.playgroundState.create,
      f.createArgs
    )
  ).rejects.toMatchObject({ data: "Agent already has a call" })
  await expect(
    f.outsider.client.query(api.calling.playgroundState.detail, {
      organizationId: f.outsider.team,
      id: call._id,
    })
  ).rejects.toBeDefined()
  await expect(
    f.owner.client.query(internal.calling.playgroundState.owned, {
      ...f.args,
      browserId: "other",
      id: call._id,
    })
  ).rejects.toBeDefined()
  await f.owner.client.mutation(internal.calling.rows.finish, {
    id: call._id,
    status: "completed",
  })
  const detail = await f.owner.client.query(
    api.calling.playgroundState.detail,
    { organizationId: f.owner.team, id: call._id }
  )
  expect(detail.test).toBe(true)
  expect(detail.status).toBe("completed")
  const events = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(events.some((e) => e.type.startsWith("whatsapp.call."))).toBe(false)
})
test("playground refuses an IVR and account from another team before external IO", async () => {
  const f = await setup()
  await f.t.run((ctx) =>
    ctx.db.patch("ivrs", f.ivrId, { organizationId: f.outsider.team })
  )
  await expect(
    f.owner.client.mutation(
      internal.calling.playgroundState.create,
      f.createArgs
    )
  ).rejects.toBeDefined()
  expect(await f.t.run((ctx) => ctx.db.query("calls").collect())).toHaveLength(
    0
  )
})

test("bot tests bypass production budgets and concurrency accounting, expose diagnostics and never send a customer message", async () => {
  const f = await setup()
  const key = await f.owner.client.action(api.voice.resources.dashboardWrite, {
    organizationId: f.owner.team,
    kind: "provider",
    body: JSON.stringify({
      provider: "gemini",
      label: "Testing",
      key: "test-provider-key",
    }),
  })
  const bot = await f.owner.client.action(api.voice.resources.dashboardWrite, {
    organizationId: f.owner.team,
    kind: "bot",
    body: JSON.stringify({
      name: "Support",
      provider: "gemini",
      credentialId: key.id,
      monthlyMinuteBudget: 0,
      maxConcurrentCalls: 1,
      tools: ["lookup_contact", "send_whatsapp_message"],
    }),
  })
  const input = {
    ...f.args,
    accountId: f.account,
    botId: bot.id as import("./_generated/dataModel").Id<"voiceBots">,
  }
  const call = await f.owner.client.mutation(
    internal.calling.playgroundState.create,
    input
  )
  expect(call.botActive).toBe(true)
  expect(call.botFallbackReason).toBeUndefined()
  const args = { organizationId: f.owner.team, browserId: "member-playground" }
  const agent = await f.member.client.mutation(
    internal.calling.softphoneState.begin,
    args
  )
  await f.member.client.mutation(internal.calling.softphoneState.provisioned, {
    ...args,
    leaseId: agent.leaseId,
    extension: "2001",
    expiresAt: Date.now() + 120000,
  })
  await f.member.client.mutation(api.calling.softphoneState.presence, {
    ...args,
    status: "online",
  })
  const second = await f.member.client.mutation(
    internal.calling.playgroundState.create,
    { ...input, ...args }
  )
  expect(second.botActive).toBe(true)
  expect(
    await f.t.run((ctx) => minuteUsage.sum(ctx, { namespace: f.owner.team }))
  ).toBe(0)
  const envelope = (data: Record<string, unknown>) => ({
    nonce: crypto.randomUUID(),
    expiresAt: Date.now() + 60000,
    data: {
      version: 1,
      callId: call._id,
      timestamp: Date.now(),
      eventId: crypto.randomUUID(),
      ...data,
    },
  })
  const result = await f.t.mutation(
    internal.voice.gateway.tool,
    envelope({
      organizationId: f.owner.team,
      toolCall: {
        id: "send-test",
        name: "send_whatsapp_message",
        arguments: { text: "Hello" },
      },
    })
  )
  expect(result).toMatchObject({
    ok: true,
    result: { test: true, message: "Test preview; no message sent" },
  })
  await f.t.mutation(
    internal.voice.gateway.event,
    envelope({ type: "latency", turnId: "turn-1", latencyMs: 123 })
  )
  await f.t.mutation(
    internal.voice.gateway.event,
    envelope({
      type: "transcript",
      transcript: {
        role: "agent",
        text: "Hello [interrupted]",
        final: true,
        timestampMs: 200,
      },
    })
  )
  vi.setSystemTime(Date.now() + 60000)
  await f.t.mutation(
    internal.voice.gateway.event,
    envelope({
      type: "bot_completed",
      outcome: "completed",
      summary: "Test complete",
      usage: { inputTokens: 12, audioSeconds: 1 },
    })
  )
  expect(
    await f.t.run((ctx) => minuteUsage.sum(ctx, { namespace: f.owner.team }))
  ).toBe(0)
  const transcript = await f.owner.client.query(
    api.voice.resources.dashboardTranscript,
    { organizationId: f.owner.team, id: call._id, limit: 100 }
  )
  expect(transcript.data).toHaveLength(4)
  await expect(
    f.outsider.client.query(api.voice.resources.dashboardTranscript, {
      organizationId: f.outsider.team,
      id: call._id,
      limit: 100,
    })
  ).rejects.toBeDefined()
  const events = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.owner.team)
      )
      .take(100)
  )
  expect(events.some((e) => e.type.startsWith("whatsapp.call."))).toBe(false)
})

test("playground health reports missing configuration and failed probes as unavailable", async () => {
  const f = await inboundFixture()
  const args = { organizationId: f.owner.team }
  vi.stubEnv("CALL_GATEWAY_URL", "")
  vi.stubEnv("CALL_GATEWAY_SECRET", "")
  expect(await f.owner.client.action(api.calling.playground.health, args)).toBe(
    false
  )
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", "g".repeat(64))
  const fetchMock = vi.spyOn(globalThis, "fetch")
  try {
    fetchMock.mockRejectedValueOnce(new TypeError("Network unavailable"))
    expect(
      await f.owner.client.action(api.calling.playground.health, args)
    ).toBe(false)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    expect(
      await f.owner.client.action(api.calling.playground.health, args)
    ).toBe(false)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    expect(
      await f.owner.client.action(api.calling.playground.health, args)
    ).toBe(true)
    fetchMock.mockClear()
    await expect(
      f.outsider.client.action(api.calling.playground.health, args)
    ).rejects.toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  } finally {
    fetchMock.mockRestore()
  }
})

test("playground health aborts an unresponsive gateway within its two-second probe deadline", async () => {
  vi.useRealTimers()
  const f = await inboundFixture()
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", "g".repeat(64))
  let aborted = false
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(init!.signal!.reason)
          },
          { once: true }
        )
      })
  )
  try {
    const started = Date.now()
    expect(
      await f.owner.client.action(api.calling.playground.health, {
        organizationId: f.owner.team,
      })
    ).toBe(false)
    expect(aborted).toBe(true)
    expect(Date.now() - started).toBeLessThan(5000)
  } finally {
    fetchMock.mockRestore()
  }
})
