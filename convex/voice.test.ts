// @vitest-environment node
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { inboundFixture } from "./testHelpers/meta.fixture"
import { patchRow } from "./counts"
import { signRequest } from "../services/call-gateway/src/auth"
import type { Id } from "./_generated/dataModel"
const secret = "a".repeat(64)
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "voice-test-key-".repeat(6))
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
async function fixture() {
  const f = await inboundFixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  const key = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Voice", permission: "full_access", domainId: null },
  })
  const request = (path: string, method = "GET", body?: unknown) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${key.token}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }
  const signed = (
    path: string,
    data: Record<string, unknown>,
    nonce?: string
  ) => {
    const body = JSON.stringify({ version: 1, ...data })
    return f.t.fetch(`/calling/gateway/voice/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signRequest(
          secret,
          "POST",
          `/calling/gateway/voice/${path}`,
          body,
          Math.floor(Date.now() / 1000).toString(),
          nonce
        ),
      },
      body,
    })
  }
  const credentialResponse = await request("/voice-providers", "POST", {
    provider: "gemini",
    label: "Primary",
    key: "secret-provider-key-1234",
  })
  expect(credentialResponse.status).toBe(200)
  const credential = (await credentialResponse.json())
    .id as Id<"voiceProviders">
  const created = await request("/voice-bots", "POST", {
    name: "Support",
    provider: "gemini",
    credentialId: credential,
    tools: [
      "lookup_contact",
      "create_note",
      "send_whatsapp_message",
      "transfer_to_agent",
      "transfer_to_ivr",
      "end_call",
    ],
    maxConcurrentCalls: 1,
    monthlyMinuteBudget: 10,
  })
  expect(created.status).toBe(200)
  const bot = (await created.json()).id as Id<"voiceBots">
  await f.t.run((ctx) =>
    ctx.db.insert("callingSettings", {
      organizationId: f.owner.team,
      accountId: f.account,
      mode: "gateway",
      settings: "{}",
      routing: { kind: "bot", botId: bot },
      updatedAt: Date.now(),
    })
  )
  const createCall = () =>
    f.t.run((ctx) =>
      ctx.db.insert("calls", {
        organizationId: f.owner.team,
        accountId: f.account,
        direction: "inbound",
        status: "connected",
        mode: "gateway",
        userId: "US.caller",
        observedAt: Date.now(),
        connectedAt: Date.now(),
      })
    )
  return { ...f, request, signed, credential, bot, createCall }
}
test("credentials are write-only in REST, queries, logs and errors; authenticated session is the only decrypted channel", async () => {
  const f = await fixture()
  const providers = await (await f.request("/voice-providers")).json()
  expect(providers.data[0]).toMatchObject({ lastFour: "1234" })
  expect(JSON.stringify(providers)).not.toContain("secret-provider")
  const bot = await (await f.request(`/voice-bots/${f.bot}`)).json()
  expect(bot.credentialId).toBe(f.credential)
  expect(JSON.stringify(bot)).not.toContain("secret-provider")
  const logs = await f.t.run((ctx) => ctx.db.query("apiLogBodies").take(100))
  expect(JSON.stringify(logs)).not.toContain("secret-provider")
  const callId = await f.createCall()
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: callId })).target
  ).toBe("bot")
  const session = await f.signed("session", {
    callId,
    organizationId: f.owner.team,
  })
  expect(session.status).toBe(200)
  expect((await session.json()).keys.live).toBe("secret-provider-key-1234")
  expect(session.headers.get("cache-control")).toBe("no-store")
  expect(
    (await f.signed("session", { callId, organizationId: "other-team" })).status
  ).toBe(404)
  const body = JSON.stringify({
    version: 1,
    callId,
    organizationId: f.owner.team,
  })
  expect(
    (
      await f.t.fetch("/calling/gateway/voice/session", {
        method: "POST",
        body,
      })
    ).status
  ).toBe(401)
  expect(
    (await f.request(`/voice-providers/${f.credential}`, "DELETE")).status
  ).toBe(409)
})
test("atomic admission falls back for concurrency and monthly reservations; completion frees capacity with bounded duration", async () => {
  const f = await fixture(),
    one = await f.createCall(),
    two = await f.createCall()
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: one })).target
  ).toBe("bot")
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: one })).target
  ).toBe("bot")
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: two })).target
  ).toBe("voicemail")
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", two)))!.botFallbackReason
  ).toBe("concurrency_exhausted")
  vi.setSystemTime(Date.now() + 60000)
  const completed = await f.signed("events", {
    callId: one,
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    type: "bot_completed",
    outcome: "completed",
    summary: "Asked about an order",
    usage: { inputTokens: 12 },
  })
  expect(completed.status).toBe(200)
  const row = await f.t.run((ctx) => ctx.db.get("calls", one))
  expect(row).toMatchObject({
    botActive: false,
    botDuration: 60,
    botOutcome: "completed",
  })
  const three = await f.createCall()
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: three })).target
  ).toBe("voicemail")
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", three)))!.botFallbackReason
  ).toBe("budget_exhausted")
  const events = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.owner.team)
      )
      .take(100)
  )
  expect(JSON.stringify(events)).not.toContain("secret-provider")
})
test("tool catalog rejects tenant/recipient overrides, durably deduplicates notes, denies IVR, and transcript cursors are scoped", async () => {
  const f = await fixture(),
    callId = await f.createCall()
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const tool = (
    id: string,
    name: string,
    args: Record<string, unknown>,
    organizationId = f.owner.team
  ) =>
    f.signed("tools", {
      callId,
      organizationId,
      toolCall: { id, name, arguments: args },
    })
  expect(
    (await tool("lookup", "lookup_contact", { contactId: "other" })).status
  ).toBe(200)
  expect(
    await (
      await tool("lookup", "lookup_contact", { contactId: "other" })
    ).json()
  ).toMatchObject({ ok: false })
  expect((await tool("cross", "lookup_contact", {}, "other-team")).status).toBe(
    404
  )
  const note = await (
    await tool("note", "create_note", { text: "Caller needs support" })
  ).json()
  expect(note).toMatchObject({ ok: true, result: { storedOn: "call" } })
  expect(
    await (
      await tool("note", "create_note", { text: "Caller needs support" })
    ).json()
  ).toEqual(note)
  expect(
    await (await tool("note", "create_note", { text: "different" })).json()
  ).toMatchObject({ ok: false })
  expect(await (await tool("ivr", "transfer_to_ivr", {})).json()).toMatchObject(
    { ok: false, error: expect.stringContaining("8d-3") }
  )
  expect(
    await (
      await tool("send", "send_whatsapp_message", {
        text: "Hello",
        recipient: "someone-else",
      })
    ).json()
  ).toMatchObject({ ok: false })
  const nonce = crypto.randomUUID()
  expect(
    (
      await f.signed(
        "tools",
        {
          callId,
          organizationId: f.owner.team,
          toolCall: { id: "replay", name: "lookup_contact", arguments: {} },
        },
        nonce
      )
    ).status
  ).toBe(200)
  expect(
    (
      await f.signed(
        "tools",
        {
          callId,
          organizationId: f.owner.team,
          toolCall: { id: "replay", name: "lookup_contact", arguments: {} },
        },
        nonce
      )
    ).status
  ).toBe(401)
  const notes = await f.t.run((ctx) =>
    ctx.db
      .query("callTranscripts")
      .withIndex("by_callId", (q) => q.eq("callId", callId))
      .take(100)
  )
  expect(notes.filter((n) => n.kind === "note")).toHaveLength(1)
  const page = await (
    await f.request(`/whatsapp/calls/${callId}/transcript?limit=1`)
  ).json()
  expect(page.data).toHaveLength(1)
  expect(page.has_more).toBe(true)
  const second = await (
    await f.request(
      `/whatsapp/calls/${callId}/transcript?limit=1&after=${page.data[0].id}`
    )
  ).json()
  expect(second.data[0].id).not.toBe(page.data[0].id)
  const otherCall = await f.createCall(),
    otherLine = await f.t.run((ctx) =>
      ctx.db.insert("callTranscripts", {
        organizationId: f.owner.team,
        callId: otherCall,
        eventId: crypto.randomUUID(),
        kind: "note",
        text: "Other call",
        timestampMs: 0,
      })
    )
  expect(
    (await f.request(`/whatsapp/calls/${callId}/transcript?after=${otherLine}`))
      .status
  ).toBe(422)
  const eventId = crypto.randomUUID(),
    event = {
      callId,
      eventId,
      timestamp: Date.now(),
      type: "transcript",
      transcript: {
        role: "caller",
        text: "hello",
        final: true,
        timestampMs: 100,
      },
    }
  expect((await f.signed("events", event)).status).toBe(200)
  expect((await f.signed("events", event)).status).toBe(200)
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("callTranscripts")
        .withIndex("by_callId_and_eventId", (q) =>
          q.eq("callId", callId).eq("eventId", eventId)
        )
        .take(2)
    )
  ).toHaveLength(1)
  await f.t.run((ctx) => ctx.db.patch("calls", callId, { status: "completed" }))
  expect((await tool("late", "end_call", {})).status).toBe(404)
})
test("voice resource scopes, same-provider credential ownership, config validation and number routing", async () => {
  const f = await fixture()
  const custom = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: {
      name: "WhatsApp",
      permission: "custom",
      scopes: ["whatsapp:write"],
      domainId: null,
    },
  })
  vi.setSystemTime(Date.now() + 1100)
  expect(
    (
      await f.t.fetch("/voice-bots", {
        headers: { authorization: `Bearer ${custom.token}` },
      })
    ).status
  ).toBe(403)
  expect(
    (
      await f.request(`/voice-bots/${f.bot}`, "PATCH", {
        language: "unsupported",
      })
    ).status
  ).toBe(422)
  expect((await f.request(`/voice-bots/${f.bot}`, "DELETE")).status).toBe(409)
  expect(
    (
      await f.request("/voice-bots", "POST", {
        name: "Other provider",
        credentialId: f.credential,
        provider: "sarvam",
      })
    ).status
  ).toBe(422)
  const foreign = await f.t.run((ctx) =>
    ctx.db.insert("voiceProviders", {
      organizationId: "other-team",
      provider: "gemini",
      label: "Private",
      encryptedKey: "not-a-key",
      lastFour: "1234",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
  expect(
    (
      await f.request("/voice-bots", "POST", {
        name: "Cross-team",
        credentialId: foreign,
        provider: "gemini",
      })
    ).status
  ).toBe(422)
})

test("hangup events revoke tool access before summaries finish, and non-bot voice events remain supported", async () => {
  const f = await fixture(),
    callId = await f.createCall()
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  expect(
    (
      await f.signed("events", {
        callId,
        type: "state",
        state: "hangup",
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
      })
    ).status
  ).toBe(200)
  expect(
    (
      await f.signed("tools", {
        callId,
        organizationId: f.owner.team,
        toolCall: { id: "after-stop", name: "end_call", arguments: {} },
      })
    ).status
  ).toBe(404)
  expect(
    (
      await f.signed("events", {
        callId,
        type: "bot_completed",
        outcome: "caller_hangup",
        summary: "Caller hung up",
        endedAt: Date.now(),
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
      })
    ).status
  ).toBe(200)
  const voicemail = await f.createCall()
  expect(
    (
      await f.signed("events", {
        callId: voicemail,
        type: "state",
        state: "voicemail",
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
      })
    ).status
  ).toBe(200)
  expect(
    (await f.request(`/whatsapp/calls/${voicemail}/transcript`)).status
  ).toBe(200)
})

test("cascade stage credentials are team-scoped, fetched only in the signed session, and protected from deletion", async () => {
  const f = await fixture()
  const sarvam = await (
    await f.request("/voice-providers", "POST", {
      provider: "sarvam",
      label: "STT/LLM",
      key: "fake-sarvam-key",
    })
  ).json()
  const eleven = await (
    await f.request("/voice-providers", "POST", {
      provider: "elevenlabs",
      label: "TTS",
      key: "fake-eleven-key",
    })
  ).json()
  const response = await f.request("/voice-bots", "POST", {
    name: "India",
    engine: "cascade",
    provider: "sarvam",
    credentialId: sarvam.id,
    language: "gu-IN",
    tts: { provider: "elevenlabs", credentialId: eleven.id, voice: "voice-id" },
  })
  expect(response.status).toBe(200)
  const bot = await response.json()
  const read = await (await f.request(`/voice-bots/${bot.id}`)).json()
  expect(read).toMatchObject({
    engine: "cascade",
    stt: { model: "saaras:v4" },
    llm: { model: "sarvam-105b-conversations" },
    tts: { model: "eleven_v4_turbo" },
  })
  expect(JSON.stringify(read)).not.toContain("fake-eleven-key")
  expect(
    (await f.request(`/voice-providers/${eleven.id}`, "DELETE")).status
  ).toBe(409)
  await f.t.run(async (ctx) => {
    const settings = await ctx.db
      .query("callingSettings")
      .withIndex("by_accountId", (q) => q.eq("accountId", f.account))
      .unique()
    await ctx.db.patch("callingSettings", settings!._id, {
      routing: { kind: "bot", botId: bot.id },
    })
  })
  const callId = await f.createCall()
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const session = await (
    await f.signed("session", { callId, organizationId: f.owner.team })
  ).json()
  expect(session.keys).toEqual({
    stt: "fake-sarvam-key",
    llm: "fake-sarvam-key",
    tts: "fake-eleven-key",
  })
  const logBodies = await f.t.run((ctx) =>
    ctx.db.query("apiLogBodies").take(100)
  )
  expect(JSON.stringify(logBodies)).not.toContain("fake-eleven-key")
})
